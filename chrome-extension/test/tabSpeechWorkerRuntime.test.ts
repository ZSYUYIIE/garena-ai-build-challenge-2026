import assert from "node:assert/strict";
import test from "node:test";

import { createTabSpeechWorkerRuntime } from "../src/sidepanel/realtime/tabSpeechWorkerRuntime.ts";
import type { SileroSpeechModel } from "../src/sidepanel/realtime/sileroV5.ts";
import type { TabSpeechWorkerEvent } from "../src/sidepanel/realtime/tabSpeechWorkerProtocol.ts";

const frame = (sequence: number) => ({
  type: "frame" as const,
  generation: 1,
  sequence,
  frameEndMs: sequence * 32,
  pcm: new Float32Array(512).buffer,
});

test("initializes once and serializes frame inference in sequence order", async () => {
  const events: TabSpeechWorkerEvent[] = [];
  const resolvers: Array<(value: number) => void> = [];
  let concurrent = 0;
  let maxConcurrent = 0;
  const model: SileroSpeechModel = {
    process: async () => {
      concurrent += 1;
      maxConcurrent = Math.max(maxConcurrent, concurrent);
      const value = await new Promise<number>((resolve) => resolvers.push(resolve));
      concurrent -= 1;
      return value;
    },
    reset() {},
    async close() {},
  };
  let now = 0;
  const runtime = createTabSpeechWorkerRuntime({
    loadModel: async () => model,
    postEvent: (event) => events.push(event),
    now: () => ++now,
    closeWorker: () => undefined,
  });

  await runtime.receive({ type: "initialize", generation: 1 });
  const first = runtime.receive(frame(1));
  const second = runtime.receive(frame(2));
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(resolvers.length, 1);
  resolvers.shift()!(0.8);
  await first;
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(resolvers.length, 1);
  resolvers.shift()!(0.2);
  await second;
  assert.equal(maxConcurrent, 1);
  assert.deepEqual(events.map((event) => event.type), ["ready", "probability", "probability"]);
  assert.deepEqual(events.slice(1).map((event) => "sequence" in event ? event.sequence : null), [1, 2]);
});

test("ignores stale generations and sanitizes inference failures", async () => {
  const events: TabSpeechWorkerEvent[] = [];
  let closeCalls = 0;
  const runtime = createTabSpeechWorkerRuntime({
    loadModel: async () => ({
      async process() { throw new Error("private provider details"); },
      reset() {},
      async close() { closeCalls += 1; },
    }),
    postEvent: (event) => events.push(event),
    now: () => 1,
    closeWorker: () => undefined,
  });
  await runtime.receive({ type: "initialize", generation: 1 });
  await runtime.receive({ ...frame(1), generation: 2 });
  await runtime.receive(frame(1));
  assert.equal(closeCalls, 1);
  assert.deepEqual(events.at(-1), { type: "failed", generation: 1, stage: "inference" });
  assert.equal(JSON.stringify(events).includes("private provider"), false);
});

test("reports initialization failure and closes idempotently", async () => {
  const events: TabSpeechWorkerEvent[] = [];
  let closeWorkerCalls = 0;
  const runtime = createTabSpeechWorkerRuntime({
    loadModel: async () => { throw new Error("model URL"); },
    postEvent: (event) => events.push(event),
    now: () => 0,
    closeWorker: () => { closeWorkerCalls += 1; },
  });
  await runtime.receive({ type: "initialize", generation: 1 });
  await runtime.receive({ type: "close", generation: 1 });
  await runtime.receive({ type: "close", generation: 1 });
  assert.deepEqual(events, [{ type: "failed", generation: 1, stage: "initialize" }]);
  assert.equal(closeWorkerCalls, 1);
});
