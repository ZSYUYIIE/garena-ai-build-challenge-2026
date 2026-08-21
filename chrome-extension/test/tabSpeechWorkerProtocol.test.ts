import assert from "node:assert/strict";
import test from "node:test";

import {
  parseTabSpeechWorkerCommand,
  parseTabSpeechWorkerEvent,
} from "../src/sidepanel/realtime/tabSpeechWorkerProtocol.ts";

test("accepts strict worker commands and events", () => {
  const pcm = new ArrayBuffer(2_048);
  assert.deepEqual(parseTabSpeechWorkerCommand({ type: "initialize", generation: 1 }), {
    type: "initialize", generation: 1,
  });
  assert.equal(parseTabSpeechWorkerCommand({
    type: "frame", generation: 1, sequence: 2, frameEndMs: 64, pcm,
  }).type, "frame");
  assert.deepEqual(parseTabSpeechWorkerEvent({
    type: "probability", generation: 1, sequence: 2, frameEndMs: 64,
    probability: 0.8, inferenceMs: 3,
  }), {
    type: "probability", generation: 1, sequence: 2, frameEndMs: 64,
    probability: 0.8, inferenceMs: 3,
  });
});

test("rejects malformed commands without retaining PCM", () => {
  for (const value of [
    null,
    [],
    { type: "initialize", generation: 0 },
    { type: "initialize", generation: 1, extra: true },
    { type: "frame", generation: 1, sequence: 1, frameEndMs: 32, pcm: new ArrayBuffer(4) },
    { type: "frame", generation: 1, sequence: Number.MAX_SAFE_INTEGER + 1, frameEndMs: 32, pcm: new ArrayBuffer(2_048) },
  ]) {
    assert.throws(() => parseTabSpeechWorkerCommand(value), /worker command/i);
  }
});

test("rejects malformed worker events", () => {
  for (const value of [
    null,
    [],
    { type: "ready", generation: 1, extra: true },
    { type: "probability", generation: 1, sequence: 1, frameEndMs: 32, probability: 1.1, inferenceMs: 1 },
    { type: "probability", generation: 1, sequence: 1, frameEndMs: 32, probability: 0.1, inferenceMs: -1 },
    { type: "failed", generation: 1, stage: "secret error details" },
  ]) {
    assert.throws(() => parseTabSpeechWorkerEvent(value), /worker event/i);
  }
});
