import assert from "node:assert/strict";
import test from "node:test";

import { createDemoHistory } from "../src/history/demoHistory.js";
import { HistoryArchiveQueue } from "../src/history/historyArchiveQueue.js";
import { HistoryService } from "../src/history/historyService.js";
import { MemoryHistoryRepository } from "../src/history/memoryHistoryRepository.js";

test("HistoryArchiveQueue returns before unresolved history work and preserves FIFO", async () => {
  const pending = deferred();
  const calls = [];
  const historyService = {
    async startSession(input) {
      calls.push(["start", input.sessionId]);
      await pending.promise;
    },
    archiveEvent(input) { calls.push(["event", input.id]); },
    finishSession(input) { calls.push(["finish", input.sessionId]); },
  };
  const queue = new HistoryArchiveQueue({ historyService });

  assert.equal(queue.startSession({ sessionId: "session" }), true);
  assert.equal(queue.archiveEvent({ id: "event" }), true);
  assert.equal(queue.finishSession({ sessionId: "session" }), true);
  await flushAsyncWork();
  assert.deepEqual(calls, [["start", "session"]]);
  pending.resolve();
  assert.equal(await queue.drain(), true);
  assert.deepEqual(calls, [
    ["start", "session"],
    ["event", "event"],
    ["finish", "session"],
  ]);
});

test("HistoryArchiveQueue contains failures and continues later jobs", async () => {
  const errors = [];
  const calls = [];
  const queue = new HistoryArchiveQueue({
    historyService: {
      startSession() { throw new Error("storage offline"); },
      archiveEvent() { calls.push("event"); },
      finishSession() { calls.push("finish"); },
    },
    onError: (error) => errors.push(error),
  });
  assert.doesNotThrow(() => {
    queue.startSession({});
    queue.archiveEvent({});
    queue.finishSession({});
  });
  await queue.drain();
  assert.deepEqual(calls, ["event", "finish"]);
  assert.equal(errors.length, 1);
  assert.equal(errors[0].operation, "start_session");
});

test("HistoryArchiveQueue bounds pending work without throwing into realtime", () => {
  const errors = [];
  const queue = new HistoryArchiveQueue({
    historyService: { startSession() {} },
    maxPending: 1,
    queueTask() {},
    onError: (error) => errors.push(error),
  });

  assert.equal(queue.startSession({ sessionId: "first" }), true);
  assert.equal(queue.startSession({ sessionId: "second" }), false);
  assert.equal(errors.length, 1);
  assert.equal(errors[0].operation, "start_session");
});

test("HistoryService aggregates real events and finalizes a deterministic summary", async () => {
  let now = Date.parse("2026-07-20T09:00:00.000Z");
  const repository = new MemoryHistoryRepository();
  const service = new HistoryService({ repository, now: () => now });
  const demo = createDemoHistory();
  const source = demo.events[0];

  await service.startSession({
    sessionId: source.sessionId,
    startedAt: new Date(now).toISOString(),
  });
  await service.archiveEvent(source);
  now += 60_000;
  await service.finishSession({
    sessionId: source.sessionId,
    endedAt: new Date(now).toISOString(),
    durationSeconds: 60,
  });
  const session = repository.getSession(source.sessionId);
  assert.equal(session.eventCount, 1);
  assert.equal(session.durationSeconds, 60);
  assert.equal(session.endedAt, "2026-07-20T09:01:00.000Z");
  assert.match(session.summary, /significant moment/i);
});

function deferred() {
  let resolve;
  const promise = new Promise((resolvePromise) => { resolve = resolvePromise; });
  return { promise, resolve };
}

function flushAsyncWork() {
  return new Promise((resolve) => setImmediate(resolve));
}
