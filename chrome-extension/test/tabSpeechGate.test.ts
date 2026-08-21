import assert from "node:assert/strict";
import test from "node:test";

import { TabSpeechGate } from "../src/sidepanel/realtime/tabSpeechGate.ts";
import type { TabSpeechWorkerCommand } from "../src/sidepanel/realtime/tabSpeechWorkerProtocol.ts";

class FakeWorker {
  onmessage: ((event: MessageEvent<unknown>) => void) | null = null;
  onerror: ((event: ErrorEvent) => void) | null = null;
  readonly sent: unknown[] = [];
  terminateCalls = 0;
  throwOnPost = false;
  postMessage(message: unknown) {
    if (this.throwOnPost) throw new Error("worker startup failed");
    this.sent.push(message);
  }
  terminate() { this.terminateCalls += 1; }
  emit(data: unknown) { this.onmessage?.({ data } as MessageEvent<unknown>); }
}

const packet = (samples = 512, amplitude = 0.01) => Int16Array.from(
  { length: samples },
  (_, index) => Math.round(Math.sin(index * 0.17) * amplitude * 32_767),
);

function fixture() {
  const worker = new FakeWorker();
  const speech: boolean[] = [];
  let timer: (() => void) | null = null;
  const gate = new TabSpeechGate({
    onSpeechChange: (active) => speech.push(active),
    createWorker: () => worker,
    setTimeout: (callback) => { timer = callback; return 1 as unknown as ReturnType<typeof setTimeout>; },
    clearTimeout: () => { timer = null; },
  });
  let timestampMs = 0;
  const ready = () => worker.emit({ type: "ready", generation: 1 });
  const push = (probability: number, pcm = packet()) => {
    gate.push(pcm, timestampMs);
    timestampMs += pcm.length / 16;
    const command = worker.sent.at(-1) as Extract<TabSpeechWorkerCommand, { type: "frame" }>;
    worker.emit({
      type: "probability",
      generation: command.generation,
      sequence: command.sequence,
      frameEndMs: command.frameEndMs,
      probability,
      inferenceMs: 1,
    });
  };
  return { gate, push, ready, speech, worker, fireTimer: () => timer?.() };
}

test("uses loud-energy fallback until model non-speech is stable", () => {
  const f = fixture();
  f.gate.push(packet(512, 0.2), 0);
  assert.deepEqual(f.speech, [true]);
  f.ready();
  for (let index = 0; index < 17; index += 1) f.push(0.08, packet(512, 0.2));
  assert.deepEqual(f.speech, [true, false]);
});

test("opens on model speech and closes only after end hysteresis", () => {
  const f = fixture();
  f.ready();
  for (let index = 0; index < 17; index += 1) f.push(0.08);
  f.push(0.78);
  f.push(0.82);
  assert.equal(f.speech.at(-1), true);
  for (let index = 0; index < 16; index += 1) f.push(0.1);
  assert.equal(f.speech.at(-1), false);
});

test("keeps confirmed speech latched when the model fails over quiet PCM", () => {
  const f = fixture();
  f.ready();
  for (let index = 0; index < 17; index += 1) f.push(0.08);
  f.push(0.78);
  f.push(0.82);
  assert.deepEqual(f.speech, [true]);

  f.worker.emit({ type: "failed", generation: 1, stage: "inference" });
  for (let index = 0; index < 20; index += 1) f.push(0.08);

  assert.deepEqual(f.speech, [true]);
  assert.equal(f.worker.terminateCalls, 1);
});

test("falls back conservatively on timeout and out-of-order results", () => {
  const timedOut = fixture();
  timedOut.gate.push(packet(512, 0.2), 0);
  timedOut.fireTimer();
  assert.equal(timedOut.worker.terminateCalls, 1);
  assert.equal(timedOut.speech.at(-1), true);

  const outOfOrder = fixture();
  outOfOrder.ready();
  outOfOrder.gate.push(packet(), 0);
  outOfOrder.gate.push(packet(512, 0.2), 32);
  const frames = outOfOrder.worker.sent.filter(
    (value): value is Extract<TabSpeechWorkerCommand, { type: "frame" }> =>
      typeof value === "object" && value !== null && (value as { type?: string }).type === "frame",
  );
  outOfOrder.worker.emit({
    type: "probability", generation: 1, sequence: frames[1].sequence,
    frameEndMs: frames[1].frameEndMs, probability: 0.1, inferenceMs: 1,
  });
  assert.equal(outOfOrder.worker.terminateCalls, 1);
  assert.equal(outOfOrder.speech.at(-1), true);
});

