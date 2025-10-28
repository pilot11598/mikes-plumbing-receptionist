# Mike’s Plumbing AI Receptionist (Twilio + OpenAI)

This tiny Node.js app makes your Twilio phone number talk like a receptionist,
collects name/phone/address/issue/time window, and texts you a lead summary.

## Deploy via GitHub → Render

1) Create a **public GitHub repo** and upload these files.
2) In **Render.com → New → Web Service → GitHub**, pick the repo.
3) Settings:
   - Build command: `npm install`
   - Start command: `npm start`
   - Region: US East
4) Add **Environment Variables** in Render from `.env.sample`:
   - `OPENAI_API_KEY`
   - `TWILIO_ACCOUNT_SID`
   - `TWILIO_AUTH_TOKEN`
   - `TWILIO_SMS_FROM` (e.g., +15162126775)
   - `OWNER_MOBILE` (e.g., +15166974000)
5) Deploy. You should get a URL like `https://<service>.onrender.com`.

## Connect Twilio

Twilio Console → Phone Numbers → Active Numbers → [your number]
- Voice & Fax → **A CALL COMES IN** → Webhook (POST)
- URL: `https://<service>.onrender.com/voice`
- Save.

Call your Twilio number to test.

## What it does

- Greets: “Mike’s Plumbing – how can I help you today?”
- Uses OpenAI to carry a short dialog, asking for missing info.
- After collecting name, phone, address, issue, time window → ends call
- Sends a summary SMS to OWNER_MOBILE.

## Notes

- This MVP uses Twilio text-to-speech Polly Joanna. You can later swap in ElevenLabs.
- For production, use a datastore instead of in-memory sessions.
- Keep your API keys secret (environment variables only).
