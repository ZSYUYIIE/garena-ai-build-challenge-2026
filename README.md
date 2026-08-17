# StreamSense

StreamSense is one accessibility product with two connected user surfaces:

- **StreamSense Live** — a Chrome side panel that watches an explicitly
  authorized tab, narrates meaningful visual changes, maintains the current
  timeline, and accepts text or voice questions.
- **StreamSense Memory** — a browser dashboard for reviewing those same saved
  sessions, searching past moments, and exploring their relationships in an
  accessible Three.js map.

Both surfaces use one Express/WebSocket backend. Live sends frames and separate
microphone/tab-audio streams over `/ws`; Memory reads bounded REST resources
under `/api`. The backend returns the real session UUID during the extension
handshake, so **Open Memory Dashboard** opens the exact session being captured.

```text
Authorized browser tab
  -> Chrome side panel -- frames + separate mic/tab PCM --> backend
  -> backend --> Gemini visual and Live models
  -> backend --> Cloud Speech-to-Text V2 for tab commentary
  -> backend --> SQLite local event evidence
  -> backend -- asynchronous upsert --> MongoDB sessions + events
  -> backend -- recorded protocol-v2 event --> side-panel timeline
  -> side panel -- exact event description --> Chrome / OS TTS

Side panel -- Open Memory Dashboard --> Memory dashboard -- REST --> backend
Memory dashboard --> durable MongoDB-backed sessions, events, search, and graph
```

Raw microphone and captured-tab audio are not stored. Only microphone audio is
user input; captured-tab audio is untrusted commentary context.

## Repository layout

| Directory | Purpose |
| --- | --- |
| `chrome-extension/` | Manifest V3 Live side panel, tab capture, push-to-talk, timeline TTS, and Gemini answer playback. |
| `ai-voice-realtime/` | Shared Express/WebSocket backend, AI providers, SQLite evidence, MongoDB history, search, and REST APIs. |
| `session-dashboard/` | Accessible Memory dashboard, session timeline, semantic search, account preferences, and Three.js relationship map. |
| `docs/` | Current architecture, API contracts, Atlas handoff, and verification notes. |

The repository root is an npm workspace and the supported entry point for
installation, development, builds, demonstrations, and checks.

## Prerequisites

- Node.js `20.19+` or `22.12+` and npm.
- Google Chrome.
- A Gemini API key for visual analysis, Live questions/answers, embeddings, and
  Deep Research composition.
- A Google Cloud project with Speech-to-Text V2 enabled and Application Default
  Credentials available to the backend.
- A MongoDB Atlas cluster for durable sessions/events, semantic retrieval, and
  dashboard profiles. The included loopback Docker service is an optional local
  substitute.
- An Exa API key only when the optional Deep Research answer mode is used.

## Install and build

From the repository root:

```bash
npm install
npm run build
```

The build writes the unpacked extension to `chrome-extension/dist` and the
Memory assets to `session-dashboard/dist`.

Load the extension from `chrome://extensions`:

1. Enable **Developer mode**.
2. Select **Load unpacked**.
3. Choose `chrome-extension/dist`.
4. Copy the resulting 32-character extension ID into the backend's ignored
   local environment configuration.
5. Reload this same unpacked extension after every extension rebuild.

## Provider configuration

The backend expects these settings in its local ignored environment:

| Setting | Purpose |
| --- | --- |
| `GOOGLE_API_KEY` | Gemini visual analysis, Live questions/answers, embeddings, and Deep Research composition. |
| `GEMINI_VISION_MODEL` | Non-live Gemini model used for grounded frame analysis and non-live composition. |
| `GEMINI_LIVE_MODEL` | Gemini Live model used for conversational voice questions and answers. |
| `EXA_API_KEY` | Optional public-web retrieval for Deep Research. |
| `GOOGLE_CLOUD_PROJECT` | Project used by Cloud Speech-to-Text V2. |
| `GOOGLE_CLOUD_SPEECH_LOCATION` | Speech recognizer location; defaults to `us`. |
| `STREAMSENSE_EXTENSION_ID` | Exact unpacked extension ID allowed to connect to `/ws`. |
| `MONGODB_URI` | Atlas Drivers SRV URI or `mongodb://localhost:27017` for the optional local store. |
| `MONGODB_DB_NAME` | Mongo database name; defaults to `streamsense`. |
| `STREAMSENSE_HISTORY_MODE` | `auto` (default), `mongodb`, or `memory`. A configured Mongo URI always selects durable Memory; `mongodb` additionally fails startup when the URI is absent. |
| `HOST` / `PORT` | Backend bind address; defaults to `127.0.0.1:8000`. |

Do not commit provider keys, a populated Mongo URI, service-account files, or
Application Default Credentials.

### Google Cloud Speech-to-Text

Use separate CLI and Application Default Credential logins:

```bash
gcloud auth login
gcloud config set project YOUR_PROJECT_ID
gcloud services enable speech.googleapis.com --project=YOUR_PROJECT_ID
gcloud auth application-default login
gcloud auth application-default set-quota-project YOUR_PROJECT_ID
```

The Gemini API key does not authenticate Cloud Speech-to-Text.

### MongoDB

For Atlas, create a dedicated database user, allow only the backend operator's
current IP, and copy the Node.js Drivers SRV value. Follow
[`docs/mongodb-atlas-handoff.md`](docs/mongodb-atlas-handoff.md).

For an optional loopback-only local store:

```bash
docker compose up -d mongodb
```

Use `mongodb://localhost:27017`. When MongoDB is configured, the backend uses:

- `sessions` — durable session metadata and aggregates;
- `events` — one document per real event, shared by chronological history and
  embedding enrichment;
