import { MongoClient } from "mongodb";

import { historyEventSchema, historySessionSchema } from "./historySchemas.js";
import { HistoryRepository } from "./historyRepository.js";

const DEFAULT_DATABASE_NAME = "streamsense";
const SESSION_COLLECTION_NAME = "sessions";
const EVENT_COLLECTION_NAME = "events";
const SESSION_LIMIT_MAX = 50;
const EVENT_LIMIT_MAX = 100;

/** Durable chronological history backed by the same MongoDB database as semantic events. */
export class MongoHistoryRepository extends HistoryRepository {
  static async connect({
    uri,
    databaseName = DEFAULT_DATABASE_NAME,
    clientOptions = {},
  }) {
    if (!uri?.trim()) {
      throw new TypeError("MongoHistoryRepository requires a MongoDB URI");
    }
    const client = new MongoClient(uri, {
      serverSelectionTimeoutMS: 5_000,
      ...clientOptions,
    });
    await client.connect();
    const database = client.db(databaseName);
    const repository = new MongoHistoryRepository({
      sessionsCollection: database.collection(SESSION_COLLECTION_NAME),
      eventsCollection: database.collection(EVENT_COLLECTION_NAME),
      closeClient: () => client.close(),
    });
    await repository.ensureIndexes();
    return repository;
  }

  constructor({
    sessionsCollection,
    eventsCollection,
    closeClient = () => {},
  }) {
    super();
    if (!sessionsCollection || !eventsCollection) {
      throw new TypeError(
        "MongoHistoryRepository requires session and event collections",
      );
    }
    this.sessionsCollection = sessionsCollection;
    this.eventsCollection = eventsCollection;
    this.closeClient = closeClient;
  }

  async ensureIndexes() {
    await Promise.all([
      this.sessionsCollection.createIndex(
        { sessionId: 1 },
        {
          unique: true,
          name: "history_session_id_unique",
          partialFilterExpression: { sessionId: { $type: "string" } },
        },
      ),
      this.sessionsCollection.createIndex(
        { startedAt: -1, sessionId: -1 },
        { name: "history_sessions_newest" },
      ),
      this.eventsCollection.createIndex(
        { id: 1 },
        {
          unique: true,
          name: "history_event_id_unique",
          partialFilterExpression: { id: { $type: "string" } },
        },
      ),
      this.eventsCollection.createIndex(
        { historyArchived: 1, sessionId: 1, timestampSeconds: 1, id: 1 },
        { name: "history_events_chronological" },
      ),
      this.eventsCollection.createIndex(
        { historyArchived: 1, sessionId: 1, eventType: 1, timestampSeconds: 1 },
        { name: "history_events_by_type" },
      ),
    ]);
  }

  async upsertSession(input) {
    const session = historySessionSchema.parse(input);
    await this.sessionsCollection.updateOne(
      { sessionId: session.sessionId },
      {
        $set: {
          ...session,
          historyArchived: true,
        },
      },
      { upsert: true },
    );
    return clone(session);
  }

  async archiveEvent(input) {
    const event = historyEventSchema.parse(input);
    const existing = await this.eventsCollection.findOne(
      { id: event.id },
      { projection: { historyArchived: 1 } },
    );
    await this.eventsCollection.updateOne(
      { id: event.id },
      {
        $set: {
          ...event,
          historyArchived: true,
        },
      },
      { upsert: true },
    );
    return {
      inserted: existing?.historyArchived !== true,
      event: clone(event),
    };
  }

  async listSessions({ limit = 12, cursor = null } = {}) {
    const safeLimit = clampLimit(limit, 12, SESSION_LIMIT_MAX);
    const decodedCursor = cursor ? decodeCursor(cursor, "sessions") : null;
    const query = { historyArchived: true };
    if (decodedCursor) {
      query.$or = [
        { startedAt: { $lt: decodedCursor.startedAt } },
        {
          startedAt: decodedCursor.startedAt,
          sessionId: { $lt: decodedCursor.sessionId },
        },
      ];
    }
    const documents = await this.sessionsCollection
      .find(query)
      .sort({ startedAt: -1, sessionId: -1 })
      .limit(safeLimit + 1)
      .toArray();
    const items = documents
      .slice(0, safeLimit)
      .map(sessionFromDocument);
    return {
      items,
      nextCursor:
        documents.length > safeLimit && items.length
          ? encodeCursor("sessions", sessionTuple(items.at(-1)))
          : null,
    };
  }

  async getSession(sessionId) {
    const document = await this.sessionsCollection.findOne({
      sessionId,
      historyArchived: true,
    });
    return document ? sessionFromDocument(document) : null;
  }

