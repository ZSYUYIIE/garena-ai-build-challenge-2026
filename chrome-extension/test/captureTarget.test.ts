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
