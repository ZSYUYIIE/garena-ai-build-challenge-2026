# StreamSense Tab-Capture Authorization Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Preserve the toolbar-then-switch UX while authorizing and capturing the exact Chrome tab selected by the toolbar action.

**Architecture:** The background service worker converts each toolbar click into an extension-wide `activeTab` grant, stores a per-window capture target in `chrome.storage.session`, and explicitly opens the side panel. The side panel observes that target and active-tab changes; its switch begins `getMediaStreamId()` against the stored tab before any other asynchronous startup work, then reuses the existing frame and WebSocket pipeline.

**Tech Stack:** Chrome Manifest V3 (`activeTab`, `tabCapture`, `sidePanel`, `storage`), React 19, TypeScript 5.9, Node's built-in test runner with TypeScript stripping, Vite/CRXJS.

## Global Constraints

- Keep the existing toolbar-icon-then-side-panel-switch UX; the toolbar click must not start capture.
- Allow capture only for HTTP and HTTPS pages; never add broad host permissions.
- Store capture targets per Chrome window in `chrome.storage.session`.
- Never silently transfer a running capture to a newly authorized tab.
- Do not change frame sampling, WebSocket messages, Gemini requests, event storage, narration, or question behavior.
- Do not add a test-framework dependency or intentionally rewrite `chrome-extension/package-lock.json`.
- Preserve the unrelated pre-existing `chrome-extension/package-lock.json` working-tree modification and exclude it from every commit.

## File Structure

- Create `chrome-extension/src/services/captureTarget.ts`: target types, URL policy, per-window state helpers, capture-error mapping, and ordered capture startup.
- Create `chrome-extension/test/captureTarget.test.ts`: Node unit tests for the shared authorization domain and call ordering.
- Create `chrome-extension/src/sidepanel/realtime/useCaptureTarget.ts`: React subscription to session storage and active-tab changes.
- Modify `chrome-extension/src/services/background.ts`: explicit toolbar authorization and side-panel opening.
- Modify `chrome-extension/src/sidepanel/realtime/useRealtimeSession.ts`: consume the authorized target, start capture in the correct order, and reset on target changes.
- Modify `chrome-extension/src/sidepanel/App.tsx`: pass start availability into the header.
- Modify `chrome-extension/src/sidepanel/components/Header.tsx`: pass start availability into the switch.
- Modify `chrome-extension/src/sidepanel/components/RunningStatusSwitch.tsx`: disable only unauthorized start attempts while preserving stop.
- Modify `chrome-extension/manifest.config.ts`: add the `storage` permission.
- Modify `chrome-extension/package.json`: add the Node test command without adding dependencies.

---

### Task 1: Shared capture-target domain and regression tests

**Files:**
- Create: `chrome-extension/src/services/captureTarget.ts`
- Create: `chrome-extension/test/captureTarget.test.ts`
- Modify: `chrome-extension/package.json:6-9`

**Interfaces:**
- Produces: `CaptureTargetState`, `CaptureTargetsByWindow`, `CAPTURE_TARGETS_STORAGE_KEY`, `createCaptureTargetState()`, `targetForWindow()`, `replaceTargetForWindow()`, `isTargetReadyForActiveTab()`, `targetChangeRequiresReset()`, `captureGuidance()`, `captureErrorMessage()`, `loadCaptureTarget()`, `saveCaptureTarget()`, and `beginAuthorizedCapture()`.
- Consumes: only standard `URL`, injected storage methods, and injected capture functions; no React or backend dependencies.

- [ ] **Step 1: Add the test command and write failing domain tests**

Add this script to `chrome-extension/package.json`:

```json
"test": "node --experimental-strip-types --test test/*.test.ts"
```

Create `chrome-extension/test/captureTarget.test.ts` with focused tests that import `../src/services/captureTarget.ts` and assert:

