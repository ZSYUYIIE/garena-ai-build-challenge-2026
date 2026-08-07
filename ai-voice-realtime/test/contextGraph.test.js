import assert from "node:assert/strict";
import test from "node:test";

import { createDemoHistory } from "../src/history/demoHistory.js";
import { buildContextGraph } from "../src/history/contextGraph.js";

test("context graph is bounded, deterministic, and has no dangling edges", () => {
  const demo = createDemoHistory();
  const sessions = demo.sessions.slice(0, 1);
  const sessionEvents = new Map([
    [sessions[0].sessionId, demo.events.filter((event) => event.sessionId === sessions[0].sessionId)],
  ]);
  const first = buildContextGraph({ sessions, sessionEvents, limit: 40 });
  const second = buildContextGraph({ sessions, sessionEvents, limit: 40 });
  const nodeIds = new Set(first.nodes.map((node) => node.id));

  assert.deepEqual(first, second);
  assert.ok(first.nodes.length <= 40);
  assert.ok(first.edges.length <= 160);
  assert.equal(nodeIds.size, first.nodes.length);
  assert.equal(new Set(first.edges.map((edge) => edge.id)).size, first.edges.length);
  assert.equal(
    first.edges.every((edge) => nodeIds.has(edge.source) && nodeIds.has(edge.target)),
    true,
  );
  assert.equal(
    first.edges.every((edge) => edge.weight >= 0 && edge.weight <= 1),
    true,
  );
  assert.equal(first.edges.some((edge) => edge.type === "same_session"), true);
  assert.equal(first.edges.some((edge) => edge.type === "temporal_relation"), true);
  assert.equal(first.edges.some((edge) => edge.type === "semantic_similarity"), false);
  const sessionNode = first.nodes.find((node) => node.type === "session");
  assert.equal(sessionNode.metadata.domain, sessions[0].domain);
  assert.equal(sessionNode.metadata.durationSeconds, sessions[0].durationSeconds);
});

test("context graph uses bounded stable IDs for Unicode entity and topic labels", () => {
  const demo = createDemoHistory();
  const session = demo.sessions[0];
  const unicode = "⚽".repeat(120);
  const event = {
    ...demo.events.find((item) => item.sessionId === session.sessionId),
    entities: [unicode],
    topicLabels: ["纸飞机".repeat(30)],
  };
  const graph = buildContextGraph({
    sessions: [session],
    sessionEvents: new Map([[session.sessionId, [event]]]),
    limit: 20,
  });

  assert.equal(graph.nodes.some((node) => node.label === unicode), true);
  assert.equal(graph.nodes.every((node) => node.id.length <= 240), true);
});
