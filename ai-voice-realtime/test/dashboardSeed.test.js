import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import test from "node:test";

import { EventStore } from "../src/events/eventStore.js";
import {
  createDemoHistory,
  DEMO_DATA_LABEL,
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
  assert.equal(first.sessions.length, 3);
  assert.deepEqual(first.sessions.map((session) => session.eventCount), [12, 10, 10]);
  first.sessions.forEach((session) => historySessionSchema.parse(session));
  first.events.forEach((event) => historyEventSchema.parse(event));

  const eventTypes = new Set(first.events.map((event) => event.eventType));
  for (const required of [
    "shot_saved",
    "goal",
    "dangerous_attack",
    "possession_change",
    "substitution",
    "penalty",
    "teamfight",
    "objective_taken",
  ]) {
    assert.equal(eventTypes.has(required), true, required);
  }
  const topics = new Set(first.events.flatMap((event) => event.topicLabels));
  for (const required of [
    "Counterattack",
    "Defensive save",
    "Momentum shift",
    "Final-third pressure",
    "Comeback",
    "Substitution impact",
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
  }
  assert.deepEqual(findForbiddenKeys(first), []);
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
