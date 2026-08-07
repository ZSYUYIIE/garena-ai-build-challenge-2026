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
const concertSessionId = "ffffffff-ffff-4fff-8fff-ffffffffffff";

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

function planarDistance(left: GraphVector, right: GraphVector): number {
  return Math.hypot(left.x - right.x, left.y - right.y);
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
    const session = model.nodes.find((node) => node.id === "session:one")!;
    const early = model.nodes.find((node) => node.id === "event:early")!;
    const late = model.nodes.find((node) => node.id === "event:late")!;
    const earlyAngle = Math.atan2(
      early.position.y - session.position.y,
      early.position.x - session.position.x,
    );
    const lateAngle = Math.atan2(
      late.position.y - session.position.y,
      late.position.x - session.position.x,
    );

    expect(early.timestampSeconds).toBe(10);
    expect(late.timestampSeconds).toBe(90);
    expect(early.chronologyIndex).toBe(0);
    expect(late.chronologyIndex).toBe(1);
    expect(early.chronologyProgress).toBeCloseTo(0.1);
    expect(late.chronologyProgress).toBeCloseTo(0.9);
    expect(earlyAngle).toBeGreaterThan(lateAngle);
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

  it("keeps complete same-domain session systems from occupying the same island space", () => {
    const model = buildGraphSceneModel(
      [
        sessionNode({ id: "session:sports-a", graphSessionId: sessionId }),
        sessionNode({
          id: "session:sports-b",
          graphSessionId: sportsSessionId,
          startedAt: "2026-07-01T10:00:00.000Z",
        }),
        eventNode("event:sports-a", 30, 0.8, sessionId),
        eventNode("event:sports-b", 45, 0.7, sportsSessionId),
        { id: "entity:a", type: "entity", label: "Player A" },
        { id: "entity:b", type: "entity", label: "Player B" },
        { id: "topic:a", type: "topic", label: "Pressure A" },
        { id: "topic:b", type: "topic", label: "Pressure B" },
      ],
      [
        edge("edge:session-a", "session:sports-a", "event:sports-a"),
        edge("edge:session-b", "session:sports-b", "event:sports-b"),
        edge("edge:entity-a", "event:sports-a", "entity:a", "shared_entity"),
        edge("edge:entity-b", "event:sports-b", "entity:b", "shared_entity"),
        edge("edge:topic-a", "event:sports-a", "topic:a", "shared_topic"),
        edge("edge:topic-b", "event:sports-b", "topic:b", "shared_topic"),
      ],
    );
    const first = model.nodes.find((node) => node.id === "session:sports-a")!;
    const second = model.nodes.find((node) => node.id === "session:sports-b")!;
    const extentFor = (session: typeof first) =>
      Math.max(
        ...model.nodes
          .filter((node) => node.clusterSessionId === session.sessionId)
          .map(
            (node) =>
              planarDistance(session.position, node.position) + node.radius,
          ),
      );

    expect(planarDistance(first.position, second.position)).toBeGreaterThan(
      extentFor(first) + extentFor(second),
    );
  });

  it("uses explicit event, entity, and topic shells around a session anchor", () => {
    const model = buildGraphSceneModel(
      [
        sessionNode(),
        eventNode("event:early", 10, 0.5),
        { id: "entity:player-9", type: "entity", label: "Player 9" },
        { id: "topic:pressure", type: "topic", label: "Pressure" },
      ],
      [
        edge("edge:session", "session:one", "event:early"),
        edge("edge:entity", "event:early", "entity:player-9", "shared_entity"),
        edge("edge:topic", "event:early", "topic:pressure", "shared_topic"),
      ],
    );
    const session = model.nodes.find((node) => node.id === "session:one")!;
    const event = model.nodes.find((node) => node.id === "event:early")!;
    const entity = model.nodes.find((node) => node.id === "entity:player-9")!;
    const topic = model.nodes.find((node) => node.id === "topic:pressure")!;

    expect(planarDistance(session.position, event.position)).toBeLessThan(
      planarDistance(session.position, entity.position),
    );
    expect(planarDistance(session.position, entity.position)).toBeLessThan(
      planarDistance(session.position, topic.position),
    );
  });

  it("places a shared topic in the bridge lane and marks it as cross-domain", () => {
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
    const topic = model.nodes.find((node) => node.id === "topic:momentum")!;
    const domainTop = Math.max(
      ...model.domains.map((domain) => domain.position.y + domain.radius),
    );

    expect(topic.domainKeys).toEqual(["sports", "esports"]);
    expect(topic.isCrossDomainBridge).toBe(true);
    expect(topic.connectionCount).toBe(2);
    expect(topic.position.y).toBeGreaterThan(domainTop);
  });

  it("keeps a bridge above unrelated domain islands instead of averaging into one", () => {
    const model = buildGraphSceneModel(
      [
        sessionNode({ id: "session:sports", graphSessionId: sessionId }),
        sessionNode({
          id: "session:esports",
          graphSessionId: esportsSessionId,
          domain: "esports",
        }),
        sessionNode({
          id: "session:concert",
          graphSessionId: concertSessionId,
          domain: "concert",
        }),
        eventNode("event:sports", 20, 0.8, sessionId),
        eventNode("event:concert", 30, 0.8, concertSessionId),
        { id: "topic:energy", type: "topic", label: "Crowd energy" },
      ],
      [
        edge("edge:sports-session", "session:sports", "event:sports"),
        edge("edge:concert-session", "session:concert", "event:concert"),
        edge("edge:sports-topic", "event:sports", "topic:energy", "shared_topic"),
        edge("edge:concert-topic", "event:concert", "topic:energy", "shared_topic"),
      ],
    );
    const topic = model.nodes.find((node) => node.id === "topic:energy")!;
    const esportsDomain = model.domains.find((domain) => domain.key === "esports")!;

    expect(topic.domainKeys).toEqual(["sports", "concerts"]);
    expect(planarDistance(topic.position, esportsDomain.position)).toBeGreaterThan(
      esportsDomain.radius,
    );
    expect(topic.position.y).toBeGreaterThan(
      Math.max(...model.domains.map((domain) => domain.position.y + domain.radius)),
    );
  });

  it("keeps dense event and context rings from intersecting", () => {
    const events = Array.from({ length: 80 }, (_, index) =>
      eventNode(`event:dense:${index}`, index, 1),
    );
    const entities = Array.from({ length: 50 }, (_, index) => ({
      id: `entity:dense:${index}`,
      type: "entity" as const,
      label: `Entity ${index}`,
    }));
    const topics = Array.from({ length: 50 }, (_, index) => ({
      id: `topic:dense:${index}`,
      type: "topic" as const,
      label: `Topic ${index}`,
    }));
    const model = buildGraphSceneModel(
      [sessionNode(), ...events, ...entities, ...topics],
      [
        ...events.map((event, index) =>
          edge(`edge:dense:event:${index}`, "session:one", event.id),
        ),
        ...entities.map((entity, index) =>
          edge(
            `edge:dense:entity:${index}`,
            "event:dense:0",
            entity.id,
            "shared_entity",
          ),
        ),
        ...topics.map((topic, index) =>
          edge(
            `edge:dense:topic:${index}`,
            "event:dense:0",
            topic.id,
            "shared_topic",
          ),
        ),
      ],
    );

    for (const type of ["event", "entity", "topic"] as const) {
      const ring = model.nodes.filter((node) => node.type === type);
      for (let leftIndex = 0; leftIndex < ring.length; leftIndex += 1) {
        for (let rightIndex = leftIndex + 1; rightIndex < ring.length; rightIndex += 1) {
          const left = ring[leftIndex]!;
          const right = ring[rightIndex]!;
          expect(planarDistance(left.position, right.position)).toBeGreaterThanOrEqual(
            left.radius + right.radius + 0.3,
          );
        }
      }
    }
  });

  it("packs context shared by several sessions into non-intersecting domain rings", () => {
    const entities = Array.from({ length: 45 }, (_, index) => ({
      id: `entity:shared:${index}`,
      type: "entity" as const,
      label: `Shared entity ${index}`,
    }));
    const topics = Array.from({ length: 45 }, (_, index) => ({
      id: `topic:shared:${index}`,
      type: "topic" as const,
      label: `Shared topic ${index}`,
    }));
    const model = buildGraphSceneModel(
      [
        sessionNode({ id: "session:sports-a", graphSessionId: sessionId }),
        sessionNode({
          id: "session:sports-b",
          graphSessionId: sportsSessionId,
          startedAt: "2026-07-01T10:00:00.000Z",
        }),
        eventNode("event:shared:a", 20, 0.8, sessionId),
        eventNode("event:shared:b", 30, 0.8, sportsSessionId),
        ...entities,
        ...topics,
      ],
      [
        edge("edge:shared:session-a", "session:sports-a", "event:shared:a"),
        edge("edge:shared:session-b", "session:sports-b", "event:shared:b"),
        ...entities.flatMap((entity, index) => [
          edge(
            `edge:shared:entity-a:${index}`,
            "event:shared:a",
            entity.id,
            "shared_entity",
          ),
          edge(
            `edge:shared:entity-b:${index}`,
            "event:shared:b",
            entity.id,
            "shared_entity",
          ),
        ]),
        ...topics.flatMap((topic, index) => [
          edge(
            `edge:shared:topic-a:${index}`,
            "event:shared:a",
            topic.id,
            "shared_topic",
          ),
          edge(
            `edge:shared:topic-b:${index}`,
            "event:shared:b",
            topic.id,
            "shared_topic",
          ),
        ]),
      ],
    );
    const domain = model.domains.find((item) => item.key === "sports")!;
    const sharedEntities = model.nodes.filter(
      (node) => node.id.startsWith("entity:shared:"),
    );
    const sharedTopics = model.nodes.filter(
      (node) => node.id.startsWith("topic:shared:"),
    );

    for (const ring of [sharedEntities, sharedTopics]) {
      expect(
        ring.every(
          (node) =>
            planarDistance(node.position, domain.position) + node.radius <=
            domain.radius,
        ),
      ).toBe(true);
      for (let leftIndex = 0; leftIndex < ring.length; leftIndex += 1) {
        for (let rightIndex = leftIndex + 1; rightIndex < ring.length; rightIndex += 1) {
          const left = ring[leftIndex]!;
          const right = ring[rightIndex]!;
          expect(planarDistance(left.position, right.position)).toBeGreaterThanOrEqual(
            left.radius + right.radius + 0.3,
          );
        }
      }
    }

    expect(
      planarDistance(sharedTopics[0]!.position, domain.position),
    ).toBeGreaterThan(
      planarDistance(sharedEntities[0]!.position, domain.position),
    );
  });

  it("keeps dense shared context isolated from an adjacent domain island", () => {
    const entities = Array.from({ length: 70 }, (_, index) => ({
      id: `entity:adjacent:${index}`,
      type: "entity" as const,
      label: `Adjacent entity ${index}`,
    }));
    const topics = Array.from({ length: 70 }, (_, index) => ({
      id: `topic:adjacent:${index}`,
      type: "topic" as const,
      label: `Adjacent topic ${index}`,
    }));
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
        eventNode("event:adjacent:a", 20, 0.8, sessionId),
        eventNode("event:adjacent:b", 30, 0.8, sportsSessionId),
        ...entities,
        ...topics,
      ],
      [
        edge("edge:adjacent:session-a", "session:sports-a", "event:adjacent:a"),
        edge("edge:adjacent:session-b", "session:sports-b", "event:adjacent:b"),
        ...entities.flatMap((entity, index) => [
          edge(
            `edge:adjacent:entity-a:${index}`,
            "event:adjacent:a",
            entity.id,
            "shared_entity",
          ),
          edge(
            `edge:adjacent:entity-b:${index}`,
            "event:adjacent:b",
            entity.id,
            "shared_entity",
          ),
        ]),
        ...topics.flatMap((topic, index) => [
          edge(
            `edge:adjacent:topic-a:${index}`,
            "event:adjacent:a",
            topic.id,
            "shared_topic",
          ),
          edge(
            `edge:adjacent:topic-b:${index}`,
            "event:adjacent:b",
            topic.id,
            "shared_topic",
          ),
        ]),
      ],
    );
    const sportsDomain = model.domains.find((domain) => domain.key === "sports")!;
    const esportsDomain = model.domains.find((domain) => domain.key === "esports")!;
    const sharedContext = model.nodes.filter(
      (node) =>
        node.id.startsWith("entity:adjacent:") ||
        node.id.startsWith("topic:adjacent:"),
    );

    expect(
      sharedContext.every(
        (node) =>
          planarDistance(node.position, sportsDomain.position) + node.radius <=
          sportsDomain.radius + Number.EPSILON,
      ),
    ).toBe(true);
    expect(
      Math.min(
        ...sharedContext.map(
          (node) =>
            planarDistance(node.position, esportsDomain.position) -
            node.radius -
            esportsDomain.radius,
        ),
      ),
    ).toBeGreaterThanOrEqual(0);
  });

  it("labels every session, at most one important event per session, and no context by default", () => {
    const events = Array.from({ length: 7 }, (_, index) =>
      eventNode(`event:${index}`, index * 10, index / 10),
    );
    const model = buildGraphSceneModel(
      [
        sessionNode(),
        sessionNode({
          id: "session:two",
          graphSessionId: sportsSessionId,
          startedAt: "2026-07-01T10:00:00.000Z",
        }),
        ...events,
        eventNode("event:other-low", 20, 0.2, sportsSessionId),
        eventNode("event:other-high", 80, 0.95, sportsSessionId),
        { id: "entity:player-9", type: "entity", label: "Player 9" },
        { id: "topic:pressure", type: "topic", label: "Pressure" },
      ],
      [
        edge("edge:entity", "event:0", "entity:player-9", "shared_entity"),
        edge("edge:topic", "event:0", "topic:pressure", "shared_topic"),
      ],
    );
    const visibleByDefault = model.nodes.filter(
      (node) => node.labelVisibleByDefault,
    );
    const labeledEvents = visibleByDefault.filter(
      (node) => node.type === "event",
    );

    expect(
      model.nodes
        .filter((node) => node.type === "session")
        .every((node) => node.labelVisibleByDefault),
    ).toBe(true);
    expect(labeledEvents.map((node) => node.id)).toEqual([
      "event:6",
      "event:other-high",
    ]);
    expect(new Set(labeledEvents.map((node) => node.clusterSessionId))).toEqual(
      new Set([sessionId, sportsSessionId]),
    );
    expect(
      visibleByDefault.some(
        (node) => node.type === "entity" || node.type === "topic",
      ),
    ).toBe(false);
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
