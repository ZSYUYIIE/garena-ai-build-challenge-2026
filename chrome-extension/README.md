# StreamSense Live Chrome Extension

The Manifest V3 extension is StreamSense's compact Live surface. It captures
one explicitly authorized HTTP(S) tab, sends bounded JPEG frames and
source-separated audio to the shared local backend, presents narration and
questions, and shows the current-session timeline. **View History** opens the
History dashboard in a normal Chrome tab; the dashboard is part of the same
product, not a replacement realtime client.

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
the session.

## Development profiles

Run integrated commands from the repository root:

| Command | Processes |
| --- | --- |
| `npm run dev` | Shared backend `8000`, extension dev process `5173`, History dashboard `5174`. |
| `npm run dev:realtime` | Shared backend `8000` and extension dev process `5173`; no dashboard Vite process. |
| `npm run demo` | Builds both frontends and starts one demo-history backend on `8000`. |

The extension always connects to `ws://127.0.0.1:8000/ws` unless a validated
build-time WebSocket URL overrides it. In the full `dev` profile, **View
History** opens `http://127.0.0.1:5174/dashboard/`. In `dev:realtime`, it falls
back to `http://127.0.0.1:8000/dashboard/`, which requires a previously built
`session-dashboard/dist`. The built `demo` serves that route directly from its
single backend.

The root dev runner checks required ports before starting and supervises all
children. Do not run another backend on port `8000` beside a root profile.

## Realtime description and timeline ownership

The side panel accepts only protocol-v2, turn-owned narration updates. It
merges incremental Gemini Live output-transcript chunks for one narration turn
and uses the accumulated spoken transcript as the visible description. Legacy
unowned `answer` and `narration` messages are rejected. The label distinguishes
active playback, the latest completed description, and the stopped state.

Current-session timeline events arrive independently as strict `event`
messages. The backend publishes a recorded event before automatic narration is
eligible, so a spoken visual moment cannot silently bypass the live timeline.
The separate History dashboard reads archived session/event projections over
REST; the extension does not rehydrate old sessions into its compact timeline.

## Checks and acceptance caveat

Run the full workspace gate from the repository root:

```bash
npm run check
```

For focused extension iteration, `npm test --workspace chrome-extension` and
`npm run build --workspace chrome-extension` remain available. Automated tests
and a successful build do not prove real Chrome capture permissions, microphone
behavior, Gemini Live audio, or Cloud Speech-to-Text in the current environment.
