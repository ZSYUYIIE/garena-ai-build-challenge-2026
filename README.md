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

The dashboard also includes an explicitly local prototype Account route for a
display name and viewing preferences. It is stored only in that browser and is
not presented as production authentication. It does not alter the extension's
capture, speech recognition, Gemini, narration, interruption, or playback
pipeline.

```text
Chrome extension
  ├─ JPEG screen frames ────────────────┐
  ├─ user microphone PCM ───────────────┼─> Express/WebSocket backend ─> Gemini
  └─ captured-tab PCM ─> backend ─> Cloud Speech-to-Text V2

Memory dashboard ─── REST `/api` ──> in-memory history service
```

Microphone audio and captured-tab audio remain separate. Only microphone audio
is treated as user input by Gemini. Captured-tab audio is transcribed for media
context and is never presented as the user's speech.

## Repository layout

| Directory | Purpose |
| --- | --- |
| `chrome-extension/` | Manifest V3 extension, side-panel UI, tab capture, push-to-talk, and Gemini audio playback. |
| `ai-voice-realtime/` | Express and WebSocket backend, Gemini Interactions/Live clients, Cloud Speech-to-Text, and event storage. |
| `session-dashboard/` | Accessible React dashboard for previous sessions, timeline search, and context exploration. |
| `docs/` | Design notes and verification material. |

The repository root is an npm workspace and the supported starting point for
installing, developing, building, demonstrating, and checking all three
packages.

## Prerequisites