```ts
import assert from "node:assert/strict";
import test from "node:test";

import {
  beginAuthorizedCapture,
  captureErrorMessage,
  createCaptureTargetState,
  isTargetReadyForActiveTab,
  replaceTargetForWindow,
  targetChangeRequiresReset,
  targetForWindow,
} from "../src/services/captureTarget.ts";

test("creates a ready target only for an HTTP or HTTPS tab", () => {
  assert.equal(createCaptureTargetState({ id: 41, windowId: 7, url: "https://example.com/watch" }, 100).status, "ready");
  assert.equal(createCaptureTargetState({ id: 42, windowId: 7, url: "chrome://settings" }, 100).status, "unavailable");
  assert.equal(createCaptureTargetState({ id: 43, windowId: 7, url: "https://chromewebstore.google.com/detail/test" }, 100).status, "unavailable");
});

test("keeps capture targets isolated by window", () => {
  const first = createCaptureTargetState({ id: 41, windowId: 7, url: "https://example.com" }, 100);
  const second = createCaptureTargetState({ id: 52, windowId: 8, url: "https://example.org" }, 200);
  const states = replaceTargetForWindow(replaceTargetForWindow({}, first), second);
  assert.equal(targetForWindow(states, 7)?.status, "ready");
  assert.equal(targetForWindow(states, 8)?.status, "ready");
  assert.equal(targetForWindow(states, 7)?.status === "ready" && targetForWindow(states, 7)?.tabId, 41);
});

test("requires the authorized target to be the active tab", () => {
  const target = createCaptureTargetState({ id: 41, windowId: 7, url: "https://example.com" }, 100);
  assert.equal(isTargetReadyForActiveTab(target, 41), true);
  assert.equal(isTargetReadyForActiveTab(target, 52), false);
});

test("requests the stored tab before asynchronous audio initialization", async () => {
  const calls: string[] = [];
  const target = createCaptureTargetState({ id: 41, windowId: 7, url: "https://example.com" }, 100);
  assert.equal(target.status, "ready");
  const stream = await beginAuthorizedCapture(target, {
    requestStreamId: async ({ targetTabId }) => {
      calls.push(`request:${targetTabId}`);
      return "stream-41";
    },
    ensureAudioReady: async () => {
      calls.push("audio");
    },
    consumeStreamId: async (streamId) => {
      calls.push(`consume:${streamId}`);
      return { id: "media-41" };
    },
  });
  assert.deepEqual(calls, ["request:41", "audio", "consume:stream-41"]);
  assert.deepEqual(stream, { id: "media-41" });
});

test("maps Chrome authorization errors to reauthorization guidance", () => {
  assert.equal(
    captureErrorMessage(new Error("Extension has not been invoked for the current page (see activeTab permission). Chrome pages cannot be captured.")),
    "Page access changed. Click the StreamSense icon again.",
  );
});

test("detects when a running session target changes", () => {
  const same = createCaptureTargetState({ id: 41, windowId: 7, url: "https://example.com" }, 100);
  const changed = createCaptureTargetState({ id: 52, windowId: 7, url: "https://example.org" }, 200);
  assert.equal(targetChangeRequiresReset(41, same), false);
  assert.equal(targetChangeRequiresReset(41, changed), true);
});
```

- [ ] **Step 2: Run the focused tests and confirm the red state**

Run:

```bash
cd chrome-extension
npm test
```

Expected: FAIL because `src/services/captureTarget.ts` does not exist.

- [ ] **Step 3: Implement the shared domain module**

Create `chrome-extension/src/services/captureTarget.ts` with these exact exported contracts:

