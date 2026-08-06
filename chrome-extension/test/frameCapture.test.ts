import assert from "node:assert/strict";
import test from "node:test";

import {
  calculateFrameDimensions,
  commitRetainedFrame,
  createFrameSignature,
  createFrameCaptureScheduler,
  hasMeaningfulVisualChange,
} from "../src/sidepanel/realtime/frameCapture.ts";

function solidRgba(width: number, height: number, luminance: number): Uint8ClampedArray {
  const pixels = new Uint8ClampedArray(width * height * 4);
  for (let index = 0; index < pixels.length; index += 4) {
    pixels[index] = luminance;
    pixels[index + 1] = luminance;
    pixels[index + 2] = luminance;
    pixels[index + 3] = 255;
  }
  return pixels;
}

function paintRect(
  pixels: Uint8ClampedArray,
  sourceWidth: number,
  rect: { x: number; y: number; width: number; height: number; luminance: number },
): void {
  for (let y = rect.y; y < rect.y + rect.height; y += 1) {
    for (let x = rect.x; x < rect.x + rect.width; x += 1) {
      const index = (y * sourceWidth + x) * 4;
      pixels[index] = rect.luminance;
      pixels[index + 1] = rect.luminance;
      pixels[index + 2] = rect.luminance;
    }
  }
}

function signature(columns: number, rows: number, changed: Array<[number, number]> = []) {
  const luminance = new Uint8Array(columns * rows);
  for (const [index, value] of changed) luminance[index] = value;
  return { columns, rows, luminance };
}

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

test("area averaging detects compact raster changes over and between old sample points", () => {
  const width = 192;
  const height = 108;
  const beforePixels = solidRgba(width, height, 0);
  const before = createFrameSignature(beforePixels, width, height);

  assert.equal(before.columns, 96);
  assert.equal(before.rows, 54);
  for (const rect of [
    { x: 1, y: 1, width: 4, height: 4, luminance: 255 },
    { x: 3, y: 3, width: 3, height: 2, luminance: 255 },
  ]) {
    const afterPixels = beforePixels.slice();
    paintRect(afterPixels, width, rect);
    const after = createFrameSignature(afterPixels, width, height);
    assert.equal(hasMeaningfulVisualChange(before, after), true);
  }
});

test("admits exact global ratio and mean-difference boundaries", () => {
  const unchanged = signature(100, 100);
  const ratioBoundary = signature(
    100,
    100,
    Array.from({ length: 80 }, (_, index) => [index * 100 % 9_999, 18] as [number, number]),
  );
  const meanBoundary = signature(
    100,
    100,
    Array.from({ length: 10_000 }, (_, index) => [index, 4] as [number, number]),
  );

  assert.equal(hasMeaningfulVisualChange(unchanged, ratioBoundary), true);
  assert.equal(hasMeaningfulVisualChange(unchanged, meanBoundary), true);
});

test("admits horizontal and vertical compact changes without row wrapping", () => {
  const unchanged = signature(100, 100);

  assert.equal(
    hasMeaningfulVisualChange(unchanged, signature(100, 100, [[101, 24], [102, 24]])),
    true,
  );
  assert.equal(
    hasMeaningfulVisualChange(unchanged, signature(100, 100, [[101, 24], [201, 24]])),
    true,
  );
  assert.equal(
    hasMeaningfulVisualChange(unchanged, signature(100, 100, [[99, 24], [100, 24]])),
    false,
  );
});

test("rejects isolated and sub-threshold noise but admits incompatible signatures", () => {
  const unchanged = signature(100, 100);

  assert.equal(
    hasMeaningfulVisualChange(unchanged, signature(100, 100, [[5_050, 24]])),
    false,
  );
  assert.equal(
    hasMeaningfulVisualChange(unchanged, signature(100, 100, [[10, 17], [11, 17]])),
    false,
  );
  assert.equal(hasMeaningfulVisualChange(unchanged, signature(100, 101)), true);
  assert.equal(hasMeaningfulVisualChange(null, unchanged), true);
});

test("commits a signature only after frame delivery is retained", () => {
  const candidate = signature(100, 100, [[10, 24], [11, 24]]);
  let committed = null;
  let attempts = 0;

  assert.throws(() => {
    committed = commitRetainedFrame(candidate, () => {
      attempts += 1;
      throw new Error("conversion failed");
    }).signature;
  }, /conversion failed/);
  assert.equal(committed, null);

  const sentPayloads: string[] = [];
  const immediate = commitRetainedFrame(candidate, () => {
    attempts += 1;
    sentPayloads.push("encoded-frame");
    return "sent";
  });
  let queuedFrame: string | null = null;
  const queued = commitRetainedFrame(candidate, () => {
    attempts += 1;
    queuedFrame = "encoded-frame";
    return "queued";
  });

  assert.equal(immediate.signature, candidate);
  assert.equal(immediate.result, "sent");
  assert.equal(queued.signature, candidate);
  assert.equal(queued.result, "queued");
  assert.deepEqual(sentPayloads, ["encoded-frame"]);
  assert.equal(queuedFrame, "encoded-frame");
  assert.equal(attempts, 3);
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
