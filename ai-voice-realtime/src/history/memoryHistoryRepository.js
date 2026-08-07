import { historyEventSchema, historySessionSchema } from "./historySchemas.js";
import { HistoryRepository } from "./historyRepository.js";

const SESSION_LIMIT_MAX = 50;
const EVENT_LIMIT_MAX = 100;

export class MemoryHistoryRepository extends HistoryRepository {
  constructor() {
    super();
    this.sessions = new Map();
    this.events = new Map();
  }

  upsertSession(input) {
    const session = historySessionSchema.parse(input);
    this.sessions.set(session.sessionId, clone(session));
    return clone(session);
  }

  archiveEvent(input) {
    const event = historyEventSchema.parse(input);
    if (this.events.has(event.id)) {
      return { inserted: false, event: clone(this.events.get(event.id)) };
    }
    this.events.set(event.id, clone(event));
    return { inserted: true, event: clone(event) };
  }

  listSessions({ limit = 12, cursor = null } = {}) {
    const safeLimit = clampLimit(limit, 12, SESSION_LIMIT_MAX);
    const decodedCursor = cursor ? decodeCursor(cursor, "sessions") : null;
    const ordered = [...this.sessions.values()].sort(compareSessions);
    const filtered = decodedCursor
      ? ordered.filter((session) => isSessionAfterCursor(session, decodedCursor))
      : ordered;
    const items = filtered.slice(0, safeLimit);
    return {
      items: clone(items),
      nextCursor: filtered.length > safeLimit
        ? encodeCursor("sessions", sessionTuple(items.at(-1)))
        : null,
    };
  }

  getSession(sessionId) {
    const session = this.sessions.get(sessionId);
    return session ? clone(session) : null;
  }

  listSessionEvents(sessionId, {
    limit = 50,
    cursor = null,
    eventType,
    eventId,
  } = {}) {
    const safeLimit = clampLimit(limit, 50, EVENT_LIMIT_MAX);
    const decodedCursor = cursor
      ? decodeCursor(cursor, "events", {
        sessionId,
        eventType: eventType ?? null,
        eventId: eventId ?? null,
      })
      : null;
    const ordered = [...this.events.values()]
      .filter((event) => event.sessionId === sessionId)
      .filter((event) => !eventType || event.eventType === eventType)
      .filter((event) => !eventId || event.id === eventId)
      .sort(compareEvents);
    const filtered = decodedCursor
      ? ordered.filter((event) => isEventAfterCursor(event, decodedCursor))
      : ordered;
    const items = filtered.slice(0, safeLimit);
    return {
      items: clone(items),
      nextCursor: filtered.length > safeLimit
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
    this.sessions.clear();
    this.events.clear();
  }
}

function compareSessions(left, right) {
  return right.startedAt.localeCompare(left.startedAt)
    || right.sessionId.localeCompare(left.sessionId);
}

function compareEvents(left, right) {
  return left.timestampSeconds - right.timestampSeconds
    || left.id.localeCompare(right.id);
}

function sessionTuple(session) {
  return { startedAt: session.startedAt, sessionId: session.sessionId };
}

function eventTuple(event) {
  return { timestampSeconds: event.timestampSeconds, id: event.id };
}

function isSessionAfterCursor(session, cursor) {
  return session.startedAt < cursor.startedAt
    || (session.startedAt === cursor.startedAt && session.sessionId < cursor.sessionId);
}

function isEventAfterCursor(event, cursor) {
  return event.timestampSeconds > cursor.timestampSeconds
    || (event.timestampSeconds === cursor.timestampSeconds && event.id > cursor.id);
}

function encodeCursor(kind, value) {
  return Buffer.from(JSON.stringify({ version: 1, kind, ...value }), "utf8")
    .toString("base64url");
}

function decodeCursor(cursor, expectedKind, expected = {}) {
  try {
    const decoded = JSON.parse(Buffer.from(cursor, "base64url").toString("utf8"));
    if (decoded?.version !== 1 || decoded.kind !== expectedKind) throw new Error();
    if (expectedKind === "sessions") {
      if (typeof decoded.startedAt !== "string" || typeof decoded.sessionId !== "string") {
        throw new Error();
      }
      historySessionSchema.shape.sessionId.parse(decoded.sessionId);
      historySessionSchema.shape.startedAt.parse(decoded.startedAt);
    } else if (
      !Number.isFinite(decoded.timestampSeconds)
      || decoded.timestampSeconds < 0
      || typeof decoded.id !== "string"
    ) {
      throw new Error();
    } else {
      historyEventSchema.shape.id.parse(decoded.id);
      if (decoded.sessionId !== expected.sessionId) throw new Error();
      if ((decoded.eventType ?? null) !== (expected.eventType ?? null)) throw new Error();
      if ((decoded.eventId ?? null) !== (expected.eventId ?? null)) throw new Error();
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