test("derives 32 ms frame clocks across 100 ms transport packets", () => {
  const f = fixture();
  f.ready();
  f.gate.push(packet(1_600), 0);
  f.gate.push(packet(1_600), 100);
  const frameEnds = f.worker.sent
    .filter((value): value is Extract<TabSpeechWorkerCommand, { type: "frame" }> =>
      typeof value === "object" && value !== null && (value as { type?: string }).type === "frame")
    .map((value) => value.frameEndMs);
  assert.deepEqual(frameEnds, [32, 64, 96, 128, 160, 192]);
});

test("stops idempotently and ignores late worker events", () => {
  const f = fixture();
  f.ready();
  f.gate.stop();
  f.gate.stop();
  f.worker.emit({ type: "ready", generation: 1 });
  assert.equal(f.worker.terminateCalls, 1);
  assert.deepEqual(f.speech, []);
});

test("falls back when the initial worker post throws", () => {
  const worker = new FakeWorker();
  worker.throwOnPost = true;
  const speech: boolean[] = [];
  let gate: TabSpeechGate | null = null;
  assert.doesNotThrow(() => {
    gate = new TabSpeechGate({
      onSpeechChange: (active) => speech.push(active),
      createWorker: () => worker,
    });
  });
  gate!.push(packet(512, 0.2), 0);
  assert.equal(worker.terminateCalls, 1);
  assert.deepEqual(speech, [true]);
});

test("fails over instead of throwing on invalid packet clocks", () => {
  const f = fixture();
  f.ready();
  f.gate.push(packet(512, 0.2), 0);
  assert.doesNotThrow(() => f.gate.push(packet(), Number.NaN));
  assert.equal(f.worker.terminateCalls, 1);
  assert.equal(f.speech.at(-1), true);
});

test("treats wrong-generation events as lifecycle failures", () => {
  for (const event of [
    { type: "ready", generation: 2 },
    { type: "failed", generation: 2, stage: "inference" },
    { type: "probability", generation: 2, sequence: 1, frameEndMs: 32, probability: 0.1, inferenceMs: 1 },
  ]) {
    const f = fixture();
    f.worker.emit(event);
    assert.equal(f.worker.terminateCalls, 1);
  }
});

test("falls back once for every remaining worker and transport failure", () => {
  const cases: Array<[string, (fixtureValue: ReturnType<typeof fixture>) => number]> = [
    ["worker error", (f) => {
      f.gate.push(packet(512, 0.2), 0);
      f.worker.onerror?.({} as ErrorEvent);
      return 32;
    }],
    ["malformed event", (f) => {
      f.gate.push(packet(512, 0.2), 0);
      f.worker.emit({ type: "probability" });
      return 32;
    }],
    ["reported inference failure", (f) => {
      f.gate.push(packet(512, 0.2), 0);
      f.worker.emit({ type: "failed", generation: 1, stage: "inference" });
      return 32;
    }],
    ["packet clock discontinuity", (f) => {
      f.ready();
      f.gate.push(packet(512, 0.2), 0);
      f.gate.push(packet(512, 0.2), 34);
      return 66;
    }],
    ["more than eight in-flight frames", (f) => {
      f.ready();
      for (let index = 0; index <= 8; index += 1) {
        f.gate.push(packet(512, 0.2), index * 32);
      }
      return 288;
    }],
  ];

  for (const [name, trigger] of cases) {
    const f = fixture();
    const nextTimestampMs = trigger(f);
    assert.equal(f.worker.terminateCalls, 1, name);
    assert.equal(f.speech.at(-1), true, name);
    const sentBeforeFallbackPush = f.worker.sent.length;
    f.gate.push(packet(512, 0.2), nextTimestampMs);
    assert.equal(f.worker.sent.length, sentBeforeFallbackPush, `${name} retried the worker`);
    assert.equal(f.worker.terminateCalls, 1, `${name} terminated more than once`);
  }
});
