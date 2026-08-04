# StreamSense Atomic Vision Backend

StreamSense samples JPEG frames from the Chrome extension, analyzes one frame at a time with Gemini, and returns grounded narration, answers, and timestamped events over a local WebSocket.

```text
Chrome extension -> ws://127.0.0.1:8000/ws -> Gemini generateContent
```

The Chrome extension is the supported hackathon demo client. The WebSocket endpoint accepts Chrome extension origins only.

## Prerequisites

- A current Node.js release with npm.
- A Gemini API key.
- Google Chrome for the extension demo.

## Backend setup

```bash
cd ai-voice-realtime
npm install
cp .env.example .env
```

Set `GOOGLE_API_KEY` in `.env`. Do not commit the populated file.

Available settings:

```dotenv
GOOGLE_API_KEY=your_gemini_api_key_here
GEMINI_VISION_MODEL=gemini-3.6-flash
HOST=127.0.0.1
PORT=8000
```

For the normal stable demo run:

```bash
npm start
```

For development with automatic Node reload:

```bash
npm run dev
```

The backend listens on `http://127.0.0.1:8000` by default. Keep this terminal running while using the extension.

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
4. Pin StreamSense if you want the toolbar action to remain visible.

## Demo flow

1. Open an ordinary HTTP or HTTPS tab you want StreamSense to describe.
2. Click the StreamSense toolbar icon. This authorizes that exact tab and opens the side panel.
3. Enable the side-panel switch to start capture.
4. Watch the narration and timeline, then ask a question about the current frame.
5. Disable the switch to stop. The captured tab badge returns from `ON` to `OFF` when Chrome reports capture has ended.

Chrome internal pages and the Chrome Web Store cannot be captured. If you change tabs before starting, click the toolbar icon on the new tab to authorize it.

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

The backend suite includes strict command validation, request-rate limits, Chrome-extension origin enforcement, the 2 MiB WebSocket payload cap, abortable Gemini turns, immutable frame timestamps, and real WebSocket integration coverage.
