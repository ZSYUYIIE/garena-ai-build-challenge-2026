import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { EventStore } from "../src/events/eventStore.js";

function sampleEvent(overrides = {}) {
  return {
    sessionId: overrides.sessionId || randomUUID(),
    timestampSeconds: 222,
    eventType: "shot_saved",
    entities: ["Team A", "Player 9"],
    description: "The goalkeeper saves a close-range shot.",
    importance: 0.91,
    confidence: 0.88,
    ...overrides,
  };
}

test("EventStore records and lists timestamped events", () => {
  const store = new EventStore();
  const sessionId = randomUUID();

  try {
    const result = store.record(sampleEvent({ sessionId }));
    assert.equal(result.status, "recorded");
    assert.equal(result.event.timestamp, "03:42");
    assert.match(result.event.id, /^[0-9a-f-]{36}$/);

    const events = store.listBySession(sessionId);
    assert.equal(events.length, 1);
    assert.deepEqual(events[0], result.event);
  } finally {
    store.close();
  }
});

test("EventStore suppresses similar events inside the duplicate window", () => {
  const store = new EventStore();
  const sessionId = randomUUID();

  try {
    const first = store.record(sampleEvent({ sessionId }));
    const duplicate = store.record(
      sampleEvent({
        sessionId,
        timestampSeconds: 228,
        description: "Goalkeeper saves the close range shot.",
      })
    );

    assert.equal(first.status, "recorded");
    assert.equal(duplicate.status, "duplicate");
    assert.equal(duplicate.event.id, first.event.id);
    assert.equal(store.listBySession(sessionId).length, 1);
  } finally {
    store.close();
  }
});

test("EventStore keeps meaningful events outside the duplicate window", () => {
  const store = new EventStore();
  const sessionId = randomUUID();

  try {
    store.record(sampleEvent({ sessionId }));
    const later = store.record(
      sampleEvent({ sessionId, timestampSeconds: 240 })
    );

    assert.equal(later.status, "recorded");
    assert.equal(store.listBySession(sessionId).length, 2);
  } finally {
    store.close();
  }
});

test("EventStore persists events when a file-backed database is reopened", () => {
  const temporaryDirectory = fs.mkdtempSync(
    path.join(os.tmpdir(), "streamsense-events-")
  );
  const databasePath = path.join(temporaryDirectory, "events.db");
  const sessionId = randomUUID();

  try {
    const writer = new EventStore({ databasePath });
    writer.record(sampleEvent({ sessionId }));
    writer.close();

    const reader = new EventStore({ databasePath });
    try {
      const events = reader.listBySession(sessionId);
      assert.equal(events.length, 1);
      assert.equal(events[0].timestamp, "03:42");
      assert.equal(events[0].eventType, "shot_saved");
    } finally {
      reader.close();
    }
  } finally {
    fs.rmSync(temporaryDirectory, { recursive: true, force: true });
  }
});