- macOS, Linux, or Windows with Google Chrome.
- Node.js `20.19+` or `22.12+` and npm.
- A Gemini API key with access to the configured vision and Live models.
- A Google Cloud project with billing configured for Speech-to-Text V2.
- The [Google Cloud CLI](https://cloud.google.com/sdk/docs/install) (`gcloud`).

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

GOOGLE_CLOUD_PROJECT=YOUR_PROJECT_ID
GOOGLE_CLOUD_SPEECH_LOCATION=us

STREAMSENSE_EXTENSION_ID=the_exact_32_character_id_from_chrome
STREAMSENSE_ALLOW_ANY_EXTENSION_ORIGIN=false
STREAMSENSE_HISTORY_MODE=memory

HOST=127.0.0.1
PORT=8000
```

`STREAMSENSE_EXTENSION_ID` must be the actual ID from `chrome://extensions`;
values such as `true`, an extension name, or a placeholder will be rejected.
Keep the Gemini API key in the backend only—never add it to extension code or a
`VITE_` variable.

For isolated local debugging, `STREAMSENSE_ALLOW_ANY_EXTENSION_ORIGIN=true`
temporarily relaxes the extension-origin check. Do not use that setting for a
shared or production backend.

## 5. Start StreamSense

For normal development, run one command from the repository root:

```bash
npm run dev
```

This supervised profile starts exactly one normal in-memory backend on port
`8000`, the extension development process on `5173`, and the dashboard on
`5174`. It checks that all required ports are free before starting. Press
Ctrl+C once to stop the process group.

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
   be narrated according to the selected narration level.
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
- The user's live transcript and Gemini's response appear in the chat above the
  input, while Gemini's native audio response plays through Chrome.

While push-to-talk is held, captured-tab playback fades to 0% so the microphone
hears the user rather than the computer. On release it returns to 30% while
Gemini replies, then to 100% after playback finishes. Muting playback does not
stop screen capture or the separate captured-tab transcription stream.

## Grounded narration and timeline behavior

Automatic narration now follows one fail-closed path:

1. Gemini Interactions analyzes the current admitted frame without receiving a
   previous generated description or captured-tab transcript as visual
   evidence.
2. StreamSense rejects self-descriptions, inferred user actions, and results
   from a frame that has already been superseded.
3. The accepted moment must be recorded and published to the current-session
   timeline before it can be offered for speech. If local event persistence
   fails, the panel shows a warning and skips that narration.
4. Captured-tab transcript is compared only after the visual fact is grounded,
   so it may suppress a redundant description but cannot create one.

The panel builds its displayed description from Gemini Live's turn-bound output
transcript, which follows the audio actually generated, rather than displaying
the earlier visual-analysis sentence as if it had already been spoken. The
label reads **Now describing** only during model playback, **Latest
description** while the session is otherwise running, and **Video description**
when stopped. Reload the unpacked extension after rebuilding; legacy unowned
`answer` and `narration` WebSocket messages are rejected by the current panel.

## Memory dashboard development without Speech-to-Text

The Memory surface can run from deterministic demo data without opening the
extension or creating a realtime WebSocket session:

```bash
npm run dev:dashboard
```

Open `http://127.0.0.1:5174/dashboard/`. Vite serves the React application on
port `5174` and proxies `/api` to the one demo backend on port `8000`.

`start:dashboard-demo` is an explicit development-only mode. It seeds a fresh
in-memory repository every time the backend starts and is refused when
`NODE_ENV=production`. Normal `npm start` uses an empty in-memory history
repository. Neither mode is durable: dashboard history is lost at process
restart. Durable MongoDB storage, vector embeddings/search, Redis current
context, and retrieval ranking remain a separate integration workstream and are
not implemented by the current in-memory composition.

Memory now leads with an optional Three.js relationship map before the recent
session list. The former `/dashboard/explore` URL is a compatibility redirect:
a valid `sessionId` goes to that session's `#relationships` section, otherwise
it returns to the Memory overview. Relationship exploration is therefore part
of Memory and each session, rather than a separate product area.

The map renders every session, event, entity, and topic as a sphere. Color
groups spheres into labeled entertainment-domain constellations; visual role
and size provide non-color cues. Sessions are the largest double-halo anchors,
event size represents supplied importance, and entity/topic size represents
the number of supplied event connections. Solid or dashed edges retain the
backend meanings for session membership, chronological adjacency, shared
entities, shared topics, and optional backend-supplied semantic similarity.
The client never invents a missing relationship.

This is a memory hierarchy, not an XYZ chart: separated entertainment-domain
islands contain non-overlapping session systems, chronological event arcs, and
outer entity/topic context shells. Multi-domain context occupies a dedicated
bridge lane above the islands so it cannot be mistaken for an unrelated domain.
Context shared by multiple sessions in one domain uses packed rings outside the
island. All ring radii are derived from node count and sphere size to prevent
dense nodes from intersecting. Depth only separates overlaps; absolute X, Y,
and Z coordinates are not measurements. Reset framing includes sphere extents,
island labels, and narrow-viewport aspect. Priority-based screen-space label
collision handling keeps dense selections readable without hiding their DOM
relationship list. The labeled-node selector and semantic details are the
keyboard and screen-reader path on every map. Session pages also include
complete readable node and relationship lists. WebGL failure preserves those
DOM alternatives.

The Memory dashboard imports the extension's actual design tokens and shared
button, input, label, and select primitives. Wider-page layout and WebGL styles
remain dashboard-specific; the extension source and its visual design are not
modified.

Dashboard shortcuts have visible equivalents: `Ctrl+K` opens and focuses
Memory search; `Alt+H` opens Memory; `Alt+G` focuses the graph selector;
`Alt+C` toggles the persistent high-contrast mode; and `Alt+/` opens shortcut
help (`Escape` closes it). The dashboard also provides a skip link, visible
focus, route-focus management, forced-colors support, and reduced-motion
behavior that disables camera easing and minimizes CSS motion. High contrast
also reaches portaled select menus and updates the WebGL background, fog, and
relationship-line presentation live.

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
physical Chrome capture, Gemini, or Cloud Speech-to-Text works in the current
environment.

## Development

Run commands from the repository root:

| Command | Processes and purpose |
| --- | --- |
| `npm run dev` | Normal backend `8000` + Live extension `5173` + Memory dashboard `5174`. |
| `npm run dev:realtime` | Normal backend `8000` + Live extension `5173`; omits the dashboard Vite process. |
| `npm run dev:dashboard` | Demo-history backend `8000` + Memory dashboard `5174`; no extension process. |
| `npm run build` | Builds `chrome-extension/dist` and `session-dashboard/dist`. |
| `npm run demo` | Builds both surfaces, then serves the deterministic dashboard through one backend on `8000`. |
| `npm run check` | Runs orchestration tests, backend checks, extension tests/build, and dashboard tests/typecheck/build. |

Reload the unpacked extension in `chrome://extensions` after extension build
changes. Restart the relevant profile after changing `ai-voice-realtime/.env`.
The dev runner uses strict ports and exits if any required port is already in
use; do not start a second backend beside it.

## Troubleshooting

### Cannot reach StreamSense at 127.0.0.1:8000

The backend is not running, exited after startup, or is using a different port.
Run the appropriate root development command and keep that terminal open. The
extension manifest and default WebSocket URL expect port `8000`.

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

### Tab speech context unavailable / automatic narration paused

Confirm that `speech.googleapis.com` is enabled, ADC has the correct quota
project, `GOOGLE_CLOUD_PROJECT` is correct, and the active account can use the
Speech-to-Text API. Restart the backend after fixing credentials. Typed and
microphone questions can still work without captured-tab speech context.

### Microphone permission denied

Select the microphone icon in StreamSense to reopen the dedicated extension
permission page and allow access. Also check Chrome's microphone setting for the
extension and macOS/Windows privacy settings for Chrome.

### Holding `S` does nothing

Ensure StreamSense is running and connected, microphone access is allowed, and
the side panel has focus. The shortcut is intentionally ignored while typing in
the question input or while a modifier key is held.

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
