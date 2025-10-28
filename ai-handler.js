import express from "express";
import twilio from "twilio";
import fetch from "node-fetch";

const app = express();
app.use(express.urlencoded({ extended: false }));

const { TWILIO_AUTH_TOKEN, OPENAI_API_KEY } = process.env;
const VoiceResponse = twilio.twiml.VoiceResponse;

app.post("/voice", async (req, res) => {
  const twiml = new VoiceResponse();

  // If no speech yet, prompt
  if (!req.body.SpeechResult) {
    const gather = twiml.gather({
      input: "speech",
      action: "/voice",
      speechTimeout: "auto",
    });
    gather.say("Mike’s Plumbing – how can I help you today?");
  } else {
    const userSpeech = req.body.SpeechResult;
    console.log("Caller said:", userSpeech);

    const reply = await getAIResponse(userSpeech);
    twiml.say(reply);
    twiml.redirect("/voice");
  }

  res.type("text/xml");
  res.send(twiml.toString());
});

async function getAIResponse(prompt) {
  const response = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${OPENAI_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "gpt-4o-mini",
      messages: [
        {
          role: "system",
          content: "You are an AI receptionist for Mike’s Plumbing. Be friendly, concise, and always ask for the customer’s name, address, and time window for service.",
        },
        { role: "user", content: prompt },
      ],
    }),
  });

  const data = await response.json();
  return data.choices?.[0]?.message?.content || "Sorry, I didn’t catch that.";
}

app.listen(3000, () => console.log("Server running on port 3000"));