- `dashboard_accounts` — prototype dashboard profile records.

SQLite remains the fast local evidence store. A Mongo failure must not retract
a timeline event that was already accepted into SQLite and published to Live.

## Run StreamSense

Normal integrated development:

```bash
npm run dev
```

This starts exactly one backend on `8000`, the extension Vite process on `5173`,
and the Memory dashboard on `5174`. It does **not** seed synthetic sessions.
Memory loads persisted MongoDB history when configured, otherwise it starts
empty and uses the in-memory fallback for that process only.

Dashboard-only development:

```bash
npm run dev:dashboard
```

Realtime-only development:

```bash
npm run dev:realtime
```

Built one-backend presentation profile:

```bash
npm run demo
```

`demo` builds both user surfaces and starts the normal backend. Open
`http://127.0.0.1:8000/dashboard/` and load `chrome-extension/dist`. It uses real
persisted history and has no synthetic history runtime path.

## Live-to-Memory flow

1. Open an ordinary HTTP/HTTPS page with a video.
2. Click the StreamSense toolbar icon to authorize that exact tab and open Live.
3. Turn on StreamSense.
4. Let a grounded event appear in the side-panel timeline.
5. Select **Open Memory Dashboard**.
6. The dashboard opens `/dashboard/sessions/{sessionId}` and polls the bounded
   session, event, and relationship APIs every two seconds while open.
7. Stop StreamSense and restart the backend. With MongoDB configured, the same
   session and event remain available.

Existing sessions shown to judges should be real sessions previously captured
by StreamSense, not invented records.

## Questions and narration

- **Text question:** enter a question and send it.
- **Voice question:** focus the side panel, hold `S`, speak, and release; the
  microphone button provides the same action.
- **Normal answer:** uses the persistent Gemini Live session.
- **Deep Research:** uses Gemini + Exa for cited public-web context, then asks
  Gemini Live to speak the concise answer body.
- **Voice narration modes:** Smart, Narrate over audio, and Narration only.
  Question only under Narration level disables automatic timeline speech while
  retaining events and questions.

Automatic event speech is owned by Chrome/OS TTS. Every automatic utterance is
based on the exact event already recorded into the timeline; Gemini Live is not
used to invent or synthesize automatic timeline events.

## StreamSense Memory

Primary routes:

- `/dashboard/` — durable session overview and multi-domain relationship map;
- `/dashboard/sessions/:sessionId` — session summary, relationship map, and
  chronological events;
- `/dashboard/search` — semantic search over real history events;
- `/dashboard/account` — prototype MongoDB-backed profile preferences.

The relationship map uses the hierarchy Memory → domain → session → event →
entity/topic. In the multi-domain view, X represents stream progress, Y event
importance, and Z entertainment domain. Session-scoped views use an honest 2D
progress × importance projection when only one lane is meaningful. Every WebGL
relationship also has a keyboard- and screen-reader-readable DOM alternative.

## Data guarantees and limits

- A real accepted event is inserted into SQLite before it is published.
- History archiving is asynchronous, bounded, retried for transient failures,
  and cannot block the realtime response path.
- Mongo history and embedding enrichment upsert the same `events` document by
  event ID, preserving each other's fields even when their first writes race.
- Dashboard APIs are bounded and paginated.
- The dashboard is not a second realtime WebSocket client; it uses REST polling
  only for the active session page.
- Without MongoDB, history is intentionally process-local and disappears on
  restart.
- The current profile is not production authentication and does not yet assign
  separate session ownership to multiple users.

## Verification

Run the repository gate:

```bash
npm run check
```

Then perform the physical integration acceptance with configured providers and
MongoDB:

```text
start with real MongoDB history
-> start Live
-> record a real event
-> open the exact Memory session
-> confirm the event appears
-> stop and restart the backend
-> confirm session, timeline, search, and graph still work
```

Automated tests do not replace physical Chrome, Gemini, Cloud STT, TTS, Atlas,
or HDMI presentation acceptance.

## Troubleshooting

### Memory is empty after startup

Confirm `MONGODB_URI` and `MONGODB_DB_NAME`, restart the backend, and read the
`Memory history provider` startup line. With no Mongo URI, Memory deliberately
uses an empty in-memory fallback.

### Memory disappears after restart

The backend did not use MongoDB history. Confirm the Mongo URI is present and
reachable. `STREAMSENSE_HISTORY_MODE=mongodb` can be used to fail startup
explicitly when MongoDB is absent.

### Open Memory Dashboard shows 404

During full development use `npm run dev`, which starts the dashboard on `5174`.
For the built profile, run `npm run build` or `npm run demo` so the backend can
serve `session-dashboard/dist` under `/dashboard/`.

### Cloud speech context is unavailable

Confirm `speech.googleapis.com`, the selected project, ADC quota project, and
backend restart. Text/microphone questions and Chrome timeline TTS have separate
degraded behavior.

### Ports are occupied

The supervised runner uses strict ports `8000`, `5173`, and `5174` and exits
instead of silently choosing another. Stop the existing process and retry.

## Security and privacy

- Raw microphone and captured-tab audio are streamed and discarded.
- Captured-tab transcript context is bounded and cleared with the session.
- MongoDB stores structured session/event records, embeddings, and prototype
  profile data—not raw media.
- Browser account storage contains only the opaque account UUID.
- Keep the backend on loopback unless authentication, transport security, and a
  production origin policy are added.

See [`docs/architecture.md`](docs/architecture.md),
[`ai-voice-realtime/README.md`](ai-voice-realtime/README.md),
[`chrome-extension/README.md`](chrome-extension/README.md), and
[`session-dashboard/README.md`](session-dashboard/README.md) for package-level
details.
