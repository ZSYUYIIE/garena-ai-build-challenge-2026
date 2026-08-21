import assert from "node:assert/strict";
import test from "node:test";

import { HistoryArchiveQueue } from "../src/history/historyArchiveQueue.js";


test("history archive retries transient storage errors without reordering later work", async () => {
  const calls = [];
  const delays = [];
  let attempts = 0;
  const queue = new HistoryArchiveQueue({
    historyService: {
      async startSession() {
        attempts += 1;
        calls.push(`start-${attempts}`);
        if (attempts < 3) throw new Error("temporary MongoDB outage");
      },
      archiveEvent() {
        calls.push("event");
      },
    },
    retryDelayMs: 25,
    sleep: async (milliseconds) => {
      delays.push(milliseconds);
    },
  });

  queue.startSession({ sessionId: "session" });
  queue.archiveEvent({ id: "event" });
  assert.equal(await queue.drain(), true);

  assert.deepEqual(calls, ["start-1", "start-2", "start-3", "event"]);
  assert.deepEqual(delays, [25, 50]);
});


test("history archive reports one terminal error after bounded retries", async () => {
  const errors = [];
  let attempts = 0;
  const queue = new HistoryArchiveQueue({
    historyService: {
      startSession() {
        attempts += 1;
        throw new Error("MongoDB remains unavailable");
      },
    },
    maxAttempts: 3,
    retryDelayMs: 1,
    sleep: async () => {},
    onError: (error) => errors.push(error),
  });

  queue.startSession({ sessionId: "session" });
  assert.equal(await queue.drain(), true);

  assert.equal(attempts, 3);
  assert.equal(errors.length, 1);
  assert.equal(errors[0].operation, "start_session");
  assert.match(errors[0].message, /remains unavailable/);
});
