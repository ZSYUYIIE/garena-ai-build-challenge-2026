# StreamSense Tab-Capture Authorization Design

## Problem

The Chrome side panel currently starts tab capture from `useRealtimeSession.start()` by first awaiting audio initialization and then asynchronously querying the active tab before calling `chrome.tabCapture.getMediaStreamId()`. Chrome does not reliably treat a persistent side-panel interaction as the extension invocation that grants `activeTab` access. The result is the runtime error:

> Extension has not been invoked for the current page (see activeTab permission). Chrome pages cannot be captured.

The error also occurs on normal HTTPS pages, so treating every occurrence as a restricted-page error is incorrect.

## Goals

- Preserve the current UX: clicking the toolbar icon opens the side panel; the side-panel switch starts capture.
- Make the toolbar action the explicit `activeTab` authorization gesture.
- Bind capture to the exact tab authorized by that toolbar action.
- Prevent tab changes or persistent side-panel state from silently capturing a different tab.
- Replace Chrome's raw permission error with actionable StreamSense messages.
- Keep the existing frame sampling, WebSocket, Gemini, event timeline, and narration pipeline unchanged.

## Non-goals

- Requesting persistent access to all websites.
- Capturing `chrome://`, Chrome Web Store, extension, or other restricted pages.
- Adding microphone capture, WebRTC, or continuous video.
- Reworking backend protocol or Gemini behavior.
- Automatically starting capture when the toolbar icon is clicked.

## Chosen Architecture

### Explicit toolbar authorization

The background service worker will stop relying on `openPanelOnActionClick`. It will explicitly set `openPanelOnActionClick` to `false` so `chrome.action.onClicked` is delivered to the extension.

The `chrome.action.onClicked` handler will:

1. Read the clicked tab's `id`, `windowId`, and URL from the action event.
2. Classify the URL as capturable or restricted.
3. Persist a capture-target state in `chrome.storage.session`, keyed by window ID.
4. Call `chrome.sidePanel.open({ tabId })` directly from the action handler.

The side-panel open request and storage write will both be initiated during the action handler. No capture starts at this point.

### Per-window capture target

The shared capture-target state will use a discriminated union:

```ts
type CaptureTargetState =
  | {
      status: "ready";
      tabId: number;
      windowId: number;
      origin: string;
      authorizedAt: number;
    }
  | {
      status: "unavailable";
      windowId: number;
      reason: "restricted_page" | "missing_tab";
    };
```

States will be stored under one namespaced `chrome.storage.session` key as a record indexed by window ID. This prevents authorization in one Chrome window from overwriting another window's target.

Only HTTP and HTTPS pages are capturable. File URLs, Chrome internal pages, extension pages, the Chrome Web Store, and other schemes are reported as restricted.

### Side-panel target lifecycle

The side panel will load the target for its current window and subscribe to `chrome.storage.onChanged`. It will also track `chrome.tabs.onActivated` so it can determine whether the authorized tab is still the active tab without performing a new tab lookup in the switch handler.

The switch can start a new session only when:

- The current window has a `ready` capture target.
- The authorized target is still the active tab.
- No capture startup is already in progress.

If a different tab becomes active before capture starts, the switch is disabled and the status text tells the user to click the StreamSense toolbar icon on that tab.

If the capture target changes while a session is running, the hook stops the old media stream and WebSocket, resets the switch, and waits for the user to start the newly authorized target. StreamSense never silently transfers a running session between tabs.

### Capture startup ordering

The already-loaded target tab ID will be passed into capture startup. `chrome.tabCapture.getMediaStreamId({ targetTabId })` will be invoked before audio initialization, tab queries, state-dependent awaits, or `getUserMedia()`.

The promise returned from `getMediaStreamId()` may be awaited later, but the browser API request itself must begin at the start of the switch action. After the stream ID is available, the extension will create the tab `MediaStream`, initialize audio playback, and continue through the existing frame loop and backend WebSocket connection.

The current active-tab query inside `captureActiveTab()` will be removed. Capture will always use the explicitly authorized target.

## Component Boundaries

### `chrome-extension/src/services/captureTarget.ts`

A shared module will own:

- Capture-target types and storage key.
- URL classification.
- Per-window state updates and lookups.
- Chrome capture error classification.
- A small dependency-injected capture-start helper that guarantees the `getMediaStreamId()` request begins before asynchronous audio setup.

Pure functions and the capture-start helper will be independently testable without rendering React.

### `chrome-extension/src/services/background.ts`

The background worker will own toolbar authorization:

- Disable automatic side-panel opening behavior.
- Handle `chrome.action.onClicked`.
- Persist the authorized or unavailable target state.
- Open the side panel for the clicked tab.

Existing badge and extension-status message handling will remain intact.

### `chrome-extension/src/sidepanel/realtime/useRealtimeSession.ts`

The realtime hook will own target consumption and capture lifecycle:

- Load and observe the current window's capture target.
- Observe active-tab changes.
- Expose `canStart` and an actionable status message.
- Start capture using the stored tab ID.
- Stop and reset when the authorized target changes.
- Preserve the existing frame, WebSocket, narration, timeline, question, and cleanup behavior.

### Side-panel controls

`App`, `Header`, and `RunningStatusSwitch` will pass through a start-availability flag. The switch remains usable for stopping an active session, but cannot start when the current tab is unauthorized.

### Manifest

The extension manifest will add the `storage` permission for `chrome.storage.session`. It will retain `activeTab`, `sidePanel`, and `tabCapture`. It will not add broad host permissions.

## Error Handling

Chrome errors will be normalized to user-facing messages:

- Missing target: `Click the StreamSense toolbar icon on the tab you want to capture.`
- Active tab mismatch: `This tab is not authorized. Click the StreamSense icon here first.`
- Restricted page: `Chrome internal and Web Store pages cannot be captured.`
- Revoked access after navigation: `Page access changed. Click the StreamSense icon again.`
- Other tab-capture failure: `StreamSense could not capture this tab. Click the toolbar icon and try again.`
- Backend unavailable: retain the existing local-backend connection message.

Errors do not fall back silently to screen capture. A native `getDisplayMedia()` fallback would change the UX and is outside this fix.

## Testing Strategy

The extension will use Node's built-in test runner with Node's TypeScript type stripping, avoiding a new test-framework dependency and avoiding unrelated package-lock churn.

Tests will cover:

1. HTTP and HTTPS URLs are capturable; restricted schemes and the Chrome Web Store are rejected.
2. Capture targets are stored and selected per window.
3. A stored tab ID is used instead of querying whichever tab happens to be active later.
4. The `getMediaStreamId()` request begins before audio initialization.
5. Raw Chrome authorization and restricted-page errors map to the correct StreamSense messages.
6. A target change is recognized as a session-reset condition.

The implementation will be written test-first: each behavior will begin with a failing focused test, followed by the smallest production change that makes it pass.

## Verification

Automated verification:

```bash
cd chrome-extension
npm test
npm run build

cd ../ai-voice-realtime
npm run check
```

Manual Chrome acceptance checks:

1. Load the rebuilt unpacked extension and start the local backend on port 8000.
2. On a normal HTTPS page, click the toolbar icon, then enable the switch; capture starts without the `activeTab` error.
3. Open the side panel without authorizing the current tab; the switch is disabled with actionable guidance.
4. Authorize one tab, switch to another tab, and confirm capture cannot start until the icon is clicked on the new tab.
5. While capturing, authorize another tab and confirm the old session stops and the switch resets.
6. Navigate the authorized tab to a different origin and confirm revoked access produces the reauthorization message.
7. Invoke the extension on `chrome://extensions` and confirm the restricted-page message appears.
8. Confirm narration, timeline events, questions, stop behavior, and backend reconnection still work on an authorized tab.

## Acceptance Criteria

- The existing toolbar-then-switch UX is preserved.
- A normal HTTPS tab can be captured after the toolbar action authorizes it.
- Capture always targets the tab authorized for the current window.
- No raw `activeTab` error is shown to the user.
- Restricted and stale authorization states have specific recovery instructions.
- Switching or reauthorizing tabs cannot silently redirect an active session.
- Extension tests, extension production build, and backend checks pass.