```ts
export const CAPTURE_TARGETS_STORAGE_KEY = "streamsense.captureTargets";

export type ReadyCaptureTarget = {
  status: "ready";
  tabId: number;
  windowId: number;
  origin: string;
  authorizedAt: number;
};

export type UnavailableCaptureTarget = {
  status: "unavailable";
  windowId: number;
  reason: "restricted_page" | "missing_tab";
};

export type CaptureTargetState = ReadyCaptureTarget | UnavailableCaptureTarget;
export type CaptureTargetsByWindow = Record<string, CaptureTargetState>;

export type CaptureTab = {
  id?: number;
  windowId: number;
  url?: string;
};

type SessionStorageArea = {
  get(key: string): Promise<Record<string, unknown>>;
  set(items: Record<string, unknown>): Promise<void>;
};

export function createCaptureTargetState(tab: CaptureTab, now = Date.now()): CaptureTargetState;
export function targetForWindow(states: CaptureTargetsByWindow, windowId: number): CaptureTargetState | null;
export function replaceTargetForWindow(states: CaptureTargetsByWindow, target: CaptureTargetState): CaptureTargetsByWindow;
export function isTargetReadyForActiveTab(target: CaptureTargetState | null, activeTabId: number | null): target is ReadyCaptureTarget;
export function targetChangeRequiresReset(capturedTabId: number | null, target: CaptureTargetState | null): boolean;
export function captureGuidance(target: CaptureTargetState | null, activeTabId: number | null): string;
export function captureErrorMessage(cause: unknown): string;
export async function loadCaptureTarget(windowId: number, storage?: SessionStorageArea): Promise<CaptureTargetState | null>;
export async function saveCaptureTarget(target: CaptureTargetState, storage?: SessionStorageArea): Promise<void>;
export async function beginAuthorizedCapture<T>(target: ReadyCaptureTarget, dependencies: {
  requestStreamId: (options: { targetTabId: number }) => Promise<string>;
  ensureAudioReady: () => Promise<unknown>;
  consumeStreamId: (streamId: string) => Promise<T>;
}): Promise<T>;
```

Implementation rules:

- Parse URLs with `new URL()` and accept only `http:` and `https:`.
- Reject hostname `chromewebstore.google.com` even though it is HTTPS.
- Use `String(windowId)` as the record key and return new records rather than mutating inputs.
- In `beginAuthorizedCapture()`, assign `const streamIdPromise = requestStreamId(...)` before the first `await`, then await `ensureAudioReady()`, then consume the resolved stream ID.
- In `captureErrorMessage()`, match `activeTab`, `not been invoked`, or `permission` before matching restricted-page text because Chrome combines both clauses in the observed error.
- Default storage to `chrome.storage.session` only when the caller does not inject a storage area.

- [ ] **Step 4: Run tests and type/build validation**

Run:

```bash
npm test
npm run build
```

Expected: all capture-target tests pass and the extension production build succeeds.

- [ ] **Step 5: Commit the shared domain**

```bash
git add chrome-extension/package.json chrome-extension/src/services/captureTarget.ts chrome-extension/test/captureTarget.test.ts
git commit -m "test: define tab capture authorization behavior"
```

### Task 2: Toolbar action authorizes and stores the target tab

**Files:**
- Modify: `chrome-extension/src/services/background.ts:1-23`
- Modify: `chrome-extension/manifest.config.ts:28`
- Test: `chrome-extension/test/captureTarget.test.ts`

**Interfaces:**
- Consumes: `createCaptureTargetState(tab)` and `saveCaptureTarget(target)` from Task 1.
- Produces: one per-window `CaptureTargetState` for every toolbar action and an explicitly opened side panel.

- [ ] **Step 1: Add a failing storage round-trip test**

Extend `captureTarget.test.ts` with an in-memory storage double and assert that saving window 8 does not overwrite window 7:

```ts
test("persists target records without overwriting another window", async () => {
  const values: Record<string, unknown> = {};
  const storage = {
    async get(key: string) { return { [key]: values[key] }; },
    async set(items: Record<string, unknown>) { Object.assign(values, items); },
  };
  await saveCaptureTarget(createCaptureTargetState({ id: 41, windowId: 7, url: "https://example.com" }, 100), storage);
  await saveCaptureTarget(createCaptureTargetState({ id: 52, windowId: 8, url: "https://example.org" }, 200), storage);
  assert.equal((await loadCaptureTarget(7, storage))?.status === "ready" && (await loadCaptureTarget(7, storage))?.tabId, 41);
  assert.equal((await loadCaptureTarget(8, storage))?.status === "ready" && (await loadCaptureTarget(8, storage))?.tabId, 52);
});
```

