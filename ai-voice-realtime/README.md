# StreamSense Realtime Voice Backend

This is the shared local backend for both StreamSense surfaces: the Live Chrome
side panel uses `/ws`, and the History dashboard uses `/api` plus the optional
built `/dashboard/` route. For realtime sessions it connects to Gemini
Interactions for grounded screen-change analysis, Gemini Live for questions
and native voice replies, and Google Cloud Speech-to-Text V2 for captured-tab
context. When the user selects Deep Research, the backend searches Exa,
finalizes the answer with Gemini Interactions, and immediately sends only its
concise answer body to Gemini Live for native voice playback. Sources remain
visible as links and are not spoken.

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
- An Exa API key to enable the optional Deep Research mode.
- A Google Cloud project with Speech-to-Text V2 enabled and Application
  Default Credentials (ADC) available to the backend process.
- Google Chrome for the extension demo.

The repository root is an npm workspace. Use its lockfile and root scripts for
normal installation, integrated development, builds, demos, and full checks.

## Backend setup

```bash
npm install
cp ai-voice-realtime/.env.example ai-voice-realtime/.env
```

Configure `.env` without committing the populated file:

| Setting | Purpose |
| --- | --- |
| `GOOGLE_API_KEY` | Backend-only Gemini credential used for vision analysis and Live voice. |
| `GEMINI_VISION_MODEL` | Gemini Interactions model used for atomic screen-change analysis. |
| `GEMINI_LIVE_MODEL` | Gemini Live model used for questions, native voice, and approved narration. |
| `EXA_API_KEY` | Backend-only Exa credential used by session-only Deep Research; Normal mode does not require it. |
| `GOOGLE_CLOUD_PROJECT` | Google Cloud project that owns the Speech-to-Text V2 request. |
| `GOOGLE_CLOUD_SPEECH_LOCATION` | Speech-to-Text recognizer location; defaults to `us`. |
| `STREAMSENSE_EXTENSION_ID` | Exact 32-character Chrome extension ID allowed to open the production WebSocket. |
| `STREAMSENSE_HISTORY_MODE` | Dashboard history mode: `memory` (default, empty at startup) or development-only `demo`. |
| `MONGODB_URI` | MongoDB Atlas Drivers connection string for dashboard profiles; keep the populated URI only in `.env` or a secret manager. |
| `MONGODB_DB_NAME` | Database containing the `dashboard_accounts` profile collection; defaults to `streamsense`. |
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

For integrated development, run one of these commands from the repository root:

| Command | Supervised processes |
| --- | --- |
| `npm run dev` | Demo-history backend `8000`, extension `5173`, dashboard `5174`. |
| `npm run dev:realtime` | Empty-history backend `8000`, extension `5173`. |
| `npm run dev:dashboard` | Demo-history backend `8000`, dashboard `5174`. |

Every profile preflights its fixed ports and starts exactly one backend. Do not
start a package-scoped server at the same time.

Before using the dashboard Account route, configure a MongoDB Atlas cluster:

1. In Atlas, create a dedicated database user. This is not the email or
   password used to sign in to MongoDB Cloud.
2. Add only the backend operator's current public IP to the Atlas network
   access list. Avoid an unrestricted `0.0.0.0/0` rule.
3. Choose **Connect > Drivers > Node.js**, copy the SRV connection string, and
   replace its username and password placeholders. URL-encode special
   characters in the database password.
4. Put that value in `MONGODB_URI` inside this package's ignored `.env`, keep
   `MONGODB_DB_NAME=streamsense`, and restart the backend. Never put the
   populated URI in source, documentation, browser storage, or frontend code.

MongoDB does not issue a separate StreamSense key: the Drivers URI itself
contains database credentials. Teammates must use their own Atlas project
invitation, narrowly scoped IP access, and personal database user. Follow
[`../docs/mongodb-atlas-handoff.md`](../docs/mongodb-atlas-handoff.md) rather
than sharing an existing URI.

For offline development only, the repository still provides a loopback Docker
service. Start it with `docker compose up -d mongodb` and use
`MONGODB_URI=mongodb://localhost:27017` instead of the Atlas SRV URI.

Profiles are stored in `dashboard_accounts` with unique account ID and
normalized-email indexes. Atlas is the primary persistence path; the local
container is an optional offline substitute using the same repository
contract. The backend exposes create/read/update operations at `/api/accounts`;
it never stores passwords or provider credentials. Without a MongoDB URI, or
when Atlas cannot be reached, those endpoints return `503` while history and
realtime routes remain available.

For an intentionally backend-only stable run:

```bash
npm start --workspace ai-voice-realtime
```

For backend-only automatic Node reload:

```bash
npm run dev --workspace ai-voice-realtime
```

The backend listens on `http://127.0.0.1:8000` by default. Keep this terminal
running while using the extension.

### Normal and Deep Research answers

