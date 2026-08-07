# StreamSense Chrome Extension

This Manifest V3 extension captures an authorized Chrome tab, samples JPEG frames, and displays narration, questions, and timestamped events from the local StreamSense backend.

## Build for the demo

Start the backend first by following `ai-voice-realtime/README.md`. Then:

```bash
cd chrome-extension
npm install
npm run build
```

## Realtime description ownership

The side panel accepts only protocol-v2 turn-owned narration updates. It merges
incremental Gemini Live output-transcript chunks for one narration turn and
uses that accumulated spoken transcript as the visible description. Legacy
unowned `answer` and `narration` text messages are rejected. The description
label distinguishes active playback from the latest completed description and
the stopped state.

Current-session timeline events arrive independently as strict `event`
messages. The backend publishes a recorded event before automatic narration is
eligible, so a spoken visual moment cannot silently bypass the timeline.

Open `chrome://extensions`, enable **Developer mode**, choose **Load unpacked**, and select `chrome-extension/dist`.

On an ordinary HTTP or HTTPS page, click the StreamSense toolbar icon to authorize that exact tab and open the side panel. Use the side-panel switch to start or stop capture.

## Development

Use the Vite watch process when changing extension code:

```bash
npm run dev
```

Reload the unpacked extension from `chrome://extensions` after rebuilding when necessary.

## Checks

```bash
npm test
npm run build
```