  async listSessionEvents(
    sessionId,
    { limit = 50, cursor = null, eventType, eventId } = {},
  ) {
    const safeLimit = clampLimit(limit, 50, EVENT_LIMIT_MAX);
    const decodedCursor = cursor
      ? decodeCursor(cursor, "events", {
          sessionId,
          eventType: eventType ?? null,
          eventId: eventId ?? null,
        })
      : null;
    const query = {
      historyArchived: true,
      sessionId,
      ...(eventType ? { eventType } : {}),
      ...(eventId ? { id: eventId } : {}),
    };
    if (decodedCursor) {
      query.$or = [
        { timestampSeconds: { $gt: decodedCursor.timestampSeconds } },
        {
          timestampSeconds: decodedCursor.timestampSeconds,
          id: { $gt: decodedCursor.id },
        },
      ];
    }
    const documents = await this.eventsCollection
      .find(query)
      .sort({ timestampSeconds: 1, id: 1 })
      .limit(safeLimit + 1)
      .toArray();
    const items = documents.slice(0, safeLimit).map(eventFromDocument);
    return {
      items,
      nextCursor:
        documents.length > safeLimit && items.length
          ? encodeCursor("events", {
              ...eventTuple(items.at(-1)),
              sessionId,
              eventType: eventType ?? null,
              eventId: eventId ?? null,
            })
          : null,
    };
  }

  close() {
    return this.closeClient();
  }
}

function sessionFromDocument(document) {
  return historySessionSchema.parse({
    sessionId: document.sessionId,
    startedAt: toIsoString(document.startedAt),
    endedAt: document.endedAt == null ? null : toIsoString(document.endedAt),
    durationSeconds: document.durationSeconds,
    title: document.title,
    domain: document.domain,
    sourceLabel: document.sourceLabel,
    summary: document.summary,
    eventCount: document.eventCount,
    importantEventCount: document.importantEventCount,
    entities: document.entities ?? [],
    topics: document.topics ?? [],
    dataOrigin: document.dataOrigin,
    createdAt: toIsoString(document.createdAt),
    updatedAt: toIsoString(document.updatedAt),
  });
}

function eventFromDocument(document) {
  return historyEventSchema.parse({
    id: document.id,
    sessionId: document.sessionId,
    timestampSeconds: document.timestampSeconds,
    timestamp: document.timestamp,
    eventType: document.eventType,
    entities: document.entities ?? [],
    description: document.description,
    importance: document.importance,
    confidence: document.confidence,
    createdAt: toIsoString(document.createdAt),
    topicLabels: document.topicLabels ?? [],
  });
}

function toIsoString(value) {
  if (typeof value === "string") return value;
  if (value instanceof Date) return value.toISOString();
  return new Date(value).toISOString();
}

function sessionTuple(session) {
  return { startedAt: session.startedAt, sessionId: session.sessionId };
}

function eventTuple(event) {
  return { timestampSeconds: event.timestampSeconds, id: event.id };
}

function encodeCursor(kind, value) {
  return Buffer.from(JSON.stringify({ version: 1, kind, ...value }), "utf8")
    .toString("base64url");
}

function decodeCursor(cursor, expectedKind, expected = {}) {
  try {
    const decoded = JSON.parse(
      Buffer.from(cursor, "base64url").toString("utf8"),
    );
    if (decoded?.version !== 1 || decoded.kind !== expectedKind) {
      throw new Error();
    }
    if (expectedKind === "sessions") {
      historySessionSchema.shape.sessionId.parse(decoded.sessionId);
      historySessionSchema.shape.startedAt.parse(decoded.startedAt);
    } else {
      if (
        !Number.isFinite(decoded.timestampSeconds) ||
        decoded.timestampSeconds < 0
      ) {
        throw new Error();
      }
      historyEventSchema.shape.id.parse(decoded.id);
      if (decoded.sessionId !== expected.sessionId) throw new Error();
      if ((decoded.eventType ?? null) !== (expected.eventType ?? null)) {
        throw new Error();
      }
      if ((decoded.eventId ?? null) !== (expected.eventId ?? null)) {
        throw new Error();
      }
    }
    return decoded;
  } catch {
    const error = new Error("The pagination cursor is invalid or expired.");
    error.code = "INVALID_CURSOR";
    throw error;
  }
}

function clampLimit(value, fallback, maximum) {
  const numeric = Number(value);
  if (!Number.isInteger(numeric) || numeric < 1) return fallback;
  return Math.min(numeric, maximum);
}

function clone(value) {
  return structuredClone(value);
}
