import { describe, expect, it } from "vitest";

import type { GraphEdge, GraphNode } from "../api/contracts";
import {
  buildGraphSceneModel,
  type GraphVector,
} from "../features/context/graphModel";
import { sessionId } from "./fixtures";

const secondEventId = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const sportsSessionId = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
const esportsSessionId = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee";

function sessionNode({
  id = "session:one",
  graphSessionId = sessionId,
  domain = "football",
  startedAt = "2026-08-01T10:00:00.000Z",
  durationSeconds = 100,
}: {
  id?: string;
  graphSessionId?: string;
  domain?: string;
  startedAt?: string;
  durationSeconds?: number;
} = {}): GraphNode {
  return {
    id,
    type: "session",
    label: `${domain} session`,
    sessionId: graphSessionId,
    metadata: { domain, startedAt, durationSeconds },
  };
}

function eventNode(
  id: string,
  timestampSeconds: number,
  importance: number,
  graphSessionId = sessionId,
): GraphNode {
  return {
    id,
    type: "event",
    label: `Event at ${timestampSeconds}`,
    sessionId: graphSessionId,
    eventId:
      id === "event:early"
        ? "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"
        : secondEventId,
    importance,
    metadata: { timestampSeconds },
  };
}

function edge(
  id: string,
  source: string,
  target: string,
  type: GraphEdge["type"] = "same_session",
): GraphEdge {
  return { id, source, target, type, weight: 0.8 };
}

function distance(left: GraphVector, right: GraphVector): number {
  return Math.hypot(
    left.x - right.x,
    left.y - right.y,
    left.z - right.z,
  );
}

