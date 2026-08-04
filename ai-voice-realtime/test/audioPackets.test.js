import assert from "node:assert/strict";
import test from "node:test";

import {
  AudioSequenceGuard,
  parseAudioPacket,
} from "../src/protocol/audioPackets.js";

function packet(kind, sequence, timestampMs, pcm = Buffer.from([1, 0, 2, 0])) {
  const raw = Buffer.alloc(10 + pcm.length);
  raw[0] = 1;
  raw[1] = kind;
  raw.writeUInt32LE(sequence, 2);
  raw.writeUInt32LE(timestampMs, 6);
  pcm.copy(raw, 10);
  return raw;
}

test("parses microphone and captured-tab PCM as distinct sources", () => {
  const guard = new AudioSequenceGuard();
  assert.equal(parseAudioPacket(packet(1, 0, 25), guard).source, "microphone");
  assert.equal(parseAudioPacket(packet(2, 0, 30), guard).source, "tab");
});

test("rejects unknown, odd, oversized, and non-monotonic packets", () => {
  const guard = new AudioSequenceGuard();
  parseAudioPacket(packet(1, 7, 25), guard);
  assert.throws(() => parseAudioPacket(packet(1, 7, 30), guard), /sequence/i);
  assert.throws(() => parseAudioPacket(packet(9, 0, 30), new AudioSequenceGuard()), /source/i);
  assert.throws(
    () => parseAudioPacket(packet(1, 0, 30, Buffer.from([1])), new AudioSequenceGuard()),
    /even/i,
  );
  assert.throws(
    () => parseAudioPacket(packet(2, 0, 30, Buffer.alloc(3_202)), new AudioSequenceGuard()),
    /payload/i,
  );
});
