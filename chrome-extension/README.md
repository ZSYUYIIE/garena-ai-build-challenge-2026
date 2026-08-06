# StreamSense Chrome Extension

This Manifest V3 extension captures an authorized Chrome tab, samples JPEG frames, and displays narration, questions, and timestamped events from the local StreamSense backend.

## Build for the demo

Start the backend first by following `ai-voice-realtime/README.md`. Then:

```bash
cd chrome-extension
npm install
npm run build
```

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
