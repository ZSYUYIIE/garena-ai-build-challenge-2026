# Gemini Live Realtime Narrator

Node/Express app that streams sampled camera or screen frames to Gemini Live,
shows streamed transcription, and plays Gemini audio output.

## Setup

```bash
npm install
cp .env.example .env
```

Set `GOOGLE_API_KEY` in `.env`.

## Run

```bash
npm start
```

Open http://127.0.0.1:8000.