Both answer modes share one visible chat, and the extension sends the selected
mode as session configuration. The backend snapshots that mode when a typed or
microphone turn is admitted. Normal mode follows the existing persistent Gemini
Live session. Deep Research does not ask Live to generate its answer: it uses
non-live Gemini Interactions to resolve the query, Exa to retrieve
public sources, and Gemini Interactions to produce the final cited answer. The
backend appends a deterministic linked source list, then immediately asks the
existing Gemini Live session to speak only the concise answer body. Inline
citations and linked sources are excluded from speech. Spoken deep questions
are transcribed through the same non-live path.
The Live connection stays open and resumes its existing Normal-mode context
when Normal is selected again.
For playback diagnosis, the side panel can replay the bounded, session-cached
research summary through Gemini Live. This manual turn emits audio without
another chat answer and the cache is cleared at close.
Queries, progress, results, and answers are not written to MongoDB or the
history repository by this flow.

Normal package startup and the root `dev:realtime` profile create an empty
`MemoryHistoryRepository`. The root `dev` and `dev:dashboard` profiles instead
load the development-only deterministic seed. Realtime sessions can add records
to either repository, but those dashboard records are lost whenever the backend
process restarts. The existing SQLite `EventStore` and the dashboard history
repository are distinct persistence boundaries.

## Run the session dashboard without STT

The dashboard REST routes do not create a realtime `ClientSession` and do not
start Gemini or Cloud Speech-to-Text providers. For deterministic dashboard
development, use the root profile. No API key, Google Cloud project, ADC,
extension, or WebSocket connection is required merely to browse its fixture.

```bash
npm run dev:dashboard
```

Open `http://127.0.0.1:5174/dashboard/`. Vite proxies `/api` requests to this
single demo backend at `127.0.0.1:8000`.

`start:dashboard-demo` sets `STREAMSENSE_HISTORY_MODE=demo`, loads five named
judge-facing sessions with five events each into a fresh in-memory repository,
and starts the server. The root `dev` and `dev:dashboard` profiles both use this
entry point so the relationship graph is meaningful on first load. It is
rejected when `NODE_ENV=production`. Restarting the process resets the same
deterministic fixture. `STREAMSENSE_HISTORY_MODE=memory` remains the normal
package and production default and starts empty; both modes are process-local
and non-durable.

`npm run seed:dashboard --workspace ai-voice-realtime` is different: it only
exports the deterministic
fixture to the Git-ignored `data/dashboard-demo.json` for inspection. It does
not start the server, seed a running process, or make `npm start` load that file.

MongoDB profile persistence is implemented independently and does not make
dashboard session history durable. When MongoDB is configured, each accepted
event is also copied on a best-effort basis with a 768-dimensional embedding;
Live typed prompts can retrieve up to five matches from the current session.
That prototype path is not the dashboard's semantic-search adapter. Durable
per-user history, Redis current context, and production retrieval ranking remain
separate integration work.

### Serve the built one-backend demo

```bash
npm run demo
```

The root command builds both frontends, then starts exactly one demo-history
backend. Open `http://127.0.0.1:8000/dashboard/`; no Vite server is involved.
Load the generated `chrome-extension/dist` if you also want the Live surface.
Dashboard-only browsing does not initialize provider sessions, but it is not
physical Gemini or Cloud Speech-to-Text acceptance.

### History REST surface

The backend mounts bounded, same-origin history routes:

- `GET /api/sessions?limit=&cursor=`
- `GET /api/sessions/:sessionId`
- `GET /api/sessions/:sessionId/events?limit=&cursor=&eventType=&eventId=`
- `POST /api/search`
- `GET /api/context-graph?sessionId=&query=&domain=&limit=`

Sessions with no archived events remain available from the session endpoints,
but are omitted from the context graph until their first event is recorded.
This prevents generic zero-information nodes while preserving session history.

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

From the repository root:

```bash
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
   the chat, and Gemini answers in its native voice. Press `N` to cycle the
   side panel's Smart narration, Narrate over audio, and Narration only modes.
5. Disable the switch to stop. The captured-tab badge returns from `ON` to
   `OFF` after Chrome reports capture has ended.
6. Select **View History** to open the dashboard. The full `npm run dev`
   profile targets port `5174`; the built demo uses the backend route on port
   `8000`.

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
- Smart narration leaves tab playback at full volume and is suppressed or
  cancelled while local tab-audio detection or Cloud Speech-to-Text reports
  speech.
- Narrate over audio allows a newly recorded event to be spoken during tab
  speech and lowers local tab playback to 40 percent only during that
  narration. Narration only keeps local tab playback at 0 percent. Neither mode
  stops captured-tab PCM from reaching the separate Speech-to-Text path.
- Voice narration mode is independent from Narration level. Question only
  suppresses automatic voice in every mode without stopping timeline events.

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

```bash
npm run check
```

The root gate runs orchestration tests, backend checks, extension tests/build,
and dashboard tests/typecheck/build. Focused backend iteration can use
`npm run check --workspace ai-voice-realtime`.

The backend suite covers strict protocol validation, independent mic/tab audio
routing, request-rate and payload bounds, exact extension-origin enforcement,
Gemini Live resumption, STT rotation, speech policy, teardown races, and real
WebSocket isolation. Automated checks do not replace the real Chrome/provider
acceptance matrix in
`docs/verification/2026-08-04-gemini-live-voice-acceptance.md`.

The durable semantic-history handoff is documented in
[`../docs/semantic-history-integration.md`](../docs/semantic-history-integration.md).
