import assert from "node:assert/strict";
import test from "node:test";

import {
  PcmChunker,
  StreamingPcm16Resampler,
} from "../src/sidepanel/realtime/audioPcm.ts";

test("resamples 48 kHz float audio to bounded 16 kHz PCM16", () => {
  const input = Float32Array.from(
    { length: 480 },
    (_, index) => Math.sin(index / 12) * 0.5,
  );

  const output = new StreamingPcm16Resampler(48_000).push(input);

  assert.equal(output.length, 160);
  assert.ok(output.every((sample) => sample >= -32_768 && sample <= 32_767));
});

test("preserves streaming position and PCM16 endpoints without changing input", () => {
  const resampler = new StreamingPcm16Resampler(48_000);
  const first = Float32Array.from({ length: 240 }, (_, index) => index / 240);
  const second = Float32Array.from({ length: 240 }, (_, index) => -index / 240);
  const original = first.slice();

  const split = new Int16Array([
    ...resampler.push(first),
    ...resampler.push(second),
  ]);
  const combined = new StreamingPcm16Resampler(48_000).push(
    Float32Array.from([...first, ...second]),
  );

  assert.deepEqual(split, combined);
  assert.deepEqual(first, original);
  assert.deepEqual(
    [...new StreamingPcm16Resampler(16_000).push(new Float32Array([-2, -1, 1, 2]))],
    [-32_768, -32_768, 32_767, 32_767],
  );
});

test("keeps 48 kHz resampling phase when a push ends between output samples", () => {
  const input = Float32Array.from(
    { length: 256 },
    (_, index) => Math.sin(index / 17) * 0.4,
  );
  const splitResampler = new StreamingPcm16Resampler(48_000);

  const split = new Int16Array([
    ...splitResampler.push(input.slice(0, 128)),
    ...splitResampler.push(input.slice(128)),
  ]);
  const contiguous = new StreamingPcm16Resampler(48_000).push(input);

  assert.equal(split.length, contiguous.length);
  assert.deepEqual(split, contiguous);
});

test("emits 40 ms microphone chunks without losing remainder", () => {
  const chunker = new PcmChunker(640);
  const input = new Int16Array(1_000);
  input[0] = 17;

  const chunks = chunker.push(input);

  assert.deepEqual(chunks.map((chunk) => chunk.length), [640]);
  assert.equal(chunks[0][0], 17);
  assert.equal(chunker.flush()?.length, 360);
  assert.equal(input[0], 17);
  assert.equal(chunker.flush(), null);
});
