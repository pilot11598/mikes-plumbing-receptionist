import 'dotenv/config';
import express from 'express';
import twilio from 'twilio';
import axios from 'axios';

const app = express();
app.use(express.urlencoded({ extended: true }));

const {
  TWILIO_ACCOUNT_SID,
  TWILIO_AUTH_TOKEN,
  TWILIO_SMS_FROM,
  OWNER_MOBILE,
  OPENAI_API_KEY
} = process.env;

if (!OPENAI_API_KEY) console.warn('WARNING: OPENAI_API_KEY is not set');
if (!TWILIO_ACCOUNT_SID || !TWILIO_AUTH_TOKEN) console.warn('WARNING: Twilio credentials are not set');
if (!TWILIO_SMS_FROM) console.warn('WARNING: TWILIO_SMS_FROM not set (will skip SMS summary)');
if (!OWNER_MOBILE) console.warn('WARNING: OWNER_MOBILE not set (will skip SMS summary)');

const VoiceResponse = twilio.twiml.VoiceResponse;
const client = twilio(TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN);

// In-memory per-call store (resets each call)
const sessions = new Map();
function getSession(callSid) {
  if (!sessions.has(callSid)) {
    sessions.set(callSid, {
      slots: { name: null, phone: null, address: null, issue: null, window: null },
      transcript: []
    });
  }
  return sessions.get(callSid);
}

const SYSTEM = `You are the virtual receptionist for "Mike's Plumbing" on Long Island (Nassau/Suffolk).
Your greeting must be exactly: "Mike’s Plumbing – how can I help you today?"
Your job: quickly and politely collect the caller's NAME, CALLBACK NUMBER, SERVICE ADDRESS, ISSUE SUMMARY,
and an APPOINTMENT WINDOW (offer today 2–4 PM or tomorrow morning). Pricing anchors: inspection $79 (applied to job);
standard tank water-heater replacement locally runs $2,000–$3,000 depending on size and fuel type.
If asked about prices, share anchors and note exact quote on-site after inspection.
Ask: "For the text confirmation, should I use the number you’re calling from, or is there a better one?"
Be concise, warm, and confident. Confirm details back before finishing. When all info is captured, say
"You’ll receive a text confirmation shortly." Then end the call.`;

async function aiReply(history, lastUser) {
  const messages = [
    { role: "system", content: SYSTEM },
    ...history,
    { role: "user", content: lastUser }
  ];
  const res = await axios.post(
    "https://api.openai.com/v1/chat/completions",
    {
      model: "gpt-4o-mini",
      temperature: 0.4,
      messages
    },
    { headers: { Authorization: `Bearer ${OPENAI_API_KEY}` } }
  );
  return res.data.choices?.[0]?.message?.content?.trim() || "Could you please repeat that?";
}

// Heuristic slot filling (AI asks explicitly as well)
function tryFillSlots(session, callerText, fromNumber) {
  const s = session.slots;
  if (!s.phone && /use (this|the) number|number you're calling from|that's fine|use my number/i.test(callerText)) {
    s.phone = fromNumber;
  }
  const nameMatch = callerText.match(/\b(my name is|this is)\s+([A-Z][a-z]+(?:\s[A-Z][a-z]+)*)/i);
  if (!s.name && nameMatch) s.name = nameMatch[2];

  const addressMatch = callerText.match(/\b(\d{1,5}\s+[A-Za-z0-9'.\-]+\s+(Street|St|Avenue|Ave|Road|Rd|Lane|Ln|Drive|Dr|Court|Ct|Place|Pl|Boulevard|Blvd|Terrace|Way|Hwy)\b.*)/i);
  if (!s.address && addressMatch) s.address = addressMatch[1];

  if (!s.issue && /(no hot water|leak|clog|toilet|heater|pipe|burst|drip|sink|shower|boiler|water heater)/i.test(callerText)) {
    s.issue = (callerText.match(/(no hot water|leak|clog|toilet|heater|pipe|burst|drip|sink|shower|boiler|water heater)/i) || [])[0];
  }

  const windowMatch = callerText.match(/\b(2-4|two to four|2 to 4|today|tomorrow|morning|afternoon|evening)\b/i);
  if (!s.window && windowMatch) s.window = windowMatch[0];
  return s;
}
function allCollected(s) { return !!(s.name && s.phone && s.address && s.issue && s.window); }

// Entry point: initial greeting + gather
app.post('/voice', async (req, res) => {
  const twiml = new VoiceResponse();
  const gather = twiml.gather({
    input: 'speech',
    speechTimeout: 'auto',
    action: '/gather',
    method: 'POST'
  });
  gather.say({ voice: 'Polly.Joanna' }, "Mike’s Plumbing – how can I help you today?");
  twiml.redirect('/voice'); // repeat if silence
  res.type('text/xml').send(twiml.toString());
});

// Handle each user utterance
app.post('/gather', async (req, res) => {
  const { CallSid, From, SpeechResult = '' } = req.body;
  const session = getSession(CallSid);
  session.transcript.push({ role: 'user', content: SpeechResult });

  // Give AI context of known slots so it asks for missing ones
  const s = session.slots;
  const context = `Known so far: name=${s.name||'?'}, phone=${s.phone||'?'}, address=${s.address||'?'}, issue=${s.issue||'?'}, window=${s.window||'?'}. Caller just said: "${SpeechResult}"`;
  const reply = await aiReply(session.transcript, context);
  session.transcript.push({ role: 'assistant', content: reply });

  tryFillSlots(session, SpeechResult, From);

  const twiml = new VoiceResponse();

  if (allCollected(session.slots)) {
    const confirmText = "You’ll receive a text confirmation shortly. Thank you for calling Mike’s Plumbing.";
    twiml.say({ voice: 'Polly.Joanna' }, reply + " " + confirmText);

    if (TWILIO_SMS_FROM && OWNER_MOBILE) {
      const { name, phone, address, issue, window } = session.slots;
      const summary = `New Lead — Mike's Plumbing
Name: ${name}
Phone: ${phone}
Address: ${address}
Issue: ${issue}
Window: ${window}
CallerID: ${From}`;
      try {
        await client.messages.create({ from: TWILIO_SMS_FROM, to: OWNER_MOBILE, body: summary });
      } catch (e) { console.error('SMS send error:', e.message); }
    }

    sessions.delete(CallSid);
    res.type('text/xml').send(twiml.toString());
    return;
  }

  const gather = twiml.gather({
    input: 'speech',
    speechTimeout: 'auto',
    action: '/gather',
    method: 'POST'
  });
  gather.say({ voice: 'Polly.Joanna' }, reply);
  res.type('text/xml').send(twiml.toString());
});

app.get('/', (_, res) => res.send('Mike’s Plumbing Receptionist running'));
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server on :${PORT}`));
