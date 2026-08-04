import assert from "node:assert/strict";
import test from "node:test";

import { encodeAudioPacket } from "../src/sidepanel/realtime/audioPacket.ts";

test("encodes microphone PCM in the version-one binary layout", () => {
  const encoded = new Uint8Array(
    encodeAudioPacket("microphone", 0x01020304, 0x0a0b0c0d, new Int16Array([1, -2])),
  );

  assert.deepEqual([...encoded], [
    1,
    1,
    4,
    3,
    2,
    1,
    13,
    12,
    11,
    10,
    1,
    0,
    254,
    255,
  ]);
});

test("encodes captured-tab PCM with its distinct packet kind", () => {
  const encoded = new Uint8Array(
    encodeAudioPacket("tab", 7, 25, new Int16Array([0x1234])),
  );

  assert.deepEqual([...encoded], [1, 2, 7, 0, 0, 0, 25, 0, 0, 0, 52, 18]);
});

test("rejects an audio source outside the two packet kinds", () => {
  assert.throws(
    () => encodeAudioPacket("speaker" as never, 0, 0, new Int16Array([1])),
    /source/i,
  );
});
