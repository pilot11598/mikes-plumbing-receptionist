// ai-handler.js
import express from "express";
import twilio from "twilio";
import dotenv from "dotenv";

dotenv.config();

const app = express();
app.use(express.urlencoded({ extended: false })); // Twilio posts x-www-form-urlencoded

const VoiceResponse = twilio.twiml.VoiceResponse;

app.get("/", (req, res) => {
  res.send("Mike’s Plumbing Receptionist running");
});

app.post("/voice", async (req, res) => {
  const twiml = new VoiceResponse();
  const speech = req.body.SpeechResult;

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
    try {
      const reply = await getAIReply(speech);
      twiml.say(reply || "Sorry, I didn’t catch that.");
      // Continue conversation
      twiml.redirect("/voice");
    } catch (e) {
      console.error(e);
      twiml.say("Sorry, we had a glitch. Could you repeat that?");
      twiml.redirect("/voice");
    }
  }

  res.type("text/xml");
  res.send(twiml.toString());
});

async function getAIReply(userText) {
  // Node 18+ has global fetch; no need for node-fetch
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
        {
          role: "system",
          content:
            "You are an AI receptionist for Mike’s Plumbing. Be friendly and concise. Ask one question at a time and collect: name, callback number (or confirm caller ID), service address, issue description, and preferred time window. If asked about price: say diagnosis is ~$89–$149; replacements vary; final quote on-site.",
        },
        { role: "user", content: userText },
      ],
    }),
  });
  const data = await r.json();
  return data?.choices?.[0]?.message?.content?.trim();
}

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server on :${PORT}`));
