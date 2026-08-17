import { generateQueryEmbedding } from "../context-builder/embedding.js";
import { getContextDataFromMongo } from "../context-builder/mongo.js";
import { formatTimestamp } from "../events/eventSchema.js";

/** Dashboard semantic search over the same durable MongoDB event documents. */
export class MongoSemanticHistoryService {
  constructor({
    repository,
    embedQuery = generateQueryEmbedding,
    searchEvents = ({ sessionId, queryEmbedding, limit }) =>
      getContextDataFromMongo(sessionId, queryEmbedding, limit),
  }) {
    if (!repository) {
      throw new TypeError("MongoSemanticHistoryService requires a history repository");
    }
    this.repository = repository;
    this.embedQuery = embedQuery;
    this.searchEvents = searchEvents;
  }

  async searchSimilarEvents({ query, sessionId, domain, limit = 10 }) {
    const queryEmbedding = await this.embedQuery(query);
    const requestedLimit = Math.max(1, Math.min(Number(limit) || 10, 50));
    const searchLimit = domain
      ? Math.min(50, Math.max(requestedLimit, requestedLimit * 5))
      : requestedLimit;
    const matches = await this.searchEvents({
      sessionId: sessionId ?? null,
      queryEmbedding,
      limit: searchLimit,
    });
    const sessions = new Map();
    const results = [];

    for (const match of matches ?? []) {
      if (results.length >= requestedLimit) break;
      const eventId = match.id ?? match.eventId;
      if (!eventId || !match.sessionId) continue;
      let session = sessions.get(match.sessionId);
      if (session === undefined) {
        session = await this.repository.getSession(match.sessionId);
        sessions.set(match.sessionId, session ?? null);
      }
      if (!session) continue;
      if (
        domain &&
        session.domain.toLocaleLowerCase() !== domain.toLocaleLowerCase()
      ) {
        continue;
      }
      results.push({
        sessionId: match.sessionId,
        sessionTitle: session.title,
        eventId,
        timestampSeconds: match.timestampSeconds,
        timestamp:
          match.timestamp ?? formatTimestamp(match.timestampSeconds),
        eventType: match.eventType,
        description: match.description,
        entities: (match.entities ?? []).slice(0, 20),
        topics: (
          match.topicLabels?.length
            ? match.topicLabels
            : [humanizeEventType(match.eventType)]
        ).slice(0, 20),
        similarity: normalizeScore(match.score),
      });
    }

    return {
      results,
      retrievalMode: "semantic",
      dataOrigin: results.length ? "realtime" : "empty",
    };
  }
}

function humanizeEventType(eventType) {
  return String(eventType ?? "event")
    .split("_")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function normalizeScore(value) {
  if (!Number.isFinite(value)) return null;
  return Math.max(0, Math.min(1, value));
}
