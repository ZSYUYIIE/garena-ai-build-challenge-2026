import {
  aggregateDataOrigin,
  historySessionSchema,
  normalizeHistoryEvent,
  semanticSearchInputSchema,
  semanticSearchResultSchema,
} from "./historySchemas.js";
import { buildContextGraph } from "./contextGraph.js";
import { UnavailableSemanticHistoryService } from "./semanticHistoryService.js";

const IMPORTANT_EVENT_THRESHOLD = 0.75;
const MAX_SUMMARY_EVENTS = 500;

export class HistoryService {
  constructor({
    repository,
    semanticHistoryService = new UnavailableSemanticHistoryService(),
    now = Date.now,
    onSemanticError = () => {},
  }) {
    if (!repository) throw new TypeError("HistoryService requires a repository");
    this.repository = repository;
    this.semanticHistoryService = semanticHistoryService;
    this.now = now;
    this.onSemanticError = onSemanticError;
  }

  async startSession({
    sessionId,
    startedAt = new Date(this.now()).toISOString(),
    title = "StreamSense session",
    domain = "unknown",
    sourceLabel = "Authorized browser tab",
    dataOrigin = "realtime",
  }) {
    const existing = await this.repository.getSession(sessionId);
    if (existing) return existing;
    const session = historySessionSchema.parse({
      sessionId,
      startedAt,
      endedAt: null,
      durationSeconds: 0,
      title,
      domain,
      sourceLabel,
      summary: "No significant moments have been recorded yet.",
      eventCount: 0,
      importantEventCount: 0,
      entities: [],
      topics: [],
      dataOrigin,
      createdAt: startedAt,
      updatedAt: startedAt,
    });
    return this.repository.upsertSession(session);
  }

  async archiveEvent(input) {
    const event = normalizeHistoryEvent(input, {
      createdAt: new Date(this.now()).toISOString(),
      topicLabels: input.topicLabels ?? [humanizeEventType(input.eventType)],
    });
    let session = await this.repository.getSession(event.sessionId);
    if (!session) {
      const inferredStart = new Date(
        Date.parse(event.createdAt) - event.timestampSeconds * 1_000,
      ).toISOString();
      session = await this.startSession({
        sessionId: event.sessionId,
        startedAt: inferredStart,
      });
    }

    const archived = await this.repository.archiveEvent(event);
    // Rebuild from the authoritative event collection even for a duplicate. If a
    // previous attempt inserted the event but failed while updating the session,
    // retrying must repair the aggregate instead of permanently under-counting it.
    const events = await collectSessionEvents(this.repository, event.sessionId);
    const aggregate = aggregateEvents(events);
    const domain = session.domain === "unknown"
      ? inferDomain(events.map((item) => item.eventType))
      : session.domain;
    await this.repository.upsertSession({
      ...session,
      domain,
      ...aggregate,
      summary: `${aggregate.eventCount} significant ${aggregate.eventCount === 1 ? "moment" : "moments"} recorded so far.`,
      updatedAt: latestIsoDate(session.updatedAt, ...events.map((item) => item.createdAt)),
    });
    return archived;
  }

  async finishSession({
    sessionId,
    endedAt = new Date(this.now()).toISOString(),
    durationSeconds,
  }) {
    const session = await this.repository.getSession(sessionId);
    if (!session) return null;
    const events = await collectSessionEvents(this.repository, sessionId);
    const aggregate = aggregateEvents(events);
    const domain = session.domain === "unknown"
      ? inferDomain(events.map((event) => event.eventType))
      : session.domain;
    const safeDuration = Number.isFinite(durationSeconds)
      ? Math.max(0, durationSeconds)
      : Math.max(0, (Date.parse(endedAt) - Date.parse(session.startedAt)) / 1_000);
    const title = session.title === "StreamSense session"
      ? inferTitle(aggregate.entities)
      : session.title;
    const finished = historySessionSchema.parse({
      ...session,
      title,
      domain,
      ...aggregate,
      endedAt,
      durationSeconds: safeDuration,
      summary: buildFallbackSummary(events, { domain }),
      updatedAt: endedAt,
    });
    return this.repository.upsertSession(finished);
  }

  async listSessions(options = {}) {
    const page = await this.repository.listSessions(options);
    return {
      meta: { dataOrigin: aggregateDataOrigin(page.items) },
      sessions: page.items.map(toPublicSession),
      nextCursor: page.nextCursor,
    };
  }

  async getSession(sessionId) {
    const session = await this.repository.getSession(sessionId);
    if (!session) return null;
    return {
      meta: { dataOrigin: session.dataOrigin },
      session: toPublicSession(session),
    };
  }

  async listSessionEvents(sessionId, options = {}) {
    const session = await this.repository.getSession(sessionId);
    if (!session) return null;
    const page = await this.repository.listSessionEvents(sessionId, options);
    return {
      meta: { dataOrigin: session.dataOrigin },
      events: page.items,
      nextCursor: page.nextCursor,
    };
  }

