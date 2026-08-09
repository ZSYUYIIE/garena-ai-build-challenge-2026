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
extension after rebuilding. The manifest requires Chrome's `tts` permission so
the side panel can consume installed Chrome/OS voices; it does not request
`ttsEngine` because StreamSense does not provide a speech engine. Automatic
timeline narration prefers Alex, then Samantha, then another compatible English
voice, and supplies `en-US`, rate `0.9`, and pitch `0.9`.

The complete runtime permission set is `activeTab`, `sidePanel`, `storage`,
`tabCapture`, and `tts`. Host permissions and extension-page connections are
limited to the loopback backend on port `8000`; there is no content script or
broad page-injection permission.

On an ordinary HTTP or HTTPS page, click the StreamSense toolbar icon to
authorize that exact tab and open the side panel. Chrome internal pages and the
Chrome Web Store cannot be captured. Use the side-panel switch to start or stop
the session. Use **Open Memory Dashboard** in that side panel when you want the
larger session-history workspace; the toolbar intentionally does not bypass the
live side panel.

## Development profiles

Run integrated commands from the repository root:

| Command | Processes |
| --- | --- |
| `npm run dev` | Shared backend `8000`, extension dev process `5173`, Memory dashboard `5174`. |
| `npm run dev:realtime` | Shared backend `8000` and extension dev process `5173`; no dashboard Vite process. |
| `npm run demo` | Builds both frontends and starts one demo-history backend on `8000`. |

The extension always connects to `ws://127.0.0.1:8000/ws` unless a validated
build-time `VITE_STREAMSENSE_WS_URL` overrides it. The URL must use `ws` or
`wss`, end at `/ws`, and contain no credentials, query, or fragment; a remote
value still requires an intentional manifest host/CSP security change. In the
full `dev` profile, the Memory Dashboard action uses
`http://127.0.0.1:5174/dashboard/` as its validated root.
That optional build-time value is `VITE_STREAMSENSE_DASHBOARD_URL`; it accepts
only loopback HTTP(S) URLs whose path is exactly `/dashboard/`.
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

The side panel accepts strict protocol-v2 `event` messages and displays the
newest recorded event description in its collapsed-by-default description
disclosure. Expanding it reveals the full bounded description and provider
status. Legacy unowned `answer` and `narration` messages remain rejected. The
current-session timeline scrolls inside a bounded region so the answer-mode
control, chat history, and composer remain visible at ordinary side-panel
heights.

Current-session timeline events arrive independently as strict `event`
messages. The backend grounds, validates, records, and publishes each event.
Only after the side panel deduplicates and inserts a new event can its exact
recorded `description` be offered to Chrome/OS TTS. Gemini Live never rephrases
or synthesizes automatic timeline events, so a spoken visual moment cannot
silently bypass the live timeline.
The separate Memory dashboard reads archived session/event projections over
REST; the extension does not rehydrate old sessions into its compact timeline.
The dashboard's Memory-first relationship map, search, accessibility shortcuts,
single accessible theme, and readable relationship alternatives are documented in
[`../session-dashboard/README.md`](../session-dashboard/README.md).

## Voice narration modes

Voice narration is a side-panel-only preference and is separate from the
Narration level selector:

- **Smart narration** waits for 750 milliseconds of continuous silence from the
  extension's existing local tab-activity detector.
- **Narrate over audio** speaks the newest recorded timeline event even during
  tab speech. Local tab playback fades to 40 percent only from the Chrome TTS
  `start` event through `end`, `interrupted`, `cancelled`, or `error`.
- **Narration only** speaks new timeline events while local tab playback stays
  muted. Tab capture and the separate Speech-to-Text stream continue.

Question only under Narration level suppresses automatic voice in every mode.
Press `N` while the side panel has focus to cycle the three Voice narration
modes. The shortcut ignores editable controls, modifier keys, and key repeat;
the visible selector remains its accessible equivalent. The selection is saved
locally and applied immediately to an active session.

The fixed calm voice profile applies only to automatic Chrome timeline TTS.
Voice discovery is cached for the realtime session; failure falls back to
Chrome voice selection while retaining `en-US`, rate `0.9`, and pitch `0.9`.
Gemini Live question and Deep Research answer voices are unchanged.

Typed and microphone questions interrupt an active Chrome timeline utterance
and clear its one pending event before admission. Events received while a user
answer owns speech remain visible but are not spoken later. Gemini Live and
Cloud Speech-to-Text health do not gate timeline TTS; Cloud transcription and
captured-tab PCM continue independently.

## Answer modes

The chat area has a Normal / Deep Research segmented tab control. This changes
how the next question is answered; it does not create another conversation or
clear existing messages. The selection applies equally to typed and
push-to-talk questions. During Deep Research, the existing chat displays an
accessible four-step plan with the current query, source count, review state,
and synthesis state. Its active step uses a reduced-motion-safe loading
animation and completed steps transition to checkmarks. The concise researched
text appears above a linked source list in the same chat. A non-live Gemini
request generates the answer, then the persistent Gemini Live connection speaks
only the answer body, not citations or source links. Selecting Normal resumes
the existing Live session.
Each completed researched answer also exposes a manual **Debug: Play with
Gemini Live** control. Pressing it reads the session-cached concise answer over
the existing Live connection, suppresses the duplicate transcript, and does
not rerun or persist the research.
Deep Research requires `EXA_API_KEY` on the backend and does not persist search
state. The side panel and backend retain only bounded in-memory
turn/progress data for the browser session; research queries, sources, and
answers never enter MongoDB or the dashboard history repository.

## Checks and acceptance caveat

Run the full workspace gate from the repository root:

```bash
npm run check
```

For focused extension iteration, `npm test --workspace chrome-extension` and
`npm run build --workspace chrome-extension` remain available. Automated tests
and a successful build do not prove real Chrome capture permissions, microphone
behavior, Chrome/OS TTS, Gemini Live audio, or Cloud Speech-to-Text in the current
environment. Reload the unpacked extension and perform a physical TTS smoke test
after changing narration behavior.
