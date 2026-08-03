import assert from "node:assert/strict";
import test from "node:test";

import {
  authorizeCaptureTarget,
  beginAuthorizedCapture,
  captureErrorMessage,
  captureGuidance,
  createCaptureTargetState,
  isTargetReadyForActiveTab,
  loadCaptureTarget,
  replaceTargetForWindow,
  saveCaptureTarget,
  targetChangeRequiresReset,
  targetForWindow,
} from "../src/services/captureTarget.ts";

test("creates a ready target only for an HTTP or HTTPS tab", () => {
  assert.equal(
    createCaptureTargetState(
      { id: 41, windowId: 7, url: "https://example.com/watch" },
      100,
    ).status,
    "ready",
  );
  assert.equal(
    createCaptureTargetState(
      { id: 42, windowId: 7, url: "chrome://settings" },
      100,
    ).status,
    "unavailable",
  );
  assert.equal(
    createCaptureTargetState(
      {
        id: 43,
        windowId: 7,
        url: "https://chromewebstore.google.com/detail/test",
      },
      100,
    ).status,
    "unavailable",
  );
});

test("keeps capture targets isolated by window", () => {
  const first = createCaptureTargetState(
    { id: 41, windowId: 7, url: "https://example.com" },
    100,
  );
  const second = createCaptureTargetState(
    { id: 52, windowId: 8, url: "https://example.org" },
    200,
  );
  const states = replaceTargetForWindow(
    replaceTargetForWindow({}, first),
    second,
  );

  assert.deepEqual(targetForWindow(states, 7), first);
  assert.deepEqual(targetForWindow(states, 8), second);
});

test("requires the authorized target to be the active tab", () => {
  const target = createCaptureTargetState(
    { id: 41, windowId: 7, url: "https://example.com" },
    100,
  );

  assert.equal(isTargetReadyForActiveTab(target, 41), true);
  assert.equal(isTargetReadyForActiveTab(target, 52), false);
});

test("requests the stored tab before asynchronous audio initialization", async () => {
  const calls: string[] = [];
  const target = createCaptureTargetState(
    { id: 41, windowId: 7, url: "https://example.com" },
    100,
  );
  assert.equal(target.status, "ready");
  if (target.status !== "ready") throw new Error("Expected a ready target.");

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
    captureErrorMessage(
      new Error(
        "Extension has not been invoked for the current page (see activeTab permission). Chrome pages cannot be captured.",
      ),
    ),
    "Page access changed. Click the StreamSense icon again.",
  );
});

test("detects when a running session target changes", () => {
  const same = createCaptureTargetState(
    { id: 41, windowId: 7, url: "https://example.com" },
    100,
  );
  const changed = createCaptureTargetState(
    { id: 52, windowId: 7, url: "https://example.org" },
    200,
  );

  assert.equal(targetChangeRequiresReset(41, same), false);
  assert.equal(targetChangeRequiresReset(41, changed), true);
});

test("persists target records without overwriting another window", async () => {
  const values: Record<string, unknown> = {};
  const storage = {
    async get(key: string) {
      return { [key]: values[key] };
    },
    async set(items: Record<string, unknown>) {
      Object.assign(values, items);
    },
  };

  await saveCaptureTarget(
    createCaptureTargetState(
      { id: 41, windowId: 7, url: "https://example.com" },
      100,
    ),
    storage,
  );
  await saveCaptureTarget(
    createCaptureTargetState(
      { id: 52, windowId: 8, url: "https://example.org" },
      200,
    ),
    storage,
  );

  const first = await loadCaptureTarget(7, storage);
  const second = await loadCaptureTarget(8, storage);
  assert.equal(first?.status === "ready" && first.tabId, 41);
  assert.equal(second?.status === "ready" && second.tabId, 52);
});

test("serializes concurrent target writes across windows", async () => {
  const values: Record<string, unknown> = {};
  const storage = {
    async get(key: string) {
      return { [key]: values[key] };
    },
    async set(items: Record<string, unknown>) {
      Object.assign(values, items);
    },
  };

  await Promise.all([
    saveCaptureTarget(
      createCaptureTargetState(
        { id: 41, windowId: 7, url: "https://example.com" },
        100,
      ),
      storage,
    ),
    saveCaptureTarget(
      createCaptureTargetState(
        { id: 52, windowId: 8, url: "https://example.org" },
        200,
      ),
      storage,
    ),
  ]);

  const first = await loadCaptureTarget(7, storage);
  const second = await loadCaptureTarget(8, storage);
  assert.equal(first?.status === "ready" && first.tabId, 41);
  assert.equal(second?.status === "ready" && second.tabId, 52);
});

test("toolbar authorization persists and opens the exact clicked tab", async () => {
  const calls: string[] = [];

  const authorization = authorizeCaptureTarget(
    { id: 41, windowId: 7, url: "https://example.com/watch" },
    {
      persistTarget: async (target) => {
        calls.push(
          `persist:${target.status === "ready" ? target.tabId : target.reason}`,
        );
      },
      openPanel: async (tabId) => {
        calls.push(`open:${tabId}`);
      },
    },
    100,
  );

  assert.deepEqual(calls, ["persist:41", "open:41"]);
  await authorization;
});

test("guides an uninvoked side panel to the toolbar action", () => {
  assert.equal(
    captureGuidance(null, 41),
    "Click the StreamSense toolbar icon on the tab you want to capture.",
  );
});

test("identifies a restricted capture target", () => {
  const target = createCaptureTargetState({
    id: 41,
    windowId: 7,
    url: "chrome://settings",
  });

  assert.equal(
    captureGuidance(target, 41),
    "Chrome internal and Web Store pages cannot be captured.",
  );
});

test("requires reauthorization after the active tab changes", () => {
  const target = createCaptureTargetState({
    id: 41,
    windowId: 7,
    url: "https://example.com",
  });

  assert.equal(
    captureGuidance(target, 52),
    "This tab is not authorized. Click the StreamSense icon here first.",
  );
});
