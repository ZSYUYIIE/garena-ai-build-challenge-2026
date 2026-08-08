import { describe, expect, it } from "vitest";

import type { GraphEdge, GraphNode } from "../api/contracts";
import {
  buildGraphSceneModel,
} from "../features/context/graphModel";

const sessionIds = {
  sports: "11111111-1111-4111-8111-111111111111",
  sportsTwo: "22222222-2222-4222-8222-222222222222",
  esports: "33333333-3333-4333-8333-333333333333",
  concert: "44444444-4444-4444-8444-444444444444",
  launch: "55555555-5555-4555-8555-555555555555",
  creator: "66666666-6666-4666-8666-666666666666",
};

function sessionNode({
  id = "session:sports",
  sessionId = sessionIds.sports,
  domain = "football",
  durationSeconds = 100,
  startedAt = "2026-08-01T10:00:00.000Z",
}: {
  id?: string;
  sessionId?: string;
  domain?: string;
  durationSeconds?: number;
  startedAt?: string;
} = {}): GraphNode {
  return {
    id,
    type: "session",
    label: `${domain} session`,
    sessionId,
    metadata: { domain, durationSeconds, startedAt },
  };
}

function eventNode({
  id,
  sessionId = sessionIds.sports,
  timestampSeconds,
  importance,
}: {
  id: string;
  sessionId?: string;
  timestampSeconds: number;
  importance?: number;
}): GraphNode {
  return {
    id,
    type: "event",
    label: id,
    sessionId,
    importance,
    metadata: { timestampSeconds },
  };
}

function edge(
  id: string,
  source: string,
  target: string,
  type: GraphEdge["type"] = "same_session",
  weight = 1,
): GraphEdge {
  return { id, source, target, type, weight };
}

