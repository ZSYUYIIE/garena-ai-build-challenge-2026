import { createHash } from "node:crypto";

import { graphEdgeSchema, graphNodeSchema } from "./historySchemas.js";

const MAX_GRAPH_NODES = 200;
const MAX_GRAPH_EDGES = 600;

export function buildContextGraph({ sessions, sessionEvents, limit = 80 }) {
  const nodeLimit = Math.max(1, Math.min(Number(limit) || 80, MAX_GRAPH_NODES));
  const edgeLimit = Math.min(MAX_GRAPH_EDGES, nodeLimit * 4);
  const nodes = new Map();
  const edges = new Map();

  const addNode = (node) => {
    if (nodes.has(node.id)) return true;
    if (nodes.size >= nodeLimit) return false;
    nodes.set(node.id, graphNodeSchema.parse(node));
    return true;
  };
  const addEdge = (edge) => {
    if (edges.has(edge.id) || edges.size >= edgeLimit) return;
    if (!nodes.has(edge.source) || !nodes.has(edge.target)) return;
    edges.set(edge.id, graphEdgeSchema.parse(edge));
  };

  for (const session of sessions) {
    const sessionNodeId = `session:${session.sessionId}`;
    if (!addNode({
      id: sessionNodeId,
      type: "session",
      label: session.title,
      sessionId: session.sessionId,
      metadata: {
        domain: session.domain,
        startedAt: session.startedAt,
        durationSeconds: session.durationSeconds,
      },
    })) break;

    let previousEvent = null;
    for (const event of sessionEvents.get(session.sessionId) ?? []) {
      const eventNodeId = `event:${event.id}`;
      if (!addNode({
        id: eventNodeId,
        type: "event",
        label: event.description.slice(0, 240),
        sessionId: session.sessionId,
        eventId: event.id,
        importance: event.importance,
        metadata: {
          timestamp: event.timestamp,
          timestampSeconds: event.timestampSeconds,
          eventType: event.eventType,
        },
      })) break;
      addEdge({
        id: `same_session:${session.sessionId}:${event.id}`,
        source: sessionNodeId,
        target: eventNodeId,
        type: "same_session",
        weight: 1,
      });

      for (const entity of event.entities) {
        const entityNodeId = `entity:${identifier(entity)}`;
        if (addNode({ id: entityNodeId, type: "entity", label: entity })) {
          addEdge({
            id: `shared_entity:${event.id}:${identifier(entity)}`,
            source: eventNodeId,
            target: entityNodeId,
            type: "shared_entity",
            weight: 1,
          });
        }
      }
      for (const topic of event.topicLabels) {
        const topicNodeId = `topic:${identifier(topic)}`;
        if (addNode({ id: topicNodeId, type: "topic", label: topic })) {
          addEdge({
            id: `shared_topic:${event.id}:${identifier(topic)}`,
            source: eventNodeId,
            target: topicNodeId,
            type: "shared_topic",
            weight: 1,
          });
        }
      }
      if (previousEvent) {
        const elapsedSeconds = Math.max(
          0,
          event.timestampSeconds - previousEvent.timestampSeconds,
        );
        addEdge({
          id: `temporal:${previousEvent.id}:${event.id}`,
          source: `event:${previousEvent.id}`,
          target: eventNodeId,
          type: "temporal_relation",
          weight: roundWeight(1 / (1 + elapsedSeconds / 60)),
        });
      }
      previousEvent = event;
    }
  }

  return { nodes: [...nodes.values()], edges: [...edges.values()] };
}

function identifier(value) {
  return createHash("sha256")
    .update(value.trim().toLocaleLowerCase("en-US"), "utf8")
    .digest("hex")
    .slice(0, 32);
}

function roundWeight(value) {
  return Math.round(value * 1_000) / 1_000;
}