Import `loadCaptureTarget` and `saveCaptureTarget` in the test file.

- [ ] **Step 2: Run the focused test and confirm it fails if storage helpers are incomplete**

Run `npm test` from `chrome-extension`.

Expected: the new test fails until the storage helpers preserve both window keys.

- [ ] **Step 3: Replace automatic side-panel behavior with explicit authorization**

In `background.ts`:

```ts
import {
  createCaptureTargetState,
  saveCaptureTarget,
} from "./captureTarget";

void chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: false });

chrome.action.onClicked.addListener((tab) => {
  const target = createCaptureTargetState(tab);
  const persistTarget = saveCaptureTarget(target);
  const openPanel = tab.id === undefined
    ? Promise.resolve()
    : chrome.sidePanel.open({ tabId: tab.id });

  void Promise.allSettled([persistTarget, openPanel]);
});
```

Remove the existing `runtime.onInstalled` listener that sets `openPanelOnActionClick: true`. Keep the separate badge initialization and all status-message handlers unchanged.

Add `"storage"` to the manifest permissions array:

```ts
permissions: ["activeTab", "contentSettings", "sidePanel", "storage", "tabCapture"],
```

- [ ] **Step 4: Run tests and production build**

Run:

```bash
npm test
npm run build
```

Expected: tests pass; `dist/manifest.json` contains `storage`; the build succeeds.

- [ ] **Step 5: Commit toolbar authorization**

```bash
git add chrome-extension/manifest.config.ts chrome-extension/src/services/background.ts chrome-extension/src/services/captureTarget.ts chrome-extension/test/captureTarget.test.ts
git commit -m "fix: authorize capture from the toolbar action"
```

### Task 3: Observe the authorized target in the side panel

**Files:**
- Create: `chrome-extension/src/sidepanel/realtime/useCaptureTarget.ts`
- Modify: `chrome-extension/src/services/captureTarget.ts`
- Test: `chrome-extension/test/captureTarget.test.ts`

**Interfaces:**
- Consumes: `loadCaptureTarget()`, `targetForWindow()`, `CAPTURE_TARGETS_STORAGE_KEY`, `captureGuidance()`, and `isTargetReadyForActiveTab()` from Task 1.
- Produces: `useCaptureTarget(): { target, activeTabId, canStart, guidance }` for the realtime session hook.

- [ ] **Step 1: Add failing guidance tests**

Add tests asserting these exact messages:

```ts
assert.equal(captureGuidance(null, 41), "Click the StreamSense toolbar icon on the tab you want to capture.");
assert.equal(captureGuidance(createCaptureTargetState({ id: 41, windowId: 7, url: "chrome://settings" }), 41), "Chrome internal and Web Store pages cannot be captured.");
assert.equal(captureGuidance(createCaptureTargetState({ id: 41, windowId: 7, url: "https://example.com" }), 52), "This tab is not authorized. Click the StreamSense icon here first.");
```

- [ ] **Step 2: Run tests and confirm the red state**

Run `npm test` from `chrome-extension`.

Expected: at least one guidance assertion fails until exact state mapping is implemented.

- [ ] **Step 3: Implement `useCaptureTarget()`**

Create `useCaptureTarget.ts` with this public result:

```ts
export type CaptureTargetSnapshot = {
  target: CaptureTargetState | null;
  activeTabId: number | null;
  canStart: boolean;
  guidance: string;
};

export function useCaptureTarget(): CaptureTargetSnapshot;
```

Inside one mount effect:

- Call `chrome.windows.getCurrent()` and retain its numeric window ID.
- Query the active tab once for initial `activeTabId`.
- Load that window's stored target.
- Subscribe to `chrome.storage.onChanged`; when `CAPTURE_TARGETS_STORAGE_KEY` changes in `session`, select the current window's state from `change.newValue`.
- Subscribe to `chrome.tabs.onActivated`; update `activeTabId` only when `activeInfo.windowId` matches the retained window.
- Remove both listeners during cleanup and ignore unfinished initialization after unmount.
- Derive `canStart` with `isTargetReadyForActiveTab(target, activeTabId)` and derive `guidance` with `captureGuidance(target, activeTabId)`.

