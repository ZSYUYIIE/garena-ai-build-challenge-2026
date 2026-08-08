# StreamSense

StreamSense is a Chrome side-panel extension that watches an authorized browser
tab, describes meaningful visual changes, builds a timestamped event timeline,
and lets the user ask Gemini questions by text or push-to-talk voice.

The project has two processes:

```text
Chrome extension
  ├─ JPEG screen frames ────────────────┐
  ├─ user microphone PCM ───────────────┼─> Express/WebSocket backend ─> Gemini
  └─ captured-tab PCM ─> backend ─> Cloud Speech-to-Text V2
```

Microphone audio and captured-tab audio remain separate. Only microphone audio
is treated as user input by Gemini. Captured-tab audio is transcribed for media
context and is never presented as the user's speech.

## Repository layout

| Directory | Purpose |
| --- | --- |
| `chrome-extension/` | Manifest V3 extension, side-panel UI, tab capture, push-to-talk, and Gemini audio playback. |
| `ai-voice-realtime/` | Express and WebSocket backend, Gemini Interactions/Live clients, Cloud Speech-to-Text, and event storage. |
| `docs/` | Design notes and verification material. |

## Prerequisites

- macOS, Linux, or Windows with Google Chrome.
- Node.js `20.19+` or `22.12+` and npm.
- A Gemini API key with access to the configured vision and Live models.
- A Google Cloud project with billing configured for Speech-to-Text V2.
- The [Google Cloud CLI](https://cloud.google.com/sdk/docs/install) (`gcloud`).
- MongoDB and Redis servers accessible remotely or running locally (view section on configuring the backend environment).

## 1. Install dependencies

From the repository root:

```bash
cd ai-voice-realtime
npm install

cd ../chrome-extension
npm install
npm run build
```

The extension build is written to `chrome-extension/dist`.

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
cd ai-voice-realtime
cp .env.example .env
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

HOST=127.0.0.1
PORT=8000

MONGODB_URI=mongodb://username:password@localhost:27017/?directConnection=true
MONGODB_NAME=streamsense
```

`STREAMSENSE_EXTENSION_ID` must be the actual ID from `chrome://extensions`;
values such as `true`, an extension name, or a placeholder will be rejected.
Keep the Gemini API key in the backend only—never add it to extension code or a
`VITE_` variable.

For isolated local debugging, `STREAMSENSE_ALLOW_ANY_EXTENSION_ORIGIN=true`
temporarily relaxes the extension-origin check. Do not use that setting for a
shared or production backend.

**Note**: You can run MongoDB locally via Docker or install them directly. If you use Docker, you can start the services with:

```bash
docker compose up
```
create a directory named `data/mongodb_data` in the `ai-voice-realtime` folder to persist MongoDB data.


## 5. Start StreamSense

Keep the backend running in a terminal:

```bash
cd ai-voice-realtime
npm start
```

Expected output:

```text
Server running on http://127.0.0.1:8000
```

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

## Development

Run the extension build in watch mode:

```bash
cd chrome-extension
npm run dev
```

For automatic backend reloads:

```bash
cd ai-voice-realtime
npm run dev
```

Reload the extension in `chrome://extensions` after extension changes. Restart
the backend after changing `.env`.

Run all project checks:

```bash
cd ai-voice-realtime
npm test
npm run check

cd ../chrome-extension
npm test
npm run build
```

## Troubleshooting

### Cannot reach StreamSense at 127.0.0.1:8000

The backend is not running, exited after startup, or is using a different port.
Run `npm start` in `ai-voice-realtime` and keep that terminal open. The extension
manifest and default WebSocket URL expect port `8000`.

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
[`chrome-extension/README.md`](chrome-extension/README.md).
