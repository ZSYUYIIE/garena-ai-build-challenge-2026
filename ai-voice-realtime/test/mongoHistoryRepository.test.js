import assert from "node:assert/strict";
import test from "node:test";

import { createDemoHistory } from "../src/history/demoHistory.js";
import { MongoHistoryRepository } from "../src/history/mongoHistoryRepository.js";


test("MongoHistoryRepository persists real sessions and events across repository instances", async () => {
  const demo = createDemoHistory();
  const sessionsCollection = new FakeMongoCollection();
  const eventsCollection = new FakeMongoCollection([
    {
      _id: "context-only",
      id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      sessionId: demo.sessions[0].sessionId,
      description: "Embedding work not yet archived to Memory.",
      embedding: [0.1],
      historyArchived: false,
    },
  ]);
  const repository = new MongoHistoryRepository({
    sessionsCollection,
    eventsCollection,
  });

  await repository.ensureIndexes();
  for (const session of demo.sessions) await repository.upsertSession(session);
  for (const event of demo.events) await repository.archiveEvent(event);

  const reopened = new MongoHistoryRepository({
    sessionsCollection,
    eventsCollection,
  });
  const first = await reopened.listSessions({ limit: 2 });
  const second = await reopened.listSessions({
    limit: 2,
    cursor: first.nextCursor,
  });
  const third = await reopened.listSessions({
    limit: 2,
    cursor: second.nextCursor,
  });
  const sessions = [...first.items, ...second.items, ...third.items];

  assert.equal(sessions.length, 5);
  assert.deepEqual(
    sessions.map((session) => session.startedAt),
    sessions.map((session) => session.startedAt).toSorted().reverse(),
  );
  assert.equal(third.nextCursor, null);
  assert.equal(sessionsCollection.indexes.length, 2);
  assert.equal(eventsCollection.indexes.length, 3);

  const sessionId = demo.sessions[0].sessionId;
  const firstEvents = await reopened.listSessionEvents(sessionId, { limit: 3 });
  const secondEvents = await reopened.listSessionEvents(sessionId, {
    limit: 3,
    cursor: firstEvents.nextCursor,
  });
  const events = [...firstEvents.items, ...secondEvents.items];
  assert.deepEqual(
    events.map((event) => event.timestampSeconds),
    events.map((event) => event.timestampSeconds).toSorted((a, b) => a - b),
  );
  assert.equal(
    events.some((event) => event.id === "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"),
    false,
  );
});


test("MongoHistoryRepository merges chronological history into an existing semantic event", async () => {
  const demo = createDemoHistory();
  const event = demo.events[0];
  const sessionsCollection = new FakeMongoCollection();
  const eventsCollection = new FakeMongoCollection([
    {
      _id: "semantic-event",
      id: event.id,
      sessionId: event.sessionId,
      embedding: [0.1, 0.2, 0.3],
      semanticIndexed: true,
    },
  ]);
  const repository = new MongoHistoryRepository({
    sessionsCollection,
    eventsCollection,
  });

  await repository.upsertSession(demo.sessions[0]);
  const first = await repository.archiveEvent(event);
  const duplicate = await repository.archiveEvent(event);
  const stored = eventsCollection.documents.find(
    (document) => document.id === event.id,
  );

  assert.equal(first.inserted, true);
  assert.equal(duplicate.inserted, false);
  assert.deepEqual(stored.embedding, [0.1, 0.2, 0.3]);
  assert.equal(stored.semanticIndexed, true);
  assert.equal(stored.historyArchived, true);
  assert.equal(stored.description, event.description);
  assert.deepEqual(
    (await repository.listSessionEvents(event.sessionId)).items.map(
      (item) => item.id,
    ),
    [event.id],
  );
});


