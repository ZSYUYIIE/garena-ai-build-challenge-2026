import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import test from "node:test";

import { EventStore } from "../src/events/eventStore.js";
import { buildContextGraph } from "../src/history/contextGraph.js";
import {
  createDemoHistory,
  DEMO_DATA_LABEL,
  DEMO_SESSION_TITLES,
} from "../src/history/demoHistory.js";
import {
  historyEventSchema,
  historySessionSchema,
  normalizeHistoryEvent,
} from "../src/history/historySchemas.js";

test("dashboard demo history is deterministic and production-schema compatible", () => {
  const first = createDemoHistory();
  const second = createDemoHistory();

  assert.deepEqual(first, second);
  assert.equal(first.label, DEMO_DATA_LABEL);
  assert.equal(first.sessions.length, 5);
  assert.deepEqual(
    first.sessions.map((session) => session.title),
    Object.values(DEMO_SESSION_TITLES),
  );
  assert.equal(
    first.sessions.some((session) => session.title === "StreamSense session"),
    false,
  );
  assert.deepEqual(first.sessions.map((session) => session.eventCount), [5, 5, 5, 5, 5]);
  first.sessions.forEach((session) => historySessionSchema.parse(session));
  first.events.forEach((event) => historyEventSchema.parse(event));

  const eventTypes = new Set(first.events.map((event) => event.eventType));
  for (const required of [
    "shot_saved",
    "goal",
    "teamfight",
    "objective_taken",
    "audience_singalong",
    "product_revealed",
    "prototype_tested",
  ]) {
    assert.equal(eventTypes.has(required), true, required);
  }
  const topics = new Set(first.events.flatMap((event) => event.topicLabels));
  for (const required of [
    "Turning point",
    "Audience reaction",
    "Match momentum",
    "Objective control",
    "Set highlight",
    "Product reveal",
    "Live collaboration",
  ]) {
    assert.equal(topics.has(required), true, required);
  }

  for (const session of first.sessions) {
    const events = first.events.filter((event) => event.sessionId === session.sessionId);
    assert.equal(session.eventCount, events.length);
    assert.equal(
      session.importantEventCount,
      events.filter((event) => event.importance >= 0.75).length,
    );
    assert.equal(session.dataOrigin, "demo");
    assert.match(session.sourceLabel, /DEVELOPMENT \/ DEMO DATA/);
    assert.equal(session.entities.length, 3);
    assert.equal(session.topics.length, 2);
  }
  assert.deepEqual(findForbiddenKeys(first), []);
});

test("dashboard demo projects five bounded judge-friendly entertainment lanes", () => {
  const demo = createDemoHistory();
  const graph = buildContextGraph({
    sessions: demo.sessions,
    sessionEvents: new Map(
      demo.sessions.map((session) => [
        session.sessionId,
        demo.events.filter((event) => event.sessionId === session.sessionId),
      ]),
    ),
    limit: 80,
  });

  assert.ok(graph.nodes.length <= 80);
  assert.equal(graph.nodes.filter((node) => node.type === "event").length, 25);
  assert.deepEqual(
    graph.nodes
      .filter((node) => node.type === "session")
      .map((node) => node.label),
    Object.values(DEMO_SESSION_TITLES),
  );
  assert.deepEqual(
    new Set(graph.nodes.map((node) => node.type)),
    new Set(["session", "event", "entity", "topic"]),
  );
  assert.equal(
    graph.nodes.some(
      (node) => node.type === "entity" && node.label === "Mateo Silva",
    ),
    true,
  );
  assert.equal(
    graph.nodes.some(
      (node) => node.type === "entity" && node.label === "Elder Dragon",
    ),
    true,
  );

  const turningPoint = graph.nodes.find(
    (node) => node.type === "topic" && node.label === "Turning point",
  );
  const eventsById = new Map(
    graph.nodes
      .filter((node) => node.type === "event")
      .map((node) => [node.id, node]),
  );
  const connectedDomains = new Set(
    graph.edges
      .filter(
        (edge) => edge.type === "shared_topic" && edge.target === turningPoint.id,
      )
      .map((edge) => eventsById.get(edge.source)?.sessionId)
      .map(
        (sessionId) =>
          demo.sessions.find((session) => session.sessionId === sessionId)?.domain,
      ),
  );
  assert.deepEqual(connectedDomains, new Set(["football", "esports"]));

  const audienceReaction = graph.nodes.find(
    (node) => node.type === "topic" && node.label === "Audience reaction",
  );
  const audienceDomains = new Set(
    graph.edges
      .filter(
        (edge) =>
          edge.type === "shared_topic" && edge.target === audienceReaction.id,
      )
      .map((edge) => eventsById.get(edge.source)?.sessionId)
      .map(
        (sessionId) =>
          demo.sessions.find((session) => session.sessionId === sessionId)?.domain,
      ),
  );
  assert.deepEqual(
    audienceDomains,
    new Set(["concert", "product launch", "creator livestream"]),
  );
});

test("a realtime EventStore result normalizes without changing its public shape", () => {
  const store = new EventStore();
  try {
    const recorded = store.record({
      sessionId: randomUUID(),
      timestampSeconds: 42.25,
      eventType: "shot_saved",
      entities: ["Player 9"],
      description: "The goalkeeper stops the shot.",
      importance: 0.8,
      confidence: 0.9,
    });
    const original = structuredClone(recorded.event);
    const historical = normalizeHistoryEvent(recorded.event, {
      createdAt: "2026-07-20T09:00:42.250Z",
      topicLabels: ["Defensive save"],
    });

    assert.deepEqual(recorded.event, original);
    assert.equal(historical.id, recorded.event.id);
    assert.equal(historical.timestamp, "00:42");
    assert.deepEqual(historical.topicLabels, ["Defensive save"]);
  } finally {
    store.close();
  }
});

test("demo export and startup scripts fail closed in production", () => {
  const projectDirectory = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    "..",
  );
  const demoPath = path.join(projectDirectory, "data", "dashboard-demo.json");
  const before = fs.existsSync(demoPath) ? fs.readFileSync(demoPath) : null;

  for (const script of [
    "scripts/exportDashboardSeed.js",
    "scripts/startDashboardDemo.js",
  ]) {
    const result = spawnSync(process.execPath, [script], {
      cwd: projectDirectory,
      env: { ...process.env, NODE_ENV: "production" },
      encoding: "utf8",
      timeout: 5_000,
    });
    assert.notEqual(result.status, 0, script);
    assert.match(`${result.stdout}\n${result.stderr}`, /production/i, script);
  }

  const after = fs.existsSync(demoPath) ? fs.readFileSync(demoPath) : null;
  assert.deepEqual(after, before);
});

function findForbiddenKeys(value, path = "history") {
  const forbidden = new Set([
    "audio",
    "rawAudio",
    "video",
    "frame",
    "transcript",
    "credential",
    "apiKey",
  ]);
  const found = [];
  if (!value || typeof value !== "object") return found;
  for (const [key, child] of Object.entries(value)) {
    if (forbidden.has(key)) found.push(`${path}.${key}`);
    found.push(...findForbiddenKeys(child, `${path}.${key}`));
  }
  return found;
}