- [ ] **Step 4: Run tests and build**

Run:

```bash
npm test
npm run build
```

Expected: guidance tests pass and TypeScript accepts the Chrome listener types.

- [ ] **Step 5: Commit the side-panel observer**

```bash
git add chrome-extension/src/services/captureTarget.ts chrome-extension/src/sidepanel/realtime/useCaptureTarget.ts chrome-extension/test/captureTarget.test.ts
git commit -m "feat: track the authorized capture target"
```

### Task 4: Start and reset realtime sessions against the authorized tab

**Files:**
- Modify: `chrome-extension/src/sidepanel/realtime/useRealtimeSession.ts:26-510,632-667`
- Test: `chrome-extension/test/captureTarget.test.ts`

**Interfaces:**
- Consumes: `useCaptureTarget()`, `beginAuthorizedCapture()`, `captureErrorMessage()`, and `targetChangeRequiresReset()`.
- Produces: existing realtime-session API plus `canStart: boolean`; capture always uses the authorized tab.

- [ ] **Step 1: Run the existing call-order and target-change tests as the pre-refactor safety net**

Run `npm test` from `chrome-extension`.

Expected: all Task 1 tests pass before the hook changes.

- [ ] **Step 2: Replace active-tab capture with authorized capture**

Import the shared helpers and hook:

```ts
import {
  beginAuthorizedCapture,
  captureErrorMessage,
  targetChangeRequiresReset,
  type ReadyCaptureTarget,
} from "../../services/captureTarget";
import { useCaptureTarget } from "./useCaptureTarget";
```

Within `useRealtimeSession()`:

- Call `const captureTarget = useCaptureTarget()`.
- Mirror `captureTarget.target` in a ref so the stable `start` callback reads the newest value.
- Add `capturedTabIdRef` and set it when startup begins against a ready target.
- Before changing React state in `start()`, reject unavailable/mismatched targets with `captureTarget.guidance`.
- Invoke `beginAuthorizedCapture()` immediately for a ready target:

```ts
const capturePromise = beginAuthorizedCapture(target, {
  requestStreamId: (options) => chrome.tabCapture.getMediaStreamId(options),
  ensureAudioReady: ensureAudioContext,
  consumeStreamId: consumeTabStreamId,
});
```

- Await `capturePromise` inside the existing `try` block, assign its result to `mediaStreamRef`, and retain the remaining video, WebSocket, and frame-loop setup.
- Replace `toErrorMessage(cause)` in the startup catch with `captureErrorMessage(cause)`.
- Clear `capturedTabIdRef` in `releaseResources()`.
- Remove `captureActiveTab()` and replace it with:

```ts
async function consumeTabStreamId(streamId: string) {
  const video = {
    mandatory: {
      chromeMediaSource: "tab",
      chromeMediaSourceId: streamId,
      maxFrameRate: 10,
    },
  } as unknown as MediaTrackConstraints;

  return navigator.mediaDevices.getUserMedia({ audio: false, video });
}
```

- Return `canStart: captureTarget.canStart` from the hook.

- [ ] **Step 3: Reset a running session when authorization moves**

Add an effect keyed by `captureTarget.target` that checks:

```ts
if (targetChangeRequiresReset(capturedTabIdRef.current, captureTarget.target)) {
  stopRef.current();
  setStatusText("Capture target changed. Start StreamSense on the newly authorized tab.");
}
```

Do not reset when the stored target still refers to the currently captured tab.

- [ ] **Step 4: Run tests and build**

Run:

```bash
npm test
npm run build
```

Expected: unit tests pass, the old `captureActiveTab()` symbol is absent, and TypeScript/Vite build succeeds.

- [ ] **Step 5: Commit the realtime-session fix**

```bash
git add chrome-extension/src/sidepanel/realtime/useRealtimeSession.ts
git commit -m "fix: capture the toolbar-authorized tab"
```

### Task 5: Reflect capture authorization in the switch UI

