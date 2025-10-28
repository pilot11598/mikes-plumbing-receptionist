import express from "express";
import twilio from "twilio";
import dotenv from "dotenv";

dotenv.config();

const app = express();
app.use(express.urlencoded({ extended: false }));

const VoiceResponse = twilio.twiml.VoiceResponse;

app.get("/", (req, res) => res.send("Mike’s Plumbing Receptionist running"));

app.post("/voice", async (req, res) => {
  const twiml = new VoiceResponse();
  const speech = req.body.SpeechResult?.trim();

  // Track conversation state in Twilio's Memory via a hidden variable
  let step = req.body.step || "start";

  if (!speech) {
    const gather = twiml.gather({
      input: "speech",
      action: "/voice",
      method: "POST",
      speechTimeout: "auto",
      language: "en-US",
    });
    gather.say("Mike’s Plumbing — how can I help you today?");
  } else {
    let prompt = "";

    switch (step) {
      case "start":
        prompt = `Customer said: "${speech}". Greet them and ask their name.`;
        step = "get_name";
        break;

      case "get_name":
        prompt = `Customer's name: "${speech}". Ask for their address.`;
        step = "get_address";
        break;

      case "get_address":
        prompt = `Address: "${speech}". Ask about the plumbing issue.`;
        step = "get_issue";
        break;

      case "get_issue":
        prompt = `Plumbing issue: "${speech}". Ask when they would like the technician to arrive.`;
        step = "get_time";
        break;

      case "get_time":
        prompt = `Preferred time: "${speech}". Confirm details and end politely.`;
        step = "done";
        break;

      default:
        prompt = `Customer said: "${speech}". Respond politely and keep conversation natural.`;
    }

    try {
      const aiReply = await getAIReply(prompt);
      twiml.say(aiReply);
      if (step !== "done") {
        twiml.redirect(`/voice?step=${step}`);
      }
    } catch (e) {
      console.error(e);
      twiml.say("Sorry, I didn’t catch that. Could you repeat?");
      twiml.redirect(`/voice?step=${step}`);
    }
  }

  res.type("text/xml");
  res.send(twiml.toString());
});

async function getAIReply(prompt) {
  const r = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "gpt-4o-mini",
      messages: [
        {
          role: "system",
          content:
            "You are an AI receptionist for Mike’s Plumbing. Be friendly, short, and natural. Collect info step by step: name, address, issue, preferred time. End politely.",
        },
        { role: "user", content: prompt },
      ],
      temperature: 0.4,
    }),
  });

  const data = await r.json();
  return data?.choices?.[0]?.message?
