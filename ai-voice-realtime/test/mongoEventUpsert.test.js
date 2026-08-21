import assert from "node:assert/strict";
import test from "node:test";

import { upsertMongoEventFields } from "../src/events/mongoEventUpsert.js";


test("event upsert retries a concurrent first-write duplicate as an update", async () => {
  const calls = [];
  const collection = {
    async updateOne(query, update, options) {
      calls.push({ query, update, options });
      if (options.upsert) {
        throw Object.assign(new Error("duplicate key"), { code: 11000 });
      }
      return { acknowledged: true, matchedCount: 1 };
    },
  };

  const result = await upsertMongoEventFields(collection, "event-1", {
    description: "A real grounded event.",
  });

  assert.equal(result.matchedCount, 1);
  assert.equal(calls.length, 2);
  assert.deepEqual(calls[0].options, { upsert: true });
  assert.deepEqual(calls[1].options, { upsert: false });
  assert.equal(calls[1].update.$set.id, "event-1");
});


test("event upsert does not hide unrelated MongoDB failures", async () => {
  const expected = Object.assign(new Error("network unavailable"), { code: 89 });
  const collection = {
    async updateOne() {
      throw expected;
    },
  };

  await assert.rejects(
    upsertMongoEventFields(collection, "event-1", { description: "x" }),
    (error) => error === expected,
  );
});


test("event upsert rethrows a duplicate race when the winner cannot be found", async () => {
  const duplicate = Object.assign(new Error("duplicate key"), { code: 11000 });
  let calls = 0;
  const collection = {
    async updateOne() {
      calls += 1;
      if (calls === 1) throw duplicate;
      return { acknowledged: true, matchedCount: 0 };
    },
  };

  await assert.rejects(
    upsertMongoEventFields(collection, "event-1", { description: "x" }),
    (error) => error === duplicate,
  );
});
