# StreamSense Realtime Voice Backend

StreamSense connects the Chrome extension to Gemini Interactions for grounded
screen-change analysis, Gemini Live for push-to-talk questions and native
voice replies, and Google Cloud Speech-to-Text V2 for captured-tab context.

```text
screen frames + user microphone -> StreamSense backend -> Gemini
captured-tab audio              -> StreamSense backend -> Cloud Speech-to-Text
```

The audio sources remain separate: microphone PCM represents the user and is
the only raw audio sent to Gemini Live. Captured-tab PCM is sent only to Cloud
Speech-to-Text; its bounded transcript is labeled as untrusted media context,
not as user speech.

## Prerequisites

- A current Node.js release with npm.
- A Gemini API key for Gemini Interactions and Gemini Live.
- A Google Cloud project with Speech-to-Text V2 enabled and Application
  Default Credentials (ADC) available to the backend process.
- Google Chrome for the extension demo.

## Backend setup

```bash
cd ai-voice-realtime
npm install
cp .env.example .env
```

Configure `.env` without committing the populated file:

| Setting | Purpose |
| --- | --- |
| `GOOGLE_API_KEY` | Backend-only Gemini credential used for vision analysis and Live voice. |
| `GEMINI_VISION_MODEL` | Gemini Interactions model used for atomic screen-change analysis. |
| `GEMINI_LIVE_MODEL` | Gemini Live model used for questions, native voice, and approved narration. |
| `GOOGLE_CLOUD_PROJECT` | Google Cloud project that owns the Speech-to-Text V2 request. |
| `GOOGLE_CLOUD_SPEECH_LOCATION` | Speech-to-Text recognizer location; defaults to `us`. |
| `STREAMSENSE_EXTENSION_ID` | Exact 32-character Chrome extension ID allowed to open the production WebSocket. |
| `HOST` / `PORT` | Local backend bind address and port; defaults to `127.0.0.1:8000`. |

For local operator authentication, configure ADC outside the repository (for
example, with `gcloud auth application-default login`) before starting the
backend. In managed environments, supply ADC through the platform's identity or
secret mechanism. Never copy a service-account JSON file into this repository,
the extension, `.env`, documentation, test output, or verification artifacts.

### Extension-origin allowlist

After loading the unpacked extension, copy its ID from `chrome://extensions`
into `STREAMSENSE_EXTENSION_ID`. The backend rejects missing origins and every
other extension ID.

For isolated local development only, setting
`STREAMSENSE_ALLOW_ANY_EXTENSION_ORIGIN=true` accepts any syntactically valid
Chrome extension origin. This is deliberately opt-in and must not be used for a
shared or production service: a local process can forge an HTTP `Origin` header.
Keep the backend bound to loopback and restore exact-ID matching after the test.

## Run the backend

Use the stable command for normal runs:

```bash
npm start
```

Use the development command only when automatic Node reload is useful:

```bash
npm run dev
```

The backend listens on `http://127.0.0.1:8000` by default. Keep this terminal
running while using the extension.

## Build and load the Chrome extension

In a second terminal:

```bash
cd chrome-extension
npm install
npm run build
```

Then:

1. Open `chrome://extensions`.
2. Enable **Developer mode**.
3. Choose **Load unpacked** and select `chrome-extension/dist`.
4. Copy the displayed extension ID into the backend `.env`, restart the
   backend, and reload the extension if the ID changed.
5. Pin StreamSense if you want the toolbar action to remain visible.

## Use StreamSense

1. Open an ordinary HTTP or HTTPS tab you want StreamSense to understand.
2. Click the StreamSense toolbar icon. This authorizes that exact tab and opens
   the side panel.
3. Enable the side-panel switch. Chrome may open a dedicated extension page for
   microphone permission the first time; allow it for push-to-talk questions.
4. Focus the side panel, hold `S`, speak, and release to submit, or hold the
   microphone button. The live user transcript and Gemini response appear in
   the chat, and Gemini answers in its native voice. StreamSense may narrate a
   meaningful visual change only while the tab is not speaking.
5. Disable the switch to stop. The captured-tab badge returns from `ON` to
   `OFF` after Chrome reports capture has ended.

Chrome internal pages and the Chrome Web Store cannot be captured. If you
change tabs before starting, click the toolbar icon on the new tab to authorize
it.

## Audio, privacy, and playback behavior

- The microphone and captured-tab audio are processed only while StreamSense is
  running. Stop ends capture, microphone processing, playback, provider
  sessions, timers, and in-memory transcript context.
- Raw microphone and tab audio are streamed for processing and are not stored
  by StreamSense.
- Final captured-tab transcript segments are held only in bounded session
  memory, are never shown as the user's words, and are cleared when the session
  closes. Do not include private transcript text in bug reports.
- Screen frames continue at no more than one frame per second while the session
  runs so Gemini has current visual context.
- While push-to-talk is held, captured-tab playback fades to 0 percent. It
  returns to 30 percent while Gemini answers and to full volume after Gemini's
  local PCM playback queue is idle. Typed questions use the 30-percent answer
  level directly.
- Automatic narration does not lower tab volume and is suppressed or cancelled
  while local tab-audio detection or Cloud Speech-to-Text reports speech.

## Degraded behavior

- If microphone permission is denied, StreamSense reports voice as unavailable;
  typed questions remain available and tab capture continues.
- If the captured tab has no audio track, visual context and user Q&A continue,
  and meaningful-change narration may run during visual silence rules.
- If an audio-bearing tab loses Speech-to-Text health or audio continuity, tab
  speech context is shown as unavailable and automatic narration pauses. User
  Q&A remains available using microphone/typed input and current frames.
- If Gemini Live is connecting or degraded, microphone VAD is disarmed so audio
  is not admitted into an unsafe partial turn. The UI remains stoppable and
  typed input remains visible; affected turns receive a retryable failure.
- Ending the video track or changing the authorized tab stops the realtime
  session. A microphone-only failure degrades voice without ending tab capture.

## Verification

Backend:

```bash
cd ai-voice-realtime
npm test
npm run check
```

Extension:

```bash
cd chrome-extension
npm test
npm run build
```

The backend suite covers strict protocol validation, independent mic/tab audio
routing, request-rate and payload bounds, exact extension-origin enforcement,
Gemini Live resumption, STT rotation, speech policy, teardown races, and real
WebSocket isolation. Automated checks do not replace the real Chrome/provider
acceptance matrix in
`docs/verification/2026-08-04-gemini-live-voice-acceptance.md`.