test("MongoHistoryRepository keeps cursor filters scoped and supports exact event links", async () => {
  const demo = createDemoHistory();
  const repository = new MongoHistoryRepository({
    sessionsCollection: new FakeMongoCollection(),
    eventsCollection: new FakeMongoCollection(),
  });
  for (const session of demo.sessions.slice(0, 2)) {
    await repository.upsertSession(session);
  }
  for (const event of demo.events.filter((item) =>
    demo.sessions.slice(0, 2).some((session) => session.sessionId === item.sessionId)
  )) {
    await repository.archiveEvent(event);
  }

  const sessionId = demo.sessions[0].sessionId;
  const page = await repository.listSessionEvents(sessionId, { limit: 2 });
  await assert.rejects(
    repository.listSessionEvents(demo.sessions[1].sessionId, {
      limit: 2,
      cursor: page.nextCursor,
    }),
    /cursor is invalid/i,
  );
  await assert.rejects(
    repository.listSessionEvents(sessionId, {
      eventType: "goal",
      cursor: page.nextCursor,
    }),
    /cursor is invalid/i,
  );

  const event = demo.events.find((item) => item.sessionId === sessionId);
  const exact = await repository.listSessionEvents(sessionId, {
    eventId: event.id,
  });
  assert.deepEqual(exact.items.map((item) => item.id), [event.id]);
  assert.equal(exact.nextCursor, null);
});


class FakeMongoCollection {
  constructor(documents = []) {
    this.documents = structuredClone(documents);
    this.indexes = [];
    this.nextId = documents.length + 1;
  }

  createIndex(keys, options) {
    this.indexes.push([structuredClone(keys), structuredClone(options)]);
    return options.name;
  }

  async findOne(query) {
    const document = this.documents.find((item) => matches(item, query));
    return document ? structuredClone(document) : null;
  }

  async updateOne(query, update, { upsert = false } = {}) {
    const index = this.documents.findIndex((item) => matches(item, query));
    if (index >= 0) {
      this.documents[index] = {
        ...this.documents[index],
        ...structuredClone(update.$set ?? {}),
      };
      return { acknowledged: true, matchedCount: 1, upsertedCount: 0 };
    }
    if (!upsert) {
      return { acknowledged: true, matchedCount: 0, upsertedCount: 0 };
    }
    const inserted = {
      _id: `mongo-${this.nextId++}`,
      ...equalityFields(query),
      ...structuredClone(update.$set ?? {}),
    };
    this.documents.push(inserted);
    return {
      acknowledged: true,
      matchedCount: 0,
      upsertedCount: 1,
      upsertedId: inserted._id,
    };
  }

  find(query = {}) {
    return new FakeMongoCursor(
      this.documents.filter((item) => matches(item, query)),
    );
  }
}


class FakeMongoCursor {
  constructor(documents) {
    this.documents = structuredClone(documents);
  }

  sort(specification) {
    const fields = Object.entries(specification);
    this.documents.sort((left, right) => {
      for (const [field, direction] of fields) {
        if (left[field] === right[field]) continue;
        return (left[field] < right[field] ? -1 : 1) * direction;
      }
      return 0;
    });
    return this;
  }

  limit(limit) {
    this.documents = this.documents.slice(0, limit);
    return this;
  }

  async toArray() {
    return structuredClone(this.documents);
  }
}


function matches(document, query) {
  return Object.entries(query).every(([field, condition]) => {
    if (field === "$or") {
      return condition.some((branch) => matches(document, branch));
    }
    if (field === "$and") {
      return condition.every((branch) => matches(document, branch));
    }
    const value = document[field];
    if (
      condition &&
      typeof condition === "object" &&
      !Array.isArray(condition) &&
      !(condition instanceof Date)
    ) {
      return Object.entries(condition).every(([operator, expected]) => {
        switch (operator) {
          case "$lt":
            return value < expected;
          case "$gt":
            return value > expected;
          case "$eq":
            return value === expected;
          case "$exists":
            return expected ? value !== undefined : value === undefined;
          default:
            throw new Error(`Unsupported fake Mongo operator: ${operator}`);
        }
      });
    }
    return value === condition;
  });
}


function equalityFields(query) {
  return Object.fromEntries(
    Object.entries(query).filter(
      ([field, value]) =>
        !field.startsWith("$") &&
        (value === null || typeof value !== "object" || Array.isArray(value)),
    ),
  );
}
