import type {
  ContextGraphResponse,
  HistoryEvent,
  SearchResponse,
  Session,
} from "../api/contracts";

export const sessionId = "11111111-1111-4111-8111-111111111111";
export const secondSessionId = "22222222-2222-4222-8222-222222222222";
export const firstEventId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
export const secondEventId = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

export const demoSession: Session = {
  sessionId,
  startedAt: "2026-08-01T12:00:00.000Z",
  endedAt: "2026-08-01T13:42:00.000Z",
  durationSeconds: 6_120,
  title: "Team A vs Team B",
  domain: "Football",
  sourceLabel: "Garena Sports Live",
  summary:
    "Team A recovered from early pressure and won after a decisive second-half counterattack.",
  eventCount: 12,
  importantEventCount: 8,
  entities: ["Team A", "Team B", "Player 9"],
  topics: ["Counterattack", "Defensive save", "Momentum shift"],
  createdAt: "2026-08-01T12:00:00.000Z",
  updatedAt: "2026-08-01T13:42:00.000Z",
};

export const secondDemoSession: Session = {
  ...demoSession,
  sessionId: secondSessionId,
  startedAt: "2026-07-30T10:00:00.000Z",
  endedAt: "2026-07-30T10:48:00.000Z",
  durationSeconds: 2_880,
  title: "Crimson Five vs Northstar",
  domain: "Esports",
  sourceLabel: "Arena Championship",
  summary:
    "Crimson Five secured the final objective after absorbing a long defensive teamfight.",
  eventCount: 10,
  importantEventCount: 6,
  entities: ["Crimson Five", "Northstar"],
  topics: ["Teamfight", "Objective control", "Comeback"],
  createdAt: "2026-07-30T10:00:00.000Z",
  updatedAt: "2026-07-30T10:48:00.000Z",
};

export const laterEvent: HistoryEvent = {
  id: secondEventId,
  sessionId,
  timestampSeconds: 222,
  timestamp: "03:42",
  eventType: "shot_saved",
  entities: ["Team A", "Player 9"],
  description: "The goalkeeper saves Player 9's close-range shot.",
  importance: 0.91,
  confidence: 0.88,
  createdAt: "2026-08-01T12:03:42.000Z",
  topicLabels: ["Defensive save"],
};

export const earlierEvent: HistoryEvent = {
  id: firstEventId,
  sessionId,
  timestampSeconds: 95,
  timestamp: "01:35",
  eventType: "dangerous_attack",
  entities: ["Team A"],
  description: "Three Team A attackers enter the penalty area.",
  importance: 0.76,
  confidence: 0.9,
  createdAt: "2026-08-01T12:01:35.000Z",
  topicLabels: ["Final-third pressure"],
};

export const demoSearchResponse: SearchResponse = {
  meta: { dataOrigin: "demo" },
  retrievalMode: "semantic",
  results: [
    {
      sessionId,
      sessionTitle: demoSession.title,
      eventId: secondEventId,
      timestampSeconds: 222,
      timestamp: "03:42",
      eventType: "shot_saved",
      description: laterEvent.description,
      entities: laterEvent.entities,
      topics: ["Defensive save"],
      similarity: 0.93,
    },
  ],
};

export const demoGraphResponse: ContextGraphResponse = {
  meta: { dataOrigin: "demo" },
  nodes: [
    {
      id: `session:${sessionId}`,
      type: "session",
      label: demoSession.title,
      sessionId,
    },
    {
      id: `event:${secondEventId}`,
      type: "event",
      label: "Close-range shot saved",
      sessionId,
      eventId: secondEventId,
      importance: 0.91,
    },
    {
      id: "topic:defensive-save",
      type: "topic",
      label: "Defensive save",
    },
  ],
  edges: [
    {
      id: "edge:session-event",
      source: `session:${sessionId}`,
      target: `event:${secondEventId}`,
      type: "same_session",
      weight: 1,
    },
    {
      id: "edge:event-topic",
      source: `event:${secondEventId}`,
      target: "topic:defensive-save",
      type: "shared_topic",
      weight: 0.91,
    },
  ],
};

export function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}