  async searchSimilarEvents(input) {
    const request = semanticSearchInputSchema.parse(input);
    try {
      const response = await this.semanticHistoryService.searchSimilarEvents(request);
      const results = (response?.results ?? [])
        .slice(0, request.limit)
        .map((result) => semanticSearchResultSchema.parse(result));
      return {
        meta: {
          dataOrigin: ["demo", "realtime", "mixed", "empty"].includes(response?.dataOrigin)
            ? response.dataOrigin
            : (results.length ? "realtime" : "empty"),
        },
        results,
        retrievalMode: response?.retrievalMode === "semantic"
          ? "semantic"
          : "unavailable",
        ...(response?.warning ? { warning: String(response.warning).slice(0, 500) } : {}),
      };
    } catch (error) {
      this.onSemanticError(error);
      return {
        meta: { dataOrigin: "empty" },
        results: [],
        retrievalMode: "unavailable",
        warning: "Similar moments are temporarily unavailable. Session history is still available.",
      };
    }
  }

  async getContextGraph({ sessionId, domain, query, limit = 80 } = {}) {
    let sessions;
    if (sessionId) {
      const session = await this.repository.getSession(sessionId);
      sessions = session ? [session] : [];
    } else {
      sessions = (await this.repository.listSessions({ limit: 50 })).items;
    }
    if (domain) {
      sessions = sessions.filter(
        (session) => session.domain.toLowerCase() === domain.toLowerCase(),
      );
    }
    if (query) {
      const needle = query.trim().toLowerCase();
      sessions = sessions.filter((session) => [
        session.title,
        session.summary,
        ...session.entities,
        ...session.topics,
      ].some((value) => value.toLowerCase().includes(needle)));
    }

    const sessionEvents = new Map();
    for (const session of sessions) {
      sessionEvents.set(
        session.sessionId,
        await collectSessionEvents(this.repository, session.sessionId, 100),
      );
    }
    const graph = buildContextGraph({ sessions, sessionEvents, limit });
    return {
      meta: { dataOrigin: aggregateDataOrigin(sessions) },
      ...graph,
    };
  }

  async close() {
    await this.repository.close?.();
  }
}

function toPublicSession({ dataOrigin: _dataOrigin, ...session }) {
  return session;
}

async function collectSessionEvents(repository, sessionId, maximum = MAX_SUMMARY_EVENTS) {
  const events = [];
  let cursor = null;
  do {
    const page = await repository.listSessionEvents(sessionId, {
      limit: Math.min(100, maximum - events.length),
      cursor,
    });
    events.push(...page.items);
    cursor = page.nextCursor;
  } while (cursor && events.length < maximum);
  return events;
}

function appendUnique(existing, additions, maximum) {
  const result = [...existing];
  const seen = new Set(result.map((value) => value.toLocaleLowerCase()));
  for (const value of additions) {
    const normalized = value.trim();
    const key = normalized.toLocaleLowerCase();
    if (!normalized || seen.has(key)) continue;
    result.push(normalized);
    seen.add(key);
    if (result.length >= maximum) break;
  }
  return result;
}

function aggregateEvents(events) {
  let entities = [];
  let topics = [];
  for (const event of events) {
    entities = appendUnique(entities, event.entities, 100);
    topics = appendUnique(
      topics,
      event.topicLabels.length
        ? event.topicLabels
        : [humanizeEventType(event.eventType)],
      100,
    );
  }
  return {
    eventCount: events.length,
    importantEventCount: events.filter(
      (event) => event.importance >= IMPORTANT_EVENT_THRESHOLD,
    ).length,
    entities,
    topics,
  };
}

function latestIsoDate(...values) {
  return values
    .filter((value) => typeof value === "string")
    .sort((left, right) => right.localeCompare(left))[0];
}

function humanizeEventType(eventType) {
  return eventType
    .split("_")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function inferDomain(eventTypes) {
  const esports = new Set(["teamfight", "objective_taken", "elimination"]);
  const football = new Set([
    "goal",
    "shot_saved",
    "dangerous_attack",
    "possession_change",
    "substitution",
    "penalty",
    "counterattack",
  ]);
  if (eventTypes.some((eventType) => esports.has(eventType))) return "esports";
  if (eventTypes.some((eventType) => football.has(eventType))) return "football";
  return "unknown";
}

function inferTitle(entities) {
  if (entities.length >= 2) return `${entities[0]} and ${entities[1]}`;
  if (entities.length === 1) return `Session featuring ${entities[0]}`;
  return "StreamSense session";
}

function buildFallbackSummary(events, { domain }) {
  if (!events.length) return "No significant moments were recorded in this session.";
  const important = [...events]
    .sort((left, right) => right.importance - left.importance)
    .slice(0, 3);
  const prefix = domain === "unknown"
    ? "StreamSense recorded"
    : `This ${domain} session included`;
  const highlights = important.map((event) => event.description).join(" ");
  return `${prefix} ${events.length} significant ${events.length === 1 ? "moment" : "moments"}. ${highlights}`
    .slice(0, 2_000);
}
