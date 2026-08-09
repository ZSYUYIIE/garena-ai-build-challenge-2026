# StreamSense

StreamSense is one local accessibility product with two user surfaces: a Chrome
side panel for live assistance and a browser dashboard for saved history. The
side panel watches an explicitly authorized tab, describes meaningful visual
changes, builds a timestamped event timeline, and lets the user ask questions
by text or voice. Clicking the toolbar always opens this Live side panel. Its
**Open Memory Dashboard** action opens the current session's Memory view in a
normal Chrome tab.

Both surfaces use the same local backend. The extension uses its protocol-v2
WebSocket for realtime work, while the dashboard uses bounded REST endpoints.
The backend includes the current session UUID in its validated connection
acknowledgement, so the extension can hand the exact saved session to Memory.
This is shared-backend connectivity, not a second realtime client in the
dashboard.

The dashboard also includes a MongoDB-backed prototype Account route for a
display name, email, and viewing preferences. The browser stores only the
opaque account UUID; this is not password-based production authentication. It
does not alter the extension's capture, speech recognition, Gemini, narration,
interruption, or playback pipeline.

```text
Authorized browser tab
  -> Chrome side panel -- frames + separate mic/tab PCM --> backend
  -> backend --> Gemini visual and Live models
  -> backend --> Cloud Speech-to-Text V2 for tab commentary
  -> backend --> SQLite evidence + in-memory history projection
  -> backend -- best-effort semantic event copies --> MongoDB
  -> backend -- recorded protocol-v2 event --> side-panel timeline
  -> side panel -- exact event description --> Chrome / OS TTS

Side panel -- Open Memory Dashboard --> Memory dashboard -- REST --> backend
Memory dashboard -- account REST --> backend --> MongoDB profiles
```

Microphone audio and captured-tab audio remain separate. Only microphone audio
is treated as user input by Gemini. Captured-tab audio is transcribed for media
context and is never presented as the user's speech.

## Repository layout

| Directory | Purpose |
| --- | --- |
| `chrome-extension/` | Manifest V3 extension, side-panel UI, tab capture, push-to-talk, Chrome timeline TTS, and Gemini answer playback. |
| `ai-voice-realtime/` | Express and WebSocket backend, Gemini Interactions/Live clients, Cloud Speech-to-Text, and event storage. |
| `session-dashboard/` | Accessible React dashboard for previous sessions, timeline search, and context exploration. |
| `docs/` | Current architecture/API guides, integration handoffs, historical design records, and verification material. |

The repository root is an npm workspace and the supported starting point for
installing, developing, building, demonstrating, and checking all three
packages.

## Architecture and contributor guidance

[`docs/README.md`](docs/README.md) is the documentation index and authority
map. [`docs/architecture.md`](docs/architecture.md) is the current
cross-package architecture and product-direction reference.
[`AGENTS.md`](AGENTS.md) defines
the product boundaries, safety rules, Git workflow, and verification contract
that AI coding agents and human reviewers should enforce. Tool-specific entry
points—[`CLAUDE.md`](CLAUDE.md), [`GEMINI.md`](GEMINI.md), and
[`.github/copilot-instructions.md`](.github/copilot-instructions.md)—direct
other assistants to the same source of truth instead of duplicating rules.

Current product direction keeps the extension focused on live assistance and
the dashboard focused on memory. The dashboard now uses one accessible visual
theme, MongoDB persists prototype profiles, and session history remains behind
an in-memory repository boundary. Near-term ideas are a judge-ready sports or
esports terminology pack, durable per-user history after production identity,
multilingual narration, explicit retention/deletion controls, and a
deterministic provider-failure demo path. These ideas are tracked as future
work—not as implemented features—in the architecture document.

## Prerequisites

- macOS, Linux, or Windows with Google Chrome.
- Node.js `20.19+` or `22.12+` and npm.
- A Gemini API key with access to the configured Interactions and Live models;
  the backend also uses it for semantic embeddings when MongoDB context storage
  is configured.
