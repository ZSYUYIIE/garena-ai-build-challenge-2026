import assert from "node:assert/strict";
import test from "node:test";

import {
  calculateFrameDimensions,
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