describe("deterministic context graph layout", () => {
  it("produces identical domain constellations regardless of input order", () => {
    const nodes = [
      sessionNode(),
      eventNode("event:early", 10, 0.4),
      eventNode("event:late", 90, 0.9),
      { id: "topic:pressure", type: "topic", label: "Pressure" } satisfies GraphNode,
    ];
    const edges = [
      edge("edge:session-early", "session:one", "event:early"),
      edge("edge:session-late", "session:one", "event:late"),
      edge("edge:topic", "event:early", "topic:pressure", "shared_topic"),
    ];

    const first = buildGraphSceneModel(nodes, edges);
    const second = buildGraphSceneModel([...nodes].reverse(), [...edges].reverse());

    expect(second.nodes).toEqual(first.nodes);
    expect(second.edges).toEqual(first.edges);
    expect(second.domains).toEqual(first.domains);
  });

  it("orders session events by timestamp, uses duration progress, and sizes events by importance", () => {
    const model = buildGraphSceneModel(
      [
        sessionNode({ durationSeconds: 100 }),
        eventNode("event:late", 90, 0.95),
        eventNode("event:early", 10, 0.2),
      ],
      [
        edge("edge:session-late", "session:one", "event:late"),
        edge("edge:session-early", "session:one", "event:early"),
      ],
    );
    const early = model.nodes.find((node) => node.id === "event:early")!;
    const late = model.nodes.find((node) => node.id === "event:late")!;

    expect(early.timestampSeconds).toBe(10);
    expect(late.timestampSeconds).toBe(90);
    expect(early.chronologyIndex).toBe(0);
    expect(late.chronologyIndex).toBe(1);
    expect(early.chronologyProgress).toBeCloseTo(0.1);
    expect(late.chronologyProgress).toBeCloseTo(0.9);
    expect(early.radius).toBeLessThan(late.radius);
    expect(early.position).not.toEqual(late.position);
  });

  it("uses spheres for every role and non-color size or surface cues", () => {
    const model = buildGraphSceneModel(
      [
        sessionNode(),
        eventNode("event:early", 10, 0.5),
        { id: "entity:player-9", type: "entity", label: "Player 9" },
        { id: "topic:pressure", type: "topic", label: "Pressure" },
      ],
      [
        edge("edge:entity", "event:early", "entity:player-9", "shared_entity"),
        edge("edge:topic", "event:early", "topic:pressure", "shared_topic"),
      ],
    );

    expect(new Set(model.nodes.map((node) => node.shape))).toEqual(
      new Set(["sphere"]),
    );
    expect(
      Object.fromEntries(model.nodes.map((node) => [node.type, node.surface])),
    ).toEqual({
      session: "anchor",
      event: "event",
      entity: "entity",
      topic: "topic",
    });
    expect(model.nodes.find((node) => node.type === "session")!.radius).toBeGreaterThan(
      model.nodes.find((node) => node.type === "event")!.radius,
    );
    expect(model.nodes.every((node) => node.sizeMeaning.length > 0)).toBe(true);
  });

  it("keeps same-domain sessions closer than sessions in different domain constellations", () => {
    const model = buildGraphSceneModel(
      [
        sessionNode({ id: "session:sports-a", graphSessionId: sessionId }),
        sessionNode({
          id: "session:sports-b",
          graphSessionId: sportsSessionId,
          startedAt: "2026-07-01T10:00:00.000Z",
        }),
        sessionNode({
          id: "session:esports",
          graphSessionId: esportsSessionId,
          domain: "esports",
        }),
      ],
      [],
    );
    const sportsA = model.nodes.find((node) => node.id === "session:sports-a")!;
    const sportsB = model.nodes.find((node) => node.id === "session:sports-b")!;
    const esports = model.nodes.find((node) => node.id === "session:esports")!;

    expect(distance(sportsA.position, sportsB.position)).toBeLessThan(
      distance(sportsA.position, esports.position),
    );
    expect(model.domains.map((domain) => domain.label)).toEqual([
      "Sports",
      "Esports and games",
    ]);
  });

  it("places a shared topic between connected events and marks it as cross-domain", () => {
    const nodes = [
      sessionNode({ id: "session:sports", graphSessionId: sessionId }),
      sessionNode({
        id: "session:esports",
        graphSessionId: esportsSessionId,
        domain: "esports",
      }),
      eventNode("event:sports", 20, 0.8, sessionId),
      eventNode("event:esports", 30, 0.8, esportsSessionId),
      { id: "topic:momentum", type: "topic", label: "Momentum shift" } satisfies GraphNode,
    ];
    const edges = [
      edge("edge:sports-session", "session:sports", "event:sports"),
      edge("edge:esports-session", "session:esports", "event:esports"),
      edge("edge:sports-topic", "event:sports", "topic:momentum", "shared_topic"),
      edge("edge:esports-topic", "event:esports", "topic:momentum", "shared_topic"),
    ];
    const model = buildGraphSceneModel(nodes, edges);
    const sports = model.nodes.find((node) => node.id === "event:sports")!;
    const esports = model.nodes.find((node) => node.id === "event:esports")!;
    const topic = model.nodes.find((node) => node.id === "topic:momentum")!;
    const midpoint = {
      x: (sports.position.x + esports.position.x) / 2,
      y: (sports.position.y + esports.position.y) / 2,
      z: (sports.position.z + esports.position.z) / 2,
    };

    expect(topic.domainKeys).toEqual(["sports", "esports"]);
    expect(topic.isCrossDomainBridge).toBe(true);
    expect(topic.connectionCount).toBe(2);
    expect(distance(topic.position, midpoint)).toBeLessThan(1.6);
  });

  it("keeps default labels bounded while surfacing important events and connected context", () => {
    const events = Array.from({ length: 7 }, (_, index) =>
      eventNode(`event:${index}`, index * 10, index / 10),
    );
    const model = buildGraphSceneModel(
      [
        sessionNode(),
        ...events,
        { id: "entity:player-9", type: "entity", label: "Player 9" },
        { id: "topic:pressure", type: "topic", label: "Pressure" },
      ],
      [
        edge("edge:entity", "event:0", "entity:player-9", "shared_entity"),
        edge("edge:topic", "event:0", "topic:pressure", "shared_topic"),
      ],
    );
    const visibleByDefault = model.nodes
      .filter((node) => node.labelVisibleByDefault)
      .map((node) => node.id);

    expect(visibleByDefault).toEqual([
      "session:one",
      "event:4",
      "event:5",
      "event:6",
      "entity:player-9",
    ]);
  });

  it("drops dangling relationships and never fabricates semantic bridges", () => {
    const nodes = [
      sessionNode(),
      eventNode("event:early", 10, 0.5),
      { id: "topic:pressure", type: "topic", label: "Pressure" } satisfies GraphNode,
    ];
    const withoutSemantic = buildGraphSceneModel(nodes, [
      edge("edge:valid", "session:one", "event:early"),
      edge("edge:dangling", "event:early", "topic:missing", "shared_topic"),
    ]);

    expect(withoutSemantic.edges.map((item) => item.id)).toEqual(["edge:valid"]);
    expect(withoutSemantic.droppedDanglingEdgeIds).toEqual(["edge:dangling"]);
    expect(withoutSemantic.edges.some((item) => item.semanticBridge)).toBe(false);

    const suppliedSemantic = buildGraphSceneModel(nodes, [
      edge(
        "edge:semantic",
        "event:early",
        "topic:pressure",
        "semantic_similarity",
      ),
    ]);
    expect(suppliedSemantic.edges).toHaveLength(1);
    expect(suppliedSemantic.edges[0]).toMatchObject({
      id: "edge:semantic",
      semanticBridge: true,
      type: "semantic_similarity",
    });
  });
});