- An Exa API key only when using the optional Deep Research answer mode.
- A Google Cloud project with billing configured for Speech-to-Text V2.
- The [Google Cloud CLI](https://cloud.google.com/sdk/docs/install) (`gcloud`).
- A MongoDB Atlas cluster for dashboard profiles and semantic event retrieval.
  Docker Desktop is optional when an offline local store is preferred.

The Gemini and Google Cloud requirements apply to the realtime extension. The
deterministic session-dashboard workflow below requires only Node.js and npm.

## 1. Install dependencies

From the repository root (`D:\Work\garena-ai-build-challenge-2026` on the
example Windows checkout):

```bash
npm install
npm run build
```

On Windows PowerShell, `npm.cmd install` and `npm.cmd run build` are equivalent
if the `npm` shim is unavailable. The workspace install uses the root lockfile.
The build writes the unpacked extension to `chrome-extension/dist` and the
dashboard assets to `session-dashboard/dist`.

The root `.npmrc` currently sets `ignore-scripts=true` because the pinned
dependencies used by this prototype include the required runtime artifacts and
do not need native install hooks. Review that setting before adding a package
that genuinely requires an `install` or `postinstall` script.

## 2. Load the Chrome extension

1. Open `chrome://extensions`.
2. Enable **Developer mode**.
3. Select **Load unpacked**.
4. Choose this repository's `chrome-extension/dist` directory.
5. Copy the exact 32-character extension ID displayed by Chrome. You will add
   it to the backend environment in step 4.
6. Optionally pin the extension to the Chrome toolbar.

After rebuilding, select **Reload** on this extension in
`chrome://extensions`. Keep loading the same `dist` path so its unpacked
extension ID remains stable.

## 3. Configure Google Cloud Speech-to-Text

Replace `YOUR_GOOGLE_ACCOUNT` and `YOUR_PROJECT_ID` below. Run the commands in
this order; the CLI login and Application Default Credentials login are
separate and both are required for the full setup.

### 3.1 Sign in to the Google Cloud CLI

```bash
gcloud auth login
```

Complete the browser sign-in, then confirm that the intended account is marked
`ACTIVE`:

```bash
gcloud auth list
```

If the correct account is already listed but is not active, select it:

```bash
gcloud config set account YOUR_GOOGLE_ACCOUNT
```

### 3.2 Select and verify the Google Cloud project

```bash
gcloud config set project YOUR_PROJECT_ID
gcloud config get-value project
```

The final command must print the same `YOUR_PROJECT_ID` you intend to place in
`GOOGLE_CLOUD_PROJECT`.

### 3.3 Enable Cloud Speech-to-Text V2

```bash
gcloud services enable speech.googleapis.com \
  --project=YOUR_PROJECT_ID
```

Confirm that the API is enabled:

```bash
gcloud services list --enabled \
  --project=YOUR_PROJECT_ID \
  --filter="name:speech.googleapis.com"
```

The output should contain `speech.googleapis.com`. If the enable command is
denied, the selected account needs permission to enable services in that
project, such as the Service Usage Admin role.

### 3.4 Create Application Default Credentials

```bash
gcloud auth application-default login
```

Complete the second browser sign-in. This writes local ADC outside the
repository; on macOS the usual location is
`~/.config/gcloud/application_default_credentials.json`.

### 3.5 Assign the ADC quota project

```bash
gcloud auth application-default set-quota-project YOUR_PROJECT_ID
```

Expected success output includes:

```text
Quota project "YOUR_PROJECT_ID" was added to ADC
```

If you previously saw a warning that the active project did not match the ADC
quota project, this command resolves it. The account needs the
`serviceusage.services.use` permission on the quota project.

The complete command sequence, without the explanatory checks, is:

```bash
gcloud auth login
gcloud config set account YOUR_GOOGLE_ACCOUNT
gcloud config set project YOUR_PROJECT_ID
gcloud services enable speech.googleapis.com \
  --project=YOUR_PROJECT_ID
gcloud auth application-default login
gcloud auth application-default set-quota-project YOUR_PROJECT_ID
```

`gcloud config set account` can be omitted when `gcloud auth login` already
made the correct account active.

The two authentication stores serve different purposes:

- `gcloud auth login` selects the CLI account used to enable services.
- `gcloud auth application-default login` creates Application Default
  Credentials (ADC) used by the Node.js Speech-to-Text client.

The Gemini API key does not replace ADC for Cloud Speech-to-Text. Do not put a
service-account JSON file or the generated ADC file in this repository.

## 4. Configure the backend environment

```bash
cp ai-voice-realtime/.env.example ai-voice-realtime/.env
```

Edit `ai-voice-realtime/.env`:

```dotenv
GOOGLE_API_KEY=your_real_gemini_api_key

GEMINI_VISION_MODEL=gemini-3.6-flash
GEMINI_LIVE_MODEL=gemini-3.1-flash-live-preview
EXA_API_KEY=your_exa_api_key

GOOGLE_CLOUD_PROJECT=YOUR_PROJECT_ID
GOOGLE_CLOUD_SPEECH_LOCATION=us

STREAMSENSE_EXTENSION_ID=the_exact_32_character_id_from_chrome
STREAMSENSE_ALLOW_ANY_EXTENSION_ORIGIN=false
STREAMSENSE_HISTORY_MODE=memory

MONGODB_URI=mongodb+srv://YOUR_ATLAS_DB_USER:YOUR_URL_ENCODED_PASSWORD@YOUR_ATLAS_CLUSTER_HOSTNAME/?retryWrites=true&w=majority&appName=StreamSense
MONGODB_DB_NAME=streamsense

HOST=127.0.0.1
PORT=8000
```

`STREAMSENSE_EXTENSION_ID` must be the actual ID from `chrome://extensions`;
values such as `true`, an extension name, or a placeholder will be rejected.
Keep the Gemini API key in the backend only—never add it to extension code or a
`VITE_` variable.

`GEMINI_VISION_MODEL` names the non-live Interactions model. The backend uses
that same model for atomic visual analysis and for Deep Research query
rewriting, answer synthesis, and microphone-question transcription. Automatic
timeline speech still uses Chrome/OS TTS, not this model.

For isolated local debugging, `STREAMSENSE_ALLOW_ANY_EXTENSION_ORIGIN=true`
temporarily relaxes the extension-origin check. Do not use that setting for a
shared or production backend.

MongoDB Atlas stores prototype profiles and the session-scoped semantic event
index used to add earlier moments to Live prompts. In Atlas, create a dedicated
database user (separate from the MongoDB Cloud sign-in), allow only the current
backend operator IP, and copy the Node.js SRV value from **Connect > Drivers**.
Replace every URI placeholder, URL-encode special characters in the database
password, and keep the populated URI only in the ignored backend `.env` or a
deployment secret manager. Do not use an unrestricted network access rule.
For a least-privilege teammate setup, use the
[Atlas handoff guide](docs/mongodb-atlas-handoff.md); StreamSense has no
separate MongoDB key, and teammates must create their own database user and URI.

For offline development only, start the root-level loopback service with
`docker compose up -d mongodb` and use
`MONGODB_URI=mongodb://localhost:27017`. Its `streamsense-mongodb` Docker volume
keeps prototype account records and semantic event copies across container
restarts; it does not make the in-memory Memory projection durable. If
`MONGODB_URI` is
omitted, the rest of StreamSense starts and account endpoints return `503`
instead of falling back to browser-only profile storage. If a configured URI
cannot be reached during the initial account-repository connection, backend
startup fails so an operator does not unknowingly run with a broken configured
database. Later semantic event-copy failures remain best-effort and do not
block the recorded realtime timeline.

## 5. Start StreamSense

For normal development, run one command from the repository root:

```bash
npm run dev
```

This supervised profile starts exactly one development-only, demo-seeded
in-memory backend on port `8000`, the extension development process on `5173`,
and the dashboard on `5174`. The seed provides one named Sports, Esports,
Concert, Product launch, and Creator livestream session with five moments each,
so every semantic lane is useful before the first live capture. New extension
sessions can appear alongside those examples. It checks
that all required ports are free before starting. Press Ctrl+C once to stop the
process group.

Then in Chrome:

1. Open a normal `http://` or `https://` page containing the video or content
   you want to understand. Chrome internal pages and the Chrome Web Store cannot
   be captured.
2. Click the StreamSense toolbar icon. This authorizes that exact tab and opens
   the side panel.
3. Turn on **StreamSense** in the panel.
4. If Chrome opens the StreamSense microphone-permission page, select
   **Allow microphone**, then return to the captured tab.
5. Let the video play. Meaningful visual changes appear in the timeline and may
   be narrated according to the separate Narration level and Voice narration
   settings.
6. Select **Open Memory Dashboard** inside the side panel. The toolbar icon
   itself always opens the side panel and never bypasses it to open Memory.
   While a session is active, the extension opens
   `http://127.0.0.1:5174/dashboard/sessions/{sessionId}?source=extension`.
   Without an active session it opens
   `http://127.0.0.1:5174/dashboard/?source=extension` instead.

An active-session page opened from the extension refetches its session,
timeline, and relationship REST resources every two seconds while that page is
open. This bounded polling helps newly archived moments appear, but it is not a
WebSocket, push channel, or guaranteed live subscription. Live capture,
narration, questions, and interruption controls remain in the extension side
panel.

If you switch to another tab, click the toolbar icon on that new tab to
authorize it before starting again.

## Asking questions

- **Text:** Enter a question and select the arrow/send button.
- **Voice:** Click inside the side panel so it has keyboard focus, hold `S`,
  speak, and release `S` to submit. Holding the microphone button works too.
- **Narration mode:** Press `N` while the side panel has focus to cycle Smart
  narration, Narrate over audio, and Narration only. The shortcut is ignored
  while editing a form field, while a modifier is held, or on key repeat.
- The user's live transcript and Gemini's response appear in the chat above the
  input, while Gemini's native audio response plays through Chrome.

While push-to-talk is held, captured-tab playback fades to 0% so the microphone
hears the user rather than the computer. On release it returns to 30% while
Gemini replies, then to 100% after playback finishes. Muting playback does not
stop screen capture or the separate captured-tab transcription stream.

Voice narration is independent from Narration level. Smart narration speaks
only after the extension's local tab-activity detector has reported 750
milliseconds of continuous silence. Narrate over audio speaks a newly recorded
timeline event while the tab continues at 40 percent volume only during the
Chrome TTS lifecycle. Narration only keeps local tab playback muted for the
session while capture and tab transcription continue. Selecting Question only
under Narration level disables Chrome timeline TTS in all three Voice narration
modes without suppressing timeline events.

Automatic timeline speech uses installed Chrome/OS voices with a calm English
profile: StreamSense prefers Alex, then Samantha, then another compatible
English voice, and supplies `en-US`, rate `0.9`, and pitch `0.9`. If voice
discovery fails, Chrome still receives the language, rate, and pitch while
choosing the compatible fallback. This profile does not change Gemini Live's
voice for questions or Deep Research answers.

## Grounded narration and timeline behavior

Automatic narration now follows one fail-closed path:

1. Gemini Interactions analyzes the current admitted frame without receiving a
   previous generated description or captured-tab transcript as visual
   evidence.
2. StreamSense rejects self-descriptions, inferred user actions, and results
   from a frame that has already been superseded.
3. The accepted moment must be recorded and published to the current-session
   timeline. The side panel then deduplicates and inserts the new event before
   offering its exact recorded description to Chrome/OS TTS. If local event
   persistence fails, the panel shows a warning and skips that narration.
4. Captured-tab transcript is compared only after the visual fact is grounded,
   so it may suppress a redundant description but cannot create one.

Gemini Live does not synthesize automatic timeline events. It remains available
for Normal questions and native answers plus the existing Deep Research voice
path. Typed and microphone questions interrupt Chrome timeline TTS and clear
pending work before admission; events arriving while a user answer owns speech
remain visible but are not replayed. Reload the unpacked extension after
rebuilding; the manifest requires the consumer permission `tts` and never
`ttsEngine`.

## Memory dashboard development without Speech-to-Text

The full `npm run dev` profile and the dashboard-only profile both load the
same deterministic demo history. To browse it without opening the extension or
creating a realtime WebSocket session, run:

```bash
npm run dev:dashboard
```

Open `http://127.0.0.1:5174/dashboard/`. Vite serves the React application on
port `5174` and proxies `/api` to the one demo backend on port `8000`.

`start:dashboard-demo` is an explicit development-only mode used by both root
profiles. It seeds a fresh in-memory repository every time the backend starts
and is refused when `NODE_ENV=production`. `npm run dev:realtime`, normal
`npm start`, and production startup retain an empty in-memory history
repository. Neither history mode is durable: dashboard sessions are lost at
process restart. Account profiles persist in MongoDB. Accepted event evidence
still writes to SQLite and is also copied to MongoDB on a best-effort basis with
768-dimensional embeddings for session-scoped Live prompt retrieval. Durable
per-user dashboard history, Redis current context, and production identity and
retention controls remain separate integration work.

Memory now leads with an optional Three.js relationship map before the recent
session list. The former `/dashboard/explore` URL is a compatibility redirect:
a valid `sessionId` goes to that session's `#relationships` section, otherwise
it returns to the Memory overview. Relationship exploration is therefore part
of Memory and each session, rather than a separate product area.

The map renders every session, event, entity, and topic as a sphere. Color
groups content into labeled entertainment lanes; visual role and size provide
non-color cues. One derived StreamSense Memory root is largest, followed by
smaller domain roots, double-halo sessions, events, and context spheres. Event
size represents supplied importance, and entity/topic size represents supplied
event connections. The client never invents a missing relationship.

A session remains available in the chronological session list immediately
after capture starts, but it enters the relationship graph only after its first
event is archived. This avoids rendering generic empty session spheres that
have no useful relationship to inspect.

The unfiltered overview always reserves the five canonical entertainment lanes
and uses three semantic dimensions: X is normalized stream progress, Y is
supplied moment importance, and Z is the entertainment lane. Empty lanes are
labeled **No saved sessions** and add no fake records. Actual unclassified
history receives a sixth **Other entertainment** lane. A compact status reports
sessions, moments, and populated lanes; the full explanation remains available
to screen readers and in the details below the canvas.
Structural Memory/domain/session roots sit before the measured event region and
do not receive fake numeric values. Context sits near the weighted centroid of
its connected events; cross-domain context falls between the lanes it connects.
Explicitly domain-filtered and session-scoped single-lane maps switch to the
honest progress × importance 2D projection and disable orbit. Buttons restore
named semantic comparisons,
zoom, and framing instead of raw axis directions. Priority-based label collision
handling keeps dense selections readable without hiding the DOM relationship
list. The labeled-node selector and semantic details sit below the full-width
canvas, session pages include complete readable lists, and WebGL failure
preserves those alternatives.

The Memory dashboard imports the extension's actual design tokens and shared
button, input, label, and select primitives. Wider-page layout and WebGL styles
remain dashboard-specific; the extension source and its visual design are not
modified.

Dashboard shortcuts have visible equivalents: `Ctrl+K` opens and focuses
Memory search; `Alt+H` opens Memory; `Alt+G` focuses the graph selector;
and `Alt+/` opens shortcut help (`Escape` closes it). The dashboard uses one
shared accessible theme rather than a separate visual mode. It also provides a
skip link, visible focus, route-focus management, OS forced-colors support, and
reduced-motion behavior that disables camera easing and minimizes CSS motion.

For an inspectable copy of the deterministic fixture, run the package-scoped
utility:

```bash
npm run seed:dashboard --workspace ai-voice-realtime
```

That command writes the Git-ignored
`ai-voice-realtime/data/dashboard-demo.json`. It does not start the backend,
populate a running process, or change what `npm start` loads.

### Serve a built one-backend demo locally

```bash
npm run demo
```

`demo` first builds the extension and dashboard, then starts exactly one
development-only backend with deterministic history. Open
`http://127.0.0.1:8000/dashboard/`; load `chrome-extension/dist` for the Live
surface. There is no separate Vite server in this profile. Dashboard-only use
does not start provider sessions, but this workflow is not evidence that
physical Chrome capture, Chrome/OS TTS, Gemini, or Cloud Speech-to-Text works in
the current environment.

## Development

Run commands from the repository root:

| Command | Processes and purpose |
| --- | --- |
| `npm run dev` | Demo-seeded development backend `8000` + Live extension `5173` + Memory dashboard `5174`. |
| `npm run dev:realtime` | Empty-history backend `8000` + Live extension `5173`; omits the dashboard Vite process. |
| `npm run dev:dashboard` | Demo-history backend `8000` + Memory dashboard `5174`; no extension process. |
| `npm run build` | Builds `chrome-extension/dist` and `session-dashboard/dist`. |
| `npm run demo` | Builds both surfaces, then serves the deterministic dashboard through one backend on `8000`. |
| `npm run check` | Runs orchestration tests, backend checks, extension tests/build, and dashboard tests/typecheck/build. |

Optional offline MongoDB helper commands:

| Command | Purpose |
| --- | --- |
| `docker compose up -d mongodb` | Start the optional loopback-only profile database. |
| `docker compose stop mongodb` | Stop it without deleting account data. |

Reload the unpacked extension in `chrome://extensions` after extension build
changes. Restart the relevant profile after changing `ai-voice-realtime/.env`.
The dev runner uses strict ports and exits if any required port is already in
use; do not start a second backend beside it.

## Troubleshooting

### Cannot reach StreamSense at 127.0.0.1:8000

The backend is not running, exited after startup, or is using a different port.
Run the appropriate root development command and keep that terminal open. The
extension manifest and default WebSocket URL expect port `8000`.

### Account storage is unavailable

For Atlas, confirm the dedicated database user credentials, narrowly scoped
network access entry, and copied Drivers SRV value; then set `MONGODB_URI` and
`MONGODB_DB_NAME` in `ai-voice-realtime/.env` and restart the development
profile. For the optional offline store, run `docker compose up -d mongodb`
and use `mongodb://localhost:27017`. The account UI does not silently write
names or emails to local storage.

### Open Memory Dashboard opens a 404 page

Use `npm run dev` when developing both surfaces; the full profile points the
side panel's Memory Dashboard action to the dashboard Vite server on port
`5174`. The `dev:realtime` profile deliberately omits that server and falls
back to the
backend `/dashboard/` URL, which exists only when `session-dashboard/dist` has
been built. Run `npm run build`, `npm run demo`, or the full `npm run dev`
profile as appropriate.

### Authorize this tab cannot be selected

Use the extension's toolbar icon on an ordinary HTTP/HTTPS tab. Authorization
is tied to the exact active tab. `chrome://` pages and Chrome Web Store pages
cannot be captured.

### Backend rejects the extension connection

Copy the extension ID again from `chrome://extensions`, place the exact value in
`STREAMSENSE_EXTENSION_ID`, and restart the backend. Do not set the ID to
`true`.

### Could not load the default credentials

Run:

```bash
gcloud auth application-default login
gcloud auth application-default set-quota-project YOUR_PROJECT_ID
```

Then restart the backend. A Gemini API key does not authenticate Cloud
Speech-to-Text; the service uses ADC separately.

### `gcloud services enable` says no active account is selected

Run `gcloud auth login`, select the correct account, set the project, and retry
the enable command.

### Tab speech context unavailable

Confirm that `speech.googleapis.com` is enabled, ADC has the correct quota
project, `GOOGLE_CLOUD_PROJECT` is correct, and the active account can use the
Speech-to-Text API. Restart the backend after fixing credentials. Typed and
microphone questions can still work without captured-tab speech context. Chrome
timeline TTS is independent of Cloud Speech-to-Text health: Smart uses the
extension's local tab-activity detector, while Narrate over audio and Narration
only do not wait for tab silence. Gemini Live health gates questions and answers,
not automatic timeline narration.

### Microphone permission denied

Select the microphone icon in StreamSense to reopen the dedicated extension
permission page and allow access. Also check Chrome's microphone setting for the
extension and macOS/Windows privacy settings for Chrome.

### Holding `S` does nothing

Ensure StreamSense is running and connected, microphone access is allowed, and
the side panel has focus. The shortcut is intentionally ignored while typing in
the question input or while a modifier key is held.

### Pressing `N` does not change Voice narration

Focus the side panel and make sure the cursor is not inside an input, select, or
other editable control. `N` is intentionally ignored with modifier keys and on
key repeat. The selected mode is also available from the visible Voice
narration selector and persists when the side panel is reopened.

### Microphone audio backlog exceeded one second

Reload the latest extension build from `chrome://extensions`. The current build
accounts for a queued video frame on the shared transport while retaining the
real microphone-only backlog guard.

### Gemini speaks but no response text appears

Reload the current extension build. The chat is a scrollable area above the
fixed input row. Gemini Live output transcription must also be available for the
configured Live model/session.

### Narration is skipped and the timeline reports a persistence warning

StreamSense intentionally does not speak an automatic visual description when
the same moment could not be written to the current-session timeline. Check the
backend terminal for a sanitized history warning, restart the local backend if
its data directory is unavailable, and try the moment again.

## Security and privacy

- `.env`, local ADC, event databases, build output, and `node_modules` are
  ignored by Git.
- MongoDB stores prototype display names, normalized email addresses,
  entertainment/narration preferences, opaque UUIDs, and timestamps. The
  browser stores only the UUID. No passwords or provider credentials are
  collected by this profile flow.
- Raw microphone and captured-tab audio are streamed for processing and are not
  stored by StreamSense.
- Captured-tab transcript context is bounded in memory and cleared with the
  session.
- Stopping StreamSense closes tab/microphone capture, provider sessions, audio
  playback, timers, and in-memory session context.
- Keep the backend bound to loopback unless you have added authentication,
  transport security, and an exact production origin policy.

More implementation detail is available in
[`ai-voice-realtime/README.md`](ai-voice-realtime/README.md) and
[`chrome-extension/README.md`](chrome-extension/README.md). Dashboard-specific
contracts are documented in
[`session-dashboard/README.md`](session-dashboard/README.md),
[`docs/context-graph-api.md`](docs/context-graph-api.md), and
[`docs/semantic-history-integration.md`](docs/semantic-history-integration.md).
