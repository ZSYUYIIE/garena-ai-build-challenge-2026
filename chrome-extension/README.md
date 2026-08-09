# StreamSense Live Chrome Extension

The Manifest V3 extension is StreamSense's compact Live surface. It captures
one explicitly authorized HTTP(S) tab, sends bounded JPEG frames and
source-separated audio to the shared local backend, presents narration and
questions, and shows the current-session timeline. A prominent **Open Memory
Dashboard** action directly beneath the live controls opens the matching Memory
page in a normal Chrome tab. The dashboard is part of the same product, not a
replacement realtime client.

## Install, build, and load

Use the repository root workspace:

```bash
npm install
npm run build
```

Open `chrome://extensions`, enable **Developer mode**, choose **Load unpacked**,
and select `chrome-extension/dist`. Copy the generated extension ID to
`ai-voice-realtime/.env` as `STREAMSENSE_EXTENSION_ID`, then reload the
extension after rebuilding.

On an ordinary HTTP or HTTPS page, click the StreamSense toolbar icon to
authorize that exact tab and open the side panel. Chrome internal pages and the
Chrome Web Store cannot be captured. Use the side-panel switch to start or stop
the session. Use **Open Memory Dashboard** in that side panel when you want the
larger session-history workspace; the toolbar intentionally does not bypass the
live side panel.

## Microphone permission

Chrome requires microphone permission to be granted from a full extension page,
not directly from the side panel. If access is denied or the Chrome profile has
never granted it, the side panel shows **Allow microphone access**. Press that
button, then press **Allow microphone** on the page that opens to trigger
Chrome's permission prompt. StreamSense automatically retries the microphone
after permission is granted.

If Chrome has remembered a previous denial, open
`chrome://settings/content/microphone`, allow sites to request microphone access,
remove StreamSense from the blocked list, and try again. On macOS, Chrome must
also be enabled under **Privacy & Security → Microphone**.

## Development profiles

Run integrated commands from the repository root:

| Command | Processes |
| --- | --- |
| `npm run dev` | Shared backend `8000`, extension dev process `5173`, Memory dashboard `5174`. |
| `npm run dev:realtime` | Shared backend `8000` and extension dev process `5173`; no dashboard Vite process. |
| `npm run demo` | Builds both frontends and starts one demo-history backend on `8000`. |

The extension always connects to `ws://127.0.0.1:8000/ws` unless a validated
build-time WebSocket URL overrides it. In the full `dev` profile, the Memory
Dashboard action uses `http://127.0.0.1:5174/dashboard/` as its validated root.
In `dev:realtime`, it falls back to `http://127.0.0.1:8000/dashboard/`, which
requires a previously built `session-dashboard/dist`. The built `demo` serves
that route directly from its single backend.

The root dev runner checks required ports before starting and supervises all
children. Do not run another backend on port `8000` beside a root profile.

## Live-to-Memory connectivity

The strict protocol-v2 `connected` acknowledgement includes the backend's
actual session UUID. The extension validates that UUID and keeps it only while
the capture session is active. Its Memory Dashboard action continues that same
session archive from the shared StreamSense backend.

While active, the action opens:

```text
/dashboard/sessions/{sessionId}?source=extension
```

Without an active session it opens:

```text
/dashboard/?source=extension
```

The destination is constructed only from the already validated dashboard
configuration, and a malformed session ID is rejected before a tab opens. On
the exact active-session route, Memory refetches the session, events, and
relationship graph over REST every two seconds while the page remains open.
That refresh is polling, not a WebSocket or live subscription. Capture,
narration, questions, and interruption controls remain in the side panel.

The default Memory projection is in memory. It can show new extension events
during the lifetime of the shared backend process, but it is not reconstructed
from the SQLite event store after restart. Stopping or restarting the backend
therefore clears Memory history. The dashboard's explicit demo profile instead
starts a fresh deterministic in-memory projection and does not prove extension
connectivity.

## Realtime description and timeline ownership

The side panel accepts only protocol-v2, turn-owned narration updates. It
merges incremental Gemini Live output-transcript chunks for one narration turn
and uses the accumulated spoken transcript as the visible description. Legacy
unowned `answer` and `narration` messages are rejected. The label distinguishes
active playback, the latest completed description, and the stopped state.
The description is presented as a collapsed-by-default disclosure with its
latest text still visible in the summary row. Expanding it reveals the full
bounded description and provider status. The current-session timeline scrolls
inside a bounded region so the answer-mode control, chat history, and composer
remain visible at ordinary side-panel heights.

Current-session timeline events arrive independently as strict `event`
messages. The backend publishes a recorded event before automatic narration is
eligible, so a spoken visual moment cannot silently bypass the live timeline.
The separate Memory dashboard reads archived session/event projections over
REST; the extension does not rehydrate old sessions into its compact timeline.
The dashboard's Memory-first relationship map, search, accessibility shortcuts,
single accessible theme, and readable relationship alternatives are documented in
[`../session-dashboard/README.md`](../session-dashboard/README.md).

## Answer modes

The chat area has a Normal / Deep Research segmented tab control. This changes
how the next question is answered; it does not create another conversation or
clear existing messages. The selection applies equally to typed and
push-to-talk questions. During Deep Research, the existing chat displays an
accessible four-step plan with the current query, source count, review state,
and synthesis state. Its active step uses a reduced-motion-safe loading
animation and completed steps transition to checkmarks. The concise researched text appears above a linked source
list in the same chat. Non-live Gemini text-to-speech speaks only the answer
body, not citations or source links; Gemini Live does not generate the Deep
Research answer. Selecting Normal resumes the existing Live session.
Deep Research requires `EXA_API_KEY` on the backend and stores no search state
in the extension or database.

## Checks and acceptance caveat

Run the full workspace gate from the repository root:

```bash
npm run check
```

For focused extension iteration, `npm test --workspace chrome-extension` and
`npm run build --workspace chrome-extension` remain available. Automated tests
and a successful build do not prove real Chrome capture permissions, microphone
behavior, Gemini Live audio, or Cloud Speech-to-Text in the current environment.
