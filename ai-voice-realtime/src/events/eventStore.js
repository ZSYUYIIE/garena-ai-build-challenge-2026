import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";

import Database from "better-sqlite3";

import { findDuplicateEvent } from "./deduplicate.js";
import { eventRecordInputSchema, formatTimestamp } from "./eventSchema.js";

export class EventStore {
  constructor({ databasePath = ":memory:" } = {}) {
    if (databasePath !== ":memory:") {
      fs.mkdirSync(path.dirname(databasePath), { recursive: true });
    }

    this.database = new Database(databasePath);
    if (databasePath !== ":memory:") {
      this.database.pragma("journal_mode = WAL");
    }
    this.database.pragma("foreign_keys = ON");

    this.database.exec(`
      CREATE TABLE IF NOT EXISTS events (
        id TEXT PRIMARY KEY,
        session_id TEXT NOT NULL,
        timestamp_seconds REAL NOT NULL CHECK (timestamp_seconds >= 0),
        event_type TEXT NOT NULL,
        entities_json TEXT NOT NULL,
        description TEXT NOT NULL,
        importance REAL NOT NULL CHECK (importance BETWEEN 0 AND 1),
        confidence REAL NOT NULL CHECK (confidence BETWEEN 0 AND 1),
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      );

      CREATE INDEX IF NOT EXISTS events_session_timestamp_idx
      ON events (session_id, timestamp_seconds DESC);
    `);

    this.insertStatement = this.database.prepare(`
      INSERT INTO events (
        id,
        session_id,
        timestamp_seconds,
        event_type,
        entities_json,
        description,
        importance,
        confidence
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);

    this.recentStatement = this.database.prepare(`
      SELECT *
      FROM events
      WHERE session_id = ?
        AND timestamp_seconds >= ?
      ORDER BY timestamp_seconds DESC
      LIMIT ?
    `);

    this.listStatement = this.database.prepare(`
      SELECT *
      FROM events
      WHERE session_id = ?
      ORDER BY timestamp_seconds DESC
      LIMIT ?
    `);
  }

  record(input, { duplicateWindowSeconds = 12 } = {}) {
    const candidate = eventRecordInputSchema.parse(input);
    const recentEvents = this.recentStatement
      .all(
        candidate.sessionId,
        Math.max(0, candidate.timestampSeconds - duplicateWindowSeconds),
        25
      )
      .map(toEvent);

    const duplicate = findDuplicateEvent(candidate, recentEvents, {
      windowSeconds: duplicateWindowSeconds,
    });
    if (duplicate) {
      return { status: "duplicate", event: duplicate };
    }

    const event = {
      id: randomUUID(),
      ...candidate,
      timestamp: formatTimestamp(candidate.timestampSeconds),
    };

    this.insertStatement.run(
      event.id,
      event.sessionId,
      event.timestampSeconds,
      event.eventType,
      JSON.stringify(event.entities),
      event.description,
      event.importance,
      event.confidence
    );

    return { status: "recorded", event };
  }

  listBySession(sessionId, { limit = 100 } = {}) {
    const safeLimit = Math.max(1, Math.min(Number(limit) || 100, 500));
    return this.listStatement.all(sessionId, safeLimit).map(toEvent);
  }

  close() {
    this.database.close();
  }
}

function toEvent(row) {
  return {
    id: row.id,
    sessionId: row.session_id,
    timestampSeconds: row.timestamp_seconds,
    timestamp: formatTimestamp(row.timestamp_seconds),
    eventType: row.event_type,
    entities: JSON.parse(row.entities_json),
    description: row.description,
    importance: row.importance,
    confidence: row.confidence,
  };
}
