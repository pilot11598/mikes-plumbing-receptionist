// ai-handler.js
import express from "express";
import twilio from "twilio";
import dotenv from "dotenv";

dotenv.config();

const app = express();
app.use(express.urlencoded({ extended: false })); // Twilio posts x-www-form-urlencoded

const VoiceResponse = twilio.twiml.VoiceResponse;

// === Voice & speaking helpers (Polly Neural + SSML) =========================
const VOICE = "Polly.Joanna-Neural"; // or "Polly.Matthew-Neural", etc.

// Safely send SSML/string with the selected Polly voice
function speak(twimlOrGather, text) {
  twimlOrGather.say({ voice: VOICE, language: "en-US" }, text);
}

// If AI returns plain text, wrap it with gentle SSML;
// if it already contains SSML tags (<prosody> / <break>), pass through.
function ensureSsml(text) {
  const hasSsml = /<prosody|<break|<emphasis|<\/?s>/.test(text);
  if (hasSsml) return text.trim();
  return `<prosody rate="95%" pitch="+1st">${escapeXml(text)}</prosody>`;
}

function escapeXml(s) {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

// === Simple prompts per step ================================================
const PROMPTS = {
  start:
    `<prosody rate="95%" pitch="+1st">Mike’s Plumbing. <break time="200ms"/> How can I help you today?</prosody>`,
  get_name:
    `<prosody rate="95%" pitch="+1st">Got it. <break time="200ms"/> May I have your name, please?</prosody>`,
  get_address:
    `<prosody rate="95%" pitch="+1st">Thanks. <break time="200ms"/> What’s the service address?</prosody>`,
  get_issue:
    `<prosody rate="95%" pitch="+1st">Thank you. <break time="200ms"/> What seems to be the issue?</prosody>`,
  get_time:
    `<prosody rate="95%" pitch="+1st">When would you like the technician to arrive? <break time="150ms"/> For example, today two to four p.m., or tomorrow morning.</prosody>`,
  done:
    `<prosody rate="95%" pitch="+1st">Perfect. A technician will follow up shortly. <break time="200ms"/> Thanks for calling Mike’s Plumbing. Goodbye.</prosody>`,
};

// === Per-call memory (in-process) ===========================================
const sessions = new Map(); // CallSid => { name, address, issue, time }

// === Routes =================================================================
app.get("/", (_req, res) => {
  res.send("Mike’s Plumbing Receptionist running");
});

app.post("/voice", async (req, res) => {
  const twiml = new VoiceResponse();

  // Step comes back via querystring on <Redirect> / <Gather action=...>
  const stepFromQuery = (req.query.step || "").toString();
  let step = stepFromQuery || "start";

  const speech = (req.body.SpeechResult || "").trim();
  const callSid = (req.body.CallSid || "").trim();
  const from = (req.body.From || "").trim();
  const sess = sessions.get(callSid) || {};

  console.log("[/voice] step:", step, "| speech:", speech);

  // helper: ask a question and point action to next step
  const ask = (questionSsml, nextStep) => {
    const gather = twiml.gather({
      input: "speech",
      action: `/voice?step=${encodeURIComponent(nextStep)}`,
      method: "POST",
      language: "en-US",
      speechTimeout: "auto",
    });
    speak(gather, questionSsml);
  };

  try {
    if (!speech) {
      // No speech yet -> ask by current step
      switch (step) {
        case "start":
          ask(PROMPTS.start, "get_name");
          break;
        case "get_name":
          ask(PROMPTS.get_name, "get_address");
          break;
        case "get_address":
          ask(PROMPTS.get_address, "get_issue");
          break;
        case "get_issue":
          ask(PROMPTS.get_issue, "get_time");
          break;
        case "get_time":
          ask(PROMPTS.get_time, "done");
          break;
        default:
          ask(PROMPTS.start, "get_name");
      }
    } else {
      // We received caller speech -> save field for this step
      switch (step) {
        case "get_name":
          sess.name = speech;
          break;
        case "get_address":
          sess.address = speech;
          break;
        case "get_issue":
          sess.issue = speech;
          break;
        case "get_time":
          sess.time = speech;
          break;
      }
      sessions.set(callSid, sess);

      // Short, natural acknowledgement via OpenAI (returns SSML)
      let ack = "";
      try {
        ack = await acknowledgeWithAI(step, speech);
      } catch (e) {
        console.error("ack AI error:", e?.message || e);
      }
      if (ack) speak(twiml, ensureSsml(ack));

      // Move to next step or finish
      if (step === "done") {
        speak(twiml, PROMPTS.done);
        await sendLeadSMS({
          ownerTo: process.env.OWNER_MOBILE, // your mobile
          fromCaller: from,
          ...sess,
        });
        sessions.delete(callSid);
      } else {
        const nextStep = next(step);
        ask(PROMPTS[nextStep], nextStep);
      }
    }
  } catch (err) {
    console.error("Handler error:", err?.message || err);
    speak(twiml, `<prosody rate="95%" pitch="+1st">Sorry, there was a glitch. Could you repeat that?</prosody>`);
    ask(PROMPTS[step] || PROMPTS.start, step);
  }

  res.type("text/xml");
  res.send(twiml.toString());
});

// === Step machine ============================================================
function next(curr) {
  switch (curr) {
    case "start":
      return "get_name";
    case "get_name":
      return "get_address";
    case "get_address":
      return "get_issue";
    case "get_issue":
      return "get_time";
    case "get_time":
      return "done";
    default:
      return "get_name";
  }
}

// === Short acknowledgement using OpenAI (returns brief SSML) ================
async function acknowledgeWithAI(step, userText) {
  if (!process.env.OPENAI_API_KEY) return ""; // skip if not configured

  const system =
    "You are a friendly plumbing receptionist. " +
    "Reply in 8–14 words, conversational (use contractions). " +
    "Output SSML (no <speak> tag). Include a short <break time='200ms'/> if helpful, " +
    "and wrap the sentence in <prosody rate='95%' pitch='+1st'>...</prosody>.";

  const user = `Step: ${step}. Caller said: "${userText}". Give a single friendly sentence leading to the next question.`;

  const r = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "gpt-4o-mini",
      temperature: 0.3,
      messages: [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
    }),
  });

  const data = await r.json();
  const text = data?.choices?.[0]?.message?.content?.trim() || "";
  return text;
}

// === SMS summary to owner ====================================================
async function sendLeadSMS({ ownerTo, fromCaller, name, address, issue, time }) {
  try {
    if (!ownerTo) return;

    const client = twilio(
      process.env.TWILIO_ACCOUNT_SID,
      process.env.TWILIO_AUTH_TOKEN
    );

    const body =
      `New plumbing lead\n` +
      `Name: ${name || "unknown"}\n` +
      `Phone: ${fromCaller || "unknown"}\n` +
      `Address: ${address || "unknown"}\n` +
      `Issue: ${issue || "unknown"}\n` +
      `Preferred time: ${time || "unknown"}`;

    await client.messages.create({
      from: process.env.TWILIO_SMS_FROM, // your Twilio number
      to: ownerTo,
      body,
    });

    // Optional: also confirm to caller (enable after A2P 10DLC if desired)
    // await client.messages.create({
    //   from: process.env.TWILIO_SMS_FROM,
    //   to: fromCaller,
    //   body: "Thanks for calling Mike’s Plumbing. We’ve received your request and will follow up shortly.",
    // });
  } catch (err) {
    console.error("sendLeadSMS error:", err?.message || err);
  }
}

// === Boot ====================================================================
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server on :${PORT}`));