**Files:**
- Modify: `chrome-extension/src/sidepanel/App.tsx:52-60`
- Modify: `chrome-extension/src/sidepanel/components/Header.tsx:5-36`
- Modify: `chrome-extension/src/sidepanel/components/RunningStatusSwitch.tsx:4-29`

**Interfaces:**
- Consumes: `session.canStart` from Task 4.
- Produces: a switch that is disabled only for unauthorized starts, never for stopping an active session.

- [ ] **Step 1: Thread `canStart` through the component props**

Pass `canStart={session.canStart}` from `App` to `Header`, then from `Header` to `RunningStatusSwitch`.

Add `canStart: boolean` to both prop types.

- [ ] **Step 2: Apply the exact switch rule and label**

In `RunningStatusSwitch`:

```tsx
const startUnavailable = !isRunning && !canStart;

<Switch
  id="is-extension-running"
  aria-label="Turn StreamSense on or off"
  isSelected={isRunning}
  isDisabled={isBusy || startUnavailable}
  onChange={onChange}
/>
```

Use `Authorize this tab` as the label when `startUnavailable` is true; retain `Starting...`, `StreamSense running`, and `StreamSense stopped` for the other states.

- [ ] **Step 3: Run the complete extension verification**

Run:

```bash
cd chrome-extension
npm test
npm run build
```

Expected: all tests pass and the extension build succeeds.

- [ ] **Step 4: Run backend regression checks**

Run:

```bash
cd ../ai-voice-realtime
npm run check
```

Expected: all backend tests and the server syntax check pass.

- [ ] **Step 5: Commit the authorization-aware controls**

```bash
git add chrome-extension/src/sidepanel/App.tsx chrome-extension/src/sidepanel/components/Header.tsx chrome-extension/src/sidepanel/components/RunningStatusSwitch.tsx
git commit -m "feat: disable capture until a tab is authorized"
```

### Task 6: Manual Chrome acceptance and final audit

**Files:**
- Verify only; no production files should change.

**Interfaces:**
- Consumes: the built extension in `chrome-extension/dist` and backend on `127.0.0.1:8000`.
- Produces: evidence that the original error is resolved in an actual Chrome extension session.

- [ ] **Step 1: Start the backend and rebuild the extension**

Run `npm start` in `ai-voice-realtime` and `npm run build` in `chrome-extension`.

Expected: backend reports `Server running on http://127.0.0.1:8000`; build completes successfully.

- [ ] **Step 2: Reload the unpacked extension**

In `chrome://extensions`, click Reload for StreamSense so the new manifest permission and service worker are active. Return to a normal HTTPS tab before testing capture.

- [ ] **Step 3: Reproduce the original workflow**

On the normal HTTPS tab, click the StreamSense toolbar icon, then turn on the side-panel switch.

Expected: tab capture starts without `Extension has not been invoked for the current page`.

- [ ] **Step 4: Verify authorization boundaries**

Check each case separately:

- Switch tabs before starting: switch is unavailable and guidance asks for a toolbar click.
- Click the icon on the new tab: target updates and the switch becomes available.
- Reauthorize while running: old capture stops and the new target stays stopped until the switch is enabled.
- Navigate across origins: capture startup reports that page access changed and asks for another icon click.
- Open `chrome://extensions`: panel reports that the page is restricted.

- [ ] **Step 5: Verify unaffected product behavior**

On an authorized HTTPS video tab, confirm the backend WebSocket connects, changed frames are sent, descriptions appear, timeline events render, questions can be asked, speech synthesis runs, and stopping releases the capture indicator.

- [ ] **Step 6: Run the final automated gate and inspect scope**

Run:

```bash
cd chrome-extension
npm test
npm run build
cd ../ai-voice-realtime
npm run check
cd ..
git diff --check
git status --short
git diff --stat timestamped-structured-events...HEAD
```

Expected: all commands pass; only planned source, test, manifest, package script, spec, and plan files are committed; the unrelated `chrome-extension/package-lock.json` modification remains unstaged.
