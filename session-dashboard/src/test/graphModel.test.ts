import { describe, expect, it } from "vitest";

import type { GraphEdge, GraphNode } from "../api/contracts";
import { buildGraphSceneModel } from "../features/context/graphModel";
import { sessionId } from "./fixtures";

const secondEventId = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";

function sessionNode(): GraphNode {
  return {
    id: "session:one",
    type: "session",
    label: "Team A vs Team B",
    sessionId,
  };
}

function eventNode(
  id: string,
  timestampSeconds: number,
  importance: number,
): GraphNode {
  return {
    id,
    type: "event",
    label: `Event at ${timestampSeconds}`,
    sessionId,
    eventId: id === "event:early"
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

describe("deterministic context graph layout", () => {
  it("produces identical positions regardless of input order", () => {
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
  });

  it("orders session events by timestamp and scales event size by importance", () => {
    const model = buildGraphSceneModel(
      [
        sessionNode(),
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
    expect(early.position.z).toBeLessThan(late.position.z);
    expect(early.radius).toBeLessThan(late.radius);
    expect(early.shape).toBe("box");
  });

  it("uses distinct shape cues for every node type", () => {
    const model = buildGraphSceneModel(
      [
        sessionNode(),
        eventNode("event:early", 10, 0.5),
        { id: "entity:player-9", type: "entity", label: "Player 9" },
        { id: "topic:pressure", type: "topic", label: "Pressure" },
      ],
      [],
    );

    expect(Object.fromEntries(model.nodes.map((node) => [node.type, node.shape]))).toEqual({
      session: "sphere",
      event: "box",
      entity: "octahedron",
      topic: "torus",
    });
    expect(
      model.nodes
        .filter((node) => node.type === "entity" || node.type === "topic")
        .map((node) => node.clusterSessionId),
    ).toEqual([null, null]);
  });

  it("keeps default canvas labels bounded and prioritizes important events", () => {
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
      [],
    );
    const visibleByDefault = model.nodes
      .filter((node) => node.labelVisibleByDefault)
      .map((node) => node.id);

    expect(visibleByDefault).toEqual([
      "session:one",
      "event:3",
      "event:4",
      "event:5",
      "event:6",
    ]);
    expect(visibleByDefault).not.toContain("entity:player-9");
    expect(visibleByDefault).not.toContain("topic:pressure");
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