describe("semantic graph model", () => {
  it("maps event progress and importance to exact semantic axes", () => {
    const events = [
      eventNode({ id: "event:0", timestampSeconds: 0, importance: 0 }),
      eventNode({ id: "event:25", timestampSeconds: 25, importance: 0.25 }),
      eventNode({ id: "event:50", timestampSeconds: 50, importance: 0.5 }),
      eventNode({ id: "event:100", timestampSeconds: 100, importance: 1 }),
    ];
    const model = buildGraphSceneModel(
      [sessionNode(), ...events],
      events.map((event) => edge(`edge:${event.id}`, "session:sports", event.id)),
    );
    const positioned = events.map(
      (event) => model.nodes.find((node) => node.id === event.id)!,
    );

    expect(positioned.map((node) => node.progress)).toEqual([0, 0.25, 0.5, 1]);
    expect(positioned.map((node) => node.importanceScore)).toEqual([0, 0.25, 0.5, 1]);
    expect(positioned.map((node) => node.position.x)).toEqual([0, 7, 14, 28]);
    expect(positioned.map((node) => node.position.y)).toEqual([-7, -3.5, 0, 7]);
    expect(new Set(positioned.map((node) => node.position.z)).size).toBe(1);
    expect(positioned.every((node) => node.positionMeaning === "measured-event")).toBe(true);
  });

  it("normalizes active sessions against the latest recorded moment", () => {
    const events = [
      eventNode({ id: "event:early", timestampSeconds: 10, importance: 0.4 }),
      eventNode({ id: "event:latest", timestampSeconds: 50, importance: 0.8 }),
    ];
    const model = buildGraphSceneModel(
      [sessionNode({ durationSeconds: 0 }), ...events],
      events.map((event) => edge(`edge:${event.id}`, "session:sports", event.id)),
    );

    expect(model.nodes.find((node) => node.id === "event:early")?.progress).toBe(0.2);
    expect(model.nodes.find((node) => node.id === "event:latest")?.progress).toBe(1);
  });

  it("uses a labeled unscored band instead of inventing importance", () => {
    const event = eventNode({ id: "event:unscored", timestampSeconds: 50 });
    const model = buildGraphSceneModel(
      [sessionNode(), event],
      [edge("edge:unscored", "session:sports", event.id)],
    );
    const positioned = model.nodes.find((node) => node.id === event.id)!;
    const unscoredTick = model.axes.importance.ticks.find(
      (tick) => tick.value === "unscored",
    )!;

    expect(positioned.importanceScore).toBeNull();
    expect(positioned.position.y).toBe(unscoredTick.position);
    expect(unscoredTick.label).toBe("Not scored");
  });

  it("orders five entertainment lanes canonically and enables real 3D", () => {
    const model = buildGraphSceneModel(
      [
        sessionNode(),
        sessionNode({ id: "session:esports", sessionId: sessionIds.esports, domain: "esports" }),
        sessionNode({ id: "session:concert", sessionId: sessionIds.concert, domain: "concert" }),
        sessionNode({ id: "session:launch", sessionId: sessionIds.launch, domain: "product launch" }),
        sessionNode({ id: "session:creator", sessionId: sessionIds.creator, domain: "creator livestream" }),
      ],
      [],
    );

    expect(model.projectionMode).toBe("three-dimensional");
    expect(model.domains.map((domain) => domain.label)).toEqual([
      "Sports",
      "Esports and games",
      "Concerts",
      "Product launches",
      "Creator livestreams",
    ]);
    expect(model.axes.entertainment.ticks.map((tick) => tick.label)).toEqual(
      model.domains.map((domain) => domain.label),
    );
    expect(isStrictlyIncreasing(model.domains.map((domain) => domain.lanePosition))).toBe(true);
  });

  it("switches a one-domain model to the honest 2D projection", () => {
    const model = buildGraphSceneModel([sessionNode()], []);
    expect(model.projectionMode).toBe("two-dimensional");
    expect(model.axes.entertainment.ticks).toHaveLength(1);
  });

  it("reserves five honest lanes for the unfiltered overview without fabricating records", () => {
    const suppliedSession = sessionNode();
    const model = buildGraphSceneModel([suppliedSession], [], {
      scope: "all-domains-overview",
    });

    expect(model.scope).toBe("all-domains-overview");
    expect(model.projectionMode).toBe("three-dimensional");
    expect(model.reservedDomainCount).toBe(5);
    expect(model.domains.map((domain) => domain.label)).toEqual([
      "Sports",
      "Esports and games",
      "Concerts",
      "Product launches",
      "Creator livestreams",
    ]);
    expect(model.domains.filter((domain) => !domain.isEmpty)).toHaveLength(1);
    expect(model.nodes.map((node) => node.id)).toEqual([suppliedSession.id]);
    expect(model.edges).toEqual([]);
  });

  it("keeps unclassified history in a sixth truthful overview lane", () => {
    const unclassifiedSession = sessionNode({ domain: "unknown" });
    const model = buildGraphSceneModel([unclassifiedSession], [], {
      scope: "all-domains-overview",
    });

    expect(model.domains).toHaveLength(6);
    expect(model.domains.at(-1)).toMatchObject({
      key: "unclassified",
      label: "Other entertainment",
      isEmpty: false,
      sessionCount: 1,
    });
    expect(model.domains.slice(0, 5).every((domain) => domain.isEmpty)).toBe(true);
    expect(model.nodes).toHaveLength(1);
    expect(model.edges).toHaveLength(0);
  });

  it("uses deterministic session sub-lanes within one entertainment band", () => {
    const first = sessionNode();
    const second = sessionNode({
      id: "session:sports-two",
      sessionId: sessionIds.sportsTwo,
      startedAt: "2026-08-02T10:00:00.000Z",
    });
    const firstEvent = eventNode({ id: "event:first", timestampSeconds: 50, importance: 0.5 });
    const secondEvent = eventNode({
      id: "event:second",
      sessionId: sessionIds.sportsTwo,
      timestampSeconds: 50,
      importance: 0.5,
    });
    const model = buildGraphSceneModel(
      [first, second, firstEvent, secondEvent],
      [
        edge("edge:first", first.id, firstEvent.id),
        edge("edge:second", second.id, secondEvent.id),
      ],
    );
    const positionedFirst = model.nodes.find((node) => node.id === firstEvent.id)!;
    const positionedSecond = model.nodes.find((node) => node.id === secondEvent.id)!;
    const domainLane = model.domains[0]!.lanePosition;

    expect(positionedFirst.position.x).toBe(positionedSecond.position.x);
    expect(positionedFirst.position.y).toBe(positionedSecond.position.y);
    expect(positionedFirst.position.z).not.toBe(positionedSecond.position.z);
    expect(Math.abs(positionedFirst.position.z - domainLane)).toBeLessThanOrEqual(2.2);
    expect(Math.abs(positionedSecond.position.z - domainLane)).toBeLessThanOrEqual(2.2);
  });

  it("enforces root-to-leaf sphere-size hierarchy", () => {
    const event = eventNode({ id: "event:key", timestampSeconds: 50, importance: 1 });
    const model = buildGraphSceneModel(
      [
        sessionNode(),
        event,
        { id: "entity:player", type: "entity", label: "Player" },
        { id: "topic:turning-point", type: "topic", label: "Turning point" },
      ],
      [
        edge("edge:event", "session:sports", event.id),
        edge("edge:entity", event.id, "entity:player", "shared_entity"),
        edge("edge:topic", event.id, "topic:turning-point", "shared_topic"),
      ],
    );
    const session = model.nodes.find((node) => node.type === "session")!;
    const positionedEvent = model.nodes.find((node) => node.type === "event")!;
    const entity = model.nodes.find((node) => node.type === "entity")!;
    const topic = model.nodes.find((node) => node.type === "topic")!;

    expect(model.memoryRoot.radius).toBeGreaterThan(model.domains[0]!.radius);
    expect(model.domains[0]!.radius).toBeGreaterThan(session.radius);
    expect(session.radius).toBeGreaterThan(positionedEvent.radius);
    expect(positionedEvent.radius).toBeGreaterThan(entity.radius);
    expect(entity.radius).toBeGreaterThan(topic.radius);
  });

  it("places same-domain context near the weighted event centroid", () => {
    const early = eventNode({ id: "event:early", timestampSeconds: 25, importance: 0.25 });
    const late = eventNode({ id: "event:late", timestampSeconds: 75, importance: 0.75 });
    const topic: GraphNode = { id: "topic:shared", type: "topic", label: "Shared" };
    const model = buildGraphSceneModel(
      [sessionNode(), early, late, topic],
      [
        edge("edge:early", "session:sports", early.id),
        edge("edge:late", "session:sports", late.id),
        edge("edge:topic-early", early.id, topic.id, "shared_topic"),
        edge("edge:topic-late", late.id, topic.id, "shared_topic"),
      ],
    );
    const positioned = model.nodes.find((node) => node.id === topic.id)!;

    expect(positioned.progress).toBeCloseTo(0.5);
    expect(positioned.importanceScore).toBeCloseTo(0.5);
    expect(positioned.positionMeaning).toBe("derived-context");
    expect(Math.abs(positioned.position.x - 14)).toBeLessThan(0.6);
    expect(Math.abs(positioned.position.y)).toBeLessThan(1.4);
  });

  it("places cross-domain context between the connected entertainment lanes", () => {
    const sportsEvent = eventNode({ id: "event:sports", timestampSeconds: 50, importance: 0.8 });
    const esportsEvent = eventNode({
      id: "event:esports",
      sessionId: sessionIds.esports,
      timestampSeconds: 50,
      importance: 0.8,
    });
    const topic: GraphNode = { id: "topic:turning-point", type: "topic", label: "Turning point" };
    const model = buildGraphSceneModel(
      [
        sessionNode(),
        sessionNode({ id: "session:esports", sessionId: sessionIds.esports, domain: "esports" }),
        sportsEvent,
        esportsEvent,
        topic,
      ],
      [
        edge("edge:sports-session", "session:sports", sportsEvent.id),
        edge("edge:esports-session", "session:esports", esportsEvent.id),
        edge("edge:sports-topic", sportsEvent.id, topic.id, "shared_topic"),
        edge("edge:esports-topic", esportsEvent.id, topic.id, "shared_topic"),
      ],
    );
    const positioned = model.nodes.find((node) => node.id === topic.id)!;
    const lanePositions = model.domains.map((domain) => domain.lanePosition);

    expect(positioned.domainKeys).toEqual(["sports", "esports"]);
    expect(positioned.isCrossDomainBridge).toBe(true);
    expect(positioned.position.z).toBeGreaterThan(Math.min(...lanePositions));
    expect(positioned.position.z).toBeLessThan(Math.max(...lanePositions));
  });

  it("keeps structural nodes before the measured event region", () => {
    const event = eventNode({ id: "event:start", timestampSeconds: 0, importance: 0.5 });
    const model = buildGraphSceneModel(
      [sessionNode(), event],
      [edge("edge:start", "session:sports", event.id)],
    );
    const session = model.nodes.find((node) => node.type === "session")!;
    const positionedEvent = model.nodes.find((node) => node.type === "event")!;

    expect(model.memoryRoot.position.x).toBeLessThan(model.domains[0]!.position.x);
    expect(model.domains[0]!.position.x).toBeLessThan(session.position.x);
    expect(session.position.x).toBeLessThan(positionedEvent.position.x);
    expect(session.positionMeaning).toBe("structural");
  });

  it("keeps node labels focus-disclosed so semantic rulers stay readable", () => {
    const low = eventNode({ id: "event:low", timestampSeconds: 25, importance: 0.2 });
    const high = eventNode({ id: "event:high", timestampSeconds: 75, importance: 0.9 });
    const model = buildGraphSceneModel(
      [sessionNode(), low, high, { id: "topic:none", type: "topic", label: "None" }],
      [
        edge("edge:low", "session:sports", low.id),
        edge("edge:high", "session:sports", high.id),
      ],
    );
    const labeled = model.nodes.filter((node) => node.labelVisibleByDefault);

    expect(labeled).toEqual([]);
  });

  it("drops dangling edges and never fabricates semantic relationships", () => {
    const event = eventNode({ id: "event:valid", timestampSeconds: 50, importance: 0.8 });
    const withoutSemantic = buildGraphSceneModel(
      [sessionNode(), event],
      [
        edge("edge:valid", "session:sports", event.id),
        edge("edge:dangling", event.id, "topic:missing", "shared_topic"),
      ],
    );

    expect(withoutSemantic.droppedDanglingEdgeIds).toEqual(["edge:dangling"]);
    expect(withoutSemantic.edges.some((item) => item.semanticBridge)).toBe(false);
  });

  it("is deterministic for identical bounded input", () => {
    const event = eventNode({ id: "event:stable", timestampSeconds: 50, importance: 0.8 });
    const nodes = [sessionNode(), event, { id: "entity:stable", type: "entity", label: "Stable" } satisfies GraphNode];
    const edges = [
      edge("edge:event", "session:sports", event.id),
      edge("edge:entity", event.id, "entity:stable", "shared_entity"),
    ];

    expect(buildGraphSceneModel(nodes, edges)).toEqual(buildGraphSceneModel(nodes, edges));
  });
});

function isStrictlyIncreasing(values: number[]): boolean {
  return values.every((value, index) => index === 0 || value > values[index - 1]!);
}
