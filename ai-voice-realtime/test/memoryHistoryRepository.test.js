import assert from "node:assert/strict";
import test from "node:test";

import { createDemoHistory, seedDemoHistory } from "../src/history/demoHistory.js";
import { MemoryHistoryRepository } from "../src/history/memoryHistoryRepository.js";

test("MemoryHistoryRepository lists bounded sessions with stable opaque cursors", async () => {
  const repository = new MemoryHistoryRepository();
  await seedDemoHistory(repository);

  const first = repository.listSessions({ limit: 2 });
  const second = repository.listSessions({ limit: 2, cursor: first.nextCursor });
  const third = repository.listSessions({ limit: 2, cursor: second.nextCursor });

  assert.equal(first.items.length, 2);
  assert.equal(second.items.length, 2);
  assert.equal(third.items.length, 1);
  assert.ok(first.nextCursor);
  assert.ok(second.nextCursor);
  assert.equal(third.nextCursor, null);
  const sessions = [...first.items, ...second.items, ...third.items];
  assert.deepEqual(
    sessions.map((session) => session.startedAt),
    sessions
      .map((session) => session.startedAt)
      .toSorted()
      .reverse(),
  );
  assert.equal(
    new Set(sessions.map((session) => session.sessionId)).size,
    5,
  );
  assert.throws(
    () => repository.listSessions({ cursor: "not-a-cursor" }),
    /cursor is invalid/i,
  );
});

test("MemoryHistoryRepository isolates and chronologically paginates session events", async () => {
  const demo = createDemoHistory();
  const repository = new MemoryHistoryRepository();
  await seedDemoHistory(repository);
  const sessionId = demo.sessions[0].sessionId;

  const first = repository.listSessionEvents(sessionId, { limit: 3 });
  const second = repository.listSessionEvents(sessionId, {
    limit: 3,
    cursor: first.nextCursor,
  });
  assert.equal(first.items.length, 3);
  assert.equal(second.items.length, 2);
  const combined = [...first.items, ...second.items];
  assert.deepEqual(
    combined.map((event) => event.timestampSeconds),
    combined.map((event) => event.timestampSeconds).toSorted((a, b) => a - b),
  );
  assert.equal(combined.every((event) => event.sessionId === sessionId), true);

  const goals = repository.listSessionEvents(sessionId, { eventType: "goal" });
  const expectedGoals = demo.events.filter(
    (event) => event.sessionId === sessionId && event.eventType === "goal",
  );
  assert.equal(goals.items.length, expectedGoals.length);
  assert.equal(goals.items.every((event) => event.eventType === "goal"), true);
  assert.throws(
    () => repository.listSessionEvents(sessionId, {
      eventType: "goal",
      cursor: first.nextCursor,
    }),
    /cursor is invalid/i,
  );
});

test("MemoryHistoryRepository returns defensive copies and archives event IDs once", async () => {
  const demo = createDemoHistory();
  const repository = new MemoryHistoryRepository();
  const session = demo.sessions[0];
  const event = demo.events[0];
  repository.upsertSession(session);
  const first = repository.archiveEvent(event);
  const duplicate = repository.archiveEvent(event);
  const fetched = repository.getSession(session.sessionId);
  fetched.title = "mutated";

  assert.equal(first.inserted, true);
  assert.equal(duplicate.inserted, false);
  assert.equal(repository.getSession(session.sessionId).title, session.title);
});

test("event cursors cannot be reused across sessions or filters", async () => {
  const demo = createDemoHistory();
  const repository = new MemoryHistoryRepository();
  await seedDemoHistory(repository);
  const firstSession = repository.listSessionEvents(demo.sessions[0].sessionId, {
    limit: 2,
  });

  assert.throws(
    () => repository.listSessionEvents(demo.sessions[1].sessionId, {
      limit: 2,
      cursor: firstSession.nextCursor,
    }),
    /cursor is invalid/i,
  );
  assert.throws(
    () => repository.listSessionEvents(demo.sessions[0].sessionId, {
      limit: 2,
      eventId: demo.events[0].id,
      cursor: firstSession.nextCursor,
    }),
    /cursor is invalid/i,
  );
});

test("eventId selects one exact event for dashboard deep links", async () => {
  const demo = createDemoHistory();
  const repository = new MemoryHistoryRepository();
  await seedDemoHistory(repository);
  const event = demo.events.find((item) => item.sessionId === demo.sessions[0].sessionId);

  const page = repository.listSessionEvents(demo.sessions[0].sessionId, {
    eventId: event.id,
  });

  assert.deepEqual(page.items.map((item) => item.id), [event.id]);
  assert.equal(page.nextCursor, null);
});
