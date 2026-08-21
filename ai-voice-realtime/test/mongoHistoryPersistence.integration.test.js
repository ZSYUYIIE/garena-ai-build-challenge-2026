import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";

import { MongoClient } from "mongodb";

import { upsertMongoEventFields } from "../src/events/mongoEventUpsert.js";
import { HistoryArchiveQueue } from "../src/history/historyArchiveQueue.js";
import { HistoryService } from "../src/history/historyService.js";
import { MongoHistoryRepository } from "../src/history/mongoHistoryRepository.js";

const mongoUri = process.env.MONGODB_TEST_URI;

test(
  "real MongoDB persists one Live session and shared history/semantic event fields",
  { skip: !mongoUri },
  async (t) => {
    const client = new MongoClient(mongoUri, {
      serverSelectionTimeoutMS: 5_000,
    });
    await client.connect();
    const databaseName = `streamsense_history_${randomUUID().replaceAll("-", "")}`;
    const database = client.db(databaseName);
    t.after(async () => {
      await database.dropDatabase();
      await client.close();
    });

    const sessions = database.collection("sessions");
    const events = database.collection("events");
    const repository = new MongoHistoryRepository({
      sessionsCollection: sessions,
      eventsCollection: events,
    });
    await repository.ensureIndexes();

    let now = Date.parse("2026-08-17T04:00:00.000Z");
    const service = new HistoryService({
      repository,
      now: () => now,
    });
    const queue = new HistoryArchiveQueue({
      historyService: service,
      retryDelayMs: 0,
    });
    const sessionId = randomUUID();
    const eventId = randomUUID();

    assert.equal(
      queue.startSession({
        sessionId,
        startedAt: new Date(now).toISOString(),
        title: "StreamSense session",
        domain: "unknown",
        sourceLabel: "Authorized browser tab",
        dataOrigin: "realtime",
      }),
      true,
    );
    now += 42_000;
    assert.equal(
      queue.archiveEvent({
        id: eventId,
        sessionId,
        timestampSeconds: 42,
        eventType: "counterattack",
        entities: ["England", "Player 4"],
        description: "England breaks quickly through midfield.",
        importance: 0.86,
        confidence: 0.91,
      }),
      true,
    );
    now += 18_000;
    assert.equal(
      queue.finishSession({
        sessionId,
        endedAt: new Date(now).toISOString(),
        durationSeconds: 60,
      }),
      true,
    );
    assert.equal(await queue.drain({ timeoutMs: 5_000 }), true);

    // Simulate a backend restart by creating a fresh repository instance over
    // the same database rather than retaining process-local Maps.
    const reopened = new MongoHistoryRepository({
      sessionsCollection: sessions,
      eventsCollection: events,
    });
    const storedSession = await reopened.getSession(sessionId);
    const storedEvents = await reopened.listSessionEvents(sessionId);

    assert.equal(storedSession.sessionId, sessionId);
    assert.equal(storedSession.endedAt, "2026-08-17T04:01:00.000Z");
    assert.equal(storedSession.durationSeconds, 60);
    assert.equal(storedSession.eventCount, 1);
    assert.equal(storedSession.importantEventCount, 1);
    assert.deepEqual(storedEvents.items.map((event) => event.id), [eventId]);

    // Exercise the same-document contract with a genuine Mongo unique index:
    // semantic enrichment must preserve chronological history fields.
    await upsertMongoEventFields(events, eventId, {
      embedding: [0.25, 0.5, 0.75],
      semanticIndexed: true,
    });
    const sharedDocument = await events.findOne({ id: eventId });
    assert.equal(sharedDocument.historyArchived, true);
    assert.equal(sharedDocument.description, "England breaks quickly through midfield.");
    assert.deepEqual(sharedDocument.embedding, [0.25, 0.5, 0.75]);
  },
);
