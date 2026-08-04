import assert from "node:assert/strict";
import test from "node:test";

import {
  calculateFrameDimensions,
  createFrameCaptureScheduler,
} from "../src/sidepanel/realtime/frameCapture.ts";

test("caps a 1080p tab at 1280x720", () => {
  assert.deepEqual(calculateFrameDimensions(1920, 1080), {
    width: 1280,
    height: 720,
  });
});

test("does not upscale a smaller source", () => {
  assert.deepEqual(calculateFrameDimensions(800, 600), {
    width: 800,
    height: 600,
  });
});

test("preserves a non-widescreen aspect ratio", () => {
  assert.deepEqual(calculateFrameDimensions(2560, 1600), {
    width: 1280,
    height: 800,
  });
});

test("uses a 1280x720 fallback for unavailable dimensions", () => {
  assert.deepEqual(calculateFrameDimensions(0, 0), {
    width: 1280,
    height: 720,
  });
});

test("queues a forced capture behind an unchanged routine capture without overlap", async () => {
  const calls: boolean[] = [];
  let active = 0;
  let maxActive = 0;
  let releaseRoutine: (() => void) | null = null;
  const scheduler = createFrameCaptureScheduler(async ({ force }) => {
    calls.push(force);
    active += 1;
    maxActive = Math.max(maxActive, active);
    if (!force) await new Promise<void>((resolve) => { releaseRoutine = resolve; });
    active -= 1;
  });

  const routine = scheduler.capture({ force: false });
  await Promise.resolve();
  const forced = scheduler.capture({ force: true });
  assert.deepEqual(calls, [false]);
  releaseRoutine?.();
  await Promise.all([routine, forced]);

  assert.deepEqual(calls, [false, true]);
  assert.equal(maxActive, 1);
});
