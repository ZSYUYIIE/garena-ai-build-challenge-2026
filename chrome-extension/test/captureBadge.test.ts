import assert from "node:assert/strict";
import test from "node:test";

import {
  badgeTextForCaptureStatus,
  syncCaptureBadge,
} from "../src/services/captureBadge.ts";

test("capture badge is ON only while tab capture is active", () => {
  assert.equal(badgeTextForCaptureStatus("active"), "ON");
  assert.equal(badgeTextForCaptureStatus("pending"), "OFF");
  assert.equal(badgeTextForCaptureStatus("stopped"), "OFF");
  assert.equal(badgeTextForCaptureStatus("error"), "OFF");
});

test("capture badge updates the exact tab from the status event", async () => {
  const updates: Array<{ tabId: number; text: string }> = [];

  await syncCaptureBadge(
    { tabId: 42, status: "active" },
    async (details) => {
      updates.push(details);
    },
  );
  await syncCaptureBadge(
    { tabId: 42, status: "stopped" },
    async (details) => {
      updates.push(details);
    },
  );

  assert.deepEqual(updates, [
    { tabId: 42, text: "ON" },
    { tabId: 42, text: "OFF" },
  ]);
});

test("capture badge ignores a status event without a valid tab", async () => {
  let updateCount = 0;

  await syncCaptureBadge(
    { tabId: undefined, status: "active" },
    async () => {
      updateCount += 1;
    },
  );
  await syncCaptureBadge(
    { tabId: Number.NaN, status: "active" },
    async () => {
      updateCount += 1;
    },
  );

  assert.equal(updateCount, 0);
});
