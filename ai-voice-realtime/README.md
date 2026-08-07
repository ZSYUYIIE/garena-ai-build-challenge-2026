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

There is no repository-root `package.json`. Run backend commands from
`ai-voice-realtime`, extension commands from `chrome-extension`, and dashboard
commands from `session-dashboard`.

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
| `STREAMSENSE_HISTORY_MODE` | Dashboard history mode: `memory` (default, empty at startup) or development-only `demo`. |
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

Normal startup creates an empty `MemoryHistoryRepository`. Realtime sessions
can add records to it, but those dashboard records are lost whenever the
backend process restarts. The existing SQLite `EventStore` and the dashboard
history repository are distinct persistence boundaries.

## Run the session dashboard without STT

The dashboard REST routes do not create a realtime `ClientSession` and do not
start Gemini or Cloud Speech-to-Text providers. For deterministic dashboard
development, use two terminals from the repository root. No API key, Google
Cloud project, ADC, extension, or WebSocket connection is required for this
workflow.

Terminal 1:

```bash
cd ai-voice-realtime
npm install
npm run start:dashboard-demo
```

Terminal 2:

```bash
cd session-dashboard
npm install
npm run dev
```

Open `http://127.0.0.1:5174/dashboard/`. Vite proxies `/api` requests to this
backend at `127.0.0.1:8000`.

`start:dashboard-demo` sets `STREAMSENSE_HISTORY_MODE=demo`, loads a fixed set
of development sessions into a fresh in-memory repository, and starts the
server. It is rejected when `NODE_ENV=production`. Restarting the process resets
the same deterministic fixture. `STREAMSENSE_HISTORY_MODE=memory` is the normal
default and starts empty; both modes are process-local and non-durable.

`npm run seed:dashboard` is different: it only exports the deterministic
fixture to the Git-ignored `data/dashboard-demo.json` for inspection. It does
not start the server, seed a running process, or make `npm start` load that file.

Durable MongoDB session/event storage, vector embeddings and search, Redis
current context, and production retrieval ranking remain Anson-owned work. The
current branch supplies repository and semantic-adapter boundaries but does not
implement or claim those integrations.

### Serve the built dashboard

Build before starting the backend, because the backend discovers
`session-dashboard/dist` during startup:

```bash
cd session-dashboard
npm install
npm run build

cd ../ai-voice-realtime
npm install
npm run start:dashboard-demo
```

Open `http://127.0.0.1:8000/dashboard/`. Use `npm start` instead of the final
command for the default empty memory mode.

### History REST surface

The backend mounts bounded, same-origin history routes:

- `GET /api/sessions?limit=&cursor=`
- `GET /api/sessions/:sessionId`
- `GET /api/sessions/:sessionId/events?limit=&cursor=&eventType=&eventId=`
- `POST /api/search`
- `GET /api/context-graph?sessionId=&query=&domain=&limit=`

Every successful response includes `meta.dataOrigin`; list responses use
`sessions` or `events` plus nullable `nextCursor`, detail uses `session`, search
uses `results`, `retrievalMode`, and an optional `warning`, and the context graph
uses `nodes` and `edges`. Errors have the stable uppercase envelope
`{"error":{"code":"INVALID_REQUEST","message":"..."}}`. See
[`../session-dashboard/README.md`](../session-dashboard/README.md) for request
and response examples and [`../docs/context-graph-api.md`](../docs/context-graph-api.md)
for graph semantics.

The dashboard additions do not modify the Cloud Speech-to-Text architecture or
its realtime availability rules. This documentation does not claim a physical
Chrome, Gemini, or Cloud Speech-to-Text acceptance run.

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

### Narration consistency and hallucination containment

Visual-fact generation is frame-only. Previous model prose and captured-tab
transcripts are no longer placed in the visual-analysis prompt, preventing one
mistaken topic from becoming evidence for the next frame. Structurally valid
prior visible states remain available only for exact identity-matched state
transitions such as a verified score change.

An atomic result from a superseded frame may still be archived at its original
timestamp, but it cannot be spoken or become grounded context for a newer
request. Self-descriptions and inferred user interactions are rejected before
they reach the state cache or speech policy. Captured-tab transcript overlap is
evaluated locally after the frame result exists; it can mark narration as
already covered but cannot justify an unseen claim.

Every automatic spoken candidate must first receive `status: recorded` from the
SQLite `EventStore` and be published as an `event` message. A duplicate or
failed write does not start speech. Failures emit a bounded user-facing
`analysis_error`; the separate asynchronous dashboard archive remains
best-effort and cannot block realtime publication.

The backend no longer sends the canonical vision sentence as a premature
`narration_update`. Only turn-owned Gemini Live output transcription is sent to
the extension for the **Now describing** text, so the displayed sentence tracks
the audio output rather than the prompt submitted to the generative voice
model.

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

Dashboard:

```bash
cd session-dashboard
npm run check
```

The backend suite covers strict protocol validation, independent mic/tab audio
routing, request-rate and payload bounds, exact extension-origin enforcement,
Gemini Live resumption, STT rotation, speech policy, teardown races, and real
WebSocket isolation. Automated checks do not replace the real Chrome/provider
acceptance matrix in
`docs/verification/2026-08-04-gemini-live-voice-acceptance.md`.

The durable semantic-history handoff is documented in
[`../docs/semantic-history-integration.md`](../docs/semantic-history-integration.md).
