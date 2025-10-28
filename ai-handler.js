// ai-handler.js
import express from "express";
import twilio from "twilio";
import dotenv from "dotenv";

dotenv.config();

const app = express();
app.use(express.urlencoded({ extended: false })); // Twilio posts form-encoded

const VoiceResponse = twilio.twiml.VoiceResponse;

// Simple step prompts so we don't loop
const PROMPTS = {
  start: "Mike’s Plumbing — how can I help you today?",
  get_name: "Got it. May I have your name, please?",
  get_address: "Thanks. What’s the service address?",
  get_issue: "Thank you. What seems to be the issue?",
  get_time: "When would you like the technician to arrive? For example: today 2–4 PM or tomorrow morning.",
  done: "Perfect. A technician will follow up shortly. Thanks for calling Mike’s Plumbing. Goodbye.",
};

app.get("/", (_req, res) => {
  res.send("Mike’s Plumbing Receptionist running");
});

app.post("/voice", async (req, res) => {
  // Twilio sends step back via querystring on <Redirect>
  const stepFromQuery = (req.query.step || "").toString();
  let step = stepFromQuery || "start";
  const speech = (req.body.SpeechResult || "").trim();

  console.log("[/voice] step:", step, "| speech:", speech);

  const twiml = new VoiceResponse();

  // Helper to ask a question with <Gather>
  const ask = (question, nextStep) => {
    const gather = twiml.gather({
      input: "speech",
      action: `/voice?step=${encodeURIComponent(nextStep)}`,
      method: "POST",
      language: "en-US",
      speechTimeout: "auto",
    });
    gather.say(question);
  };

  try {
    if (!speech) {
      // No speech yet → ask according to current step
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
          break;
      }
    } else {
      // We received caller speech → optionally use AI to acknowledge,
      // then proceed to the next step. (Keeps it robust without looping.)
      const ack = await acknowledgeWithAI(step, speech);
      if (ack) twiml.say(ack);

      if (step === "done") {
        twiml.say(PROMPTS.done);
        // (Optional) send SMS/email summary here later
      } else {
        // Move to next step
        const nextStep = next(step);
        ask(PROMPTS[nextStep], nextStep);
      }
    }
  } catch (err) {
    console.error("Handler error:", err);
    twiml.say("Sorry, there was a glitch. Could you repeat that?");
    ask(PROMPTS[step] || PROMPTS.start, step);
  }

  res.type("text/xml");
  res.send(twiml.toString());
});

// Determine next step in the flow
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

// Short AI acknowledgement to keep it natural (uses Node 18+ global fetch)
async function acknowledgeWithAI(step, userText) {
  // Keep it minimal & cheap; safe if OPENAI_API_KEY missing.
  if (!process.env.OPENAI_API_KEY) return ""; // skip if no key

  const system =
    "You are a concise, friendly plumbing receptionist. Acknowledge the caller's last message in one short sentence and smoothly lead to the next question. Do not repeat the full prompt; keep it natural.";

  const user = `Step: ${step}. Caller said: "${userText}". Respond in one short sentence (max 18 words).`;

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
  const text = data?.choices?.[0]?.message?.content?.trim();
  return text || "";
}

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server on :${PORT}`));
