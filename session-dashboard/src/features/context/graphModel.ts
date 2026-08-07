import type { GraphEdge, GraphNode } from "../../api/contracts";

export type GraphNodeShape = "sphere";
export type GraphNodeSurface = "anchor" | "event" | "entity" | "topic";

export type GraphVector = {
  x: number;
  y: number;
  z: number;
};

export type GraphDomainCluster = {
  key: string;
  label: string;
  color: number;
  position: GraphVector;
  radius: number;
  sessionCount: number;
  eventCount: number;
  nodeCount: number;
};

export type PositionedGraphNode = GraphNode & {
  position: GraphVector;
  radius: number;
  shape: GraphNodeShape;
  surface: GraphNodeSurface;
  color: number;
  labelVisibleByDefault: boolean;
  clusterSessionId: string | null;
  timestampSeconds: number | null;
  chronologyIndex: number | null;
  chronologyProgress: number | null;
  connectionCount: number;
  domainKeys: string[];
  domainLabel: string;
  isCrossDomainBridge: boolean;
  sizeMeaning: string;
};

export type PositionedGraphEdge = GraphEdge & {
  semanticBridge: boolean;
};

export type GraphSceneModel = {
  nodes: PositionedGraphNode[];
  edges: PositionedGraphEdge[];
  domains: GraphDomainCluster[];
  droppedDanglingEdgeIds: string[];
};

type DomainStyle = {
  key: string;
  label: string;
  color: number;
};

type SessionLayoutMetrics = {
  eventRingRadius: number;
  entityShellRadius: number;
  topicShellRadius: number;
  footprintRadius: number;
};

type SharedContextRingMetrics = {
  entityRingRadius: number;
  topicRingRadius: number;
  footprintRadius: number;
};

type DomainLayout = {
  centerByKey: Map<string, GraphVector>;
  radiusByKey: Map<string, number>;
  sharedContextRingMetricsByKey: Map<string, SharedContextRingMetrics>;
};

const DOMAIN_STYLES: DomainStyle[] = [
  { key: "sports", label: "Sports", color: 0x2dd4bf },
  { key: "esports", label: "Esports and games", color: 0xa78bfa },
  { key: "concerts", label: "Concerts", color: 0xf472b6 },
  { key: "product-launches", label: "Product launches", color: 0xfbbf24 },
  { key: "creator-streams", label: "Creator livestreams", color: 0x60a5fa },
  { key: "unclassified", label: "Other entertainment", color: 0xcbd5e1 },
];

const DOMAIN_STYLE_BY_KEY = new Map(
  DOMAIN_STYLES.map((style) => [style.key, style]),
);
const CROSS_DOMAIN_STYLE: DomainStyle = {
  key: "cross-domain",
  label: "Cross-domain bridge",
  color: 0xf8fafc,
};

const TYPE_ORDER: Record<GraphNode["type"], number> = {
  session: 0,
  event: 1,
  entity: 2,
  topic: 3,
};

const SESSION_SYSTEM_GAP = 3.2;
const DOMAIN_ISLAND_GAP = 7.5;
const EVENT_ARC_START = Math.PI * 0.82;
const EVENT_ARC_SWEEP = Math.PI * 1.64;
const NODE_GAP = 0.32;
const SHELL_GAP = 0.65;
const EVENT_MAX_RADIUS = 0.94;
const ENTITY_MAX_RADIUS = 0.7;
const TOPIC_MAX_RADIUS = 0.58;
const CROSS_DOMAIN_LANE_GAP = 3.2;

export function buildGraphSceneModel(
  inputNodes: GraphNode[],
  inputEdges: GraphEdge[],
): GraphSceneModel {
  const nodes = uniqueNodes(inputNodes).sort(compareNodes);
  const nodeById = new Map(nodes.map((node) => [node.id, node]));
  const droppedDanglingEdgeIds: string[] = [];
  const edges = uniqueEdges(inputEdges)
    .filter((edge) => {
      const valid = nodeById.has(edge.source) && nodeById.has(edge.target);
      if (!valid) droppedDanglingEdgeIds.push(edge.id);
      return valid;
    })
    .sort((left, right) => left.id.localeCompare(right.id));
  const connectedNodeIdsByNodeId = createAdjacency(nodes, edges);

  const sessionNodes = nodes.filter((node) => node.type === "session");
  const sessionNodeBySessionId = new Map(
    sessionNodes.flatMap((node) =>
      node.sessionId ? ([[node.sessionId, node]] as const) : [],
    ),
  );
  const domainStyleBySessionNodeId = new Map(
    sessionNodes.map((node) => [node.id, domainStyleForNode(node)]),
  );
  const sessionNodeIdByNodeId = new Map<string, string>();
  for (const sessionNode of sessionNodes) {
    sessionNodeIdByNodeId.set(sessionNode.id, sessionNode.id);
  }

  const eventNodes = nodes.filter((node) => node.type === "event");
  for (const eventNode of eventNodes) {
    const directSession = eventNode.sessionId
      ? sessionNodeBySessionId.get(eventNode.sessionId)
      : undefined;
    const linkedSession =
      directSession ?? findLinkedSession(eventNode.id, edges, nodeById);
    if (linkedSession) sessionNodeIdByNodeId.set(eventNode.id, linkedSession.id);
  }

  const eventGroups = new Map<string, GraphNode[]>();
  for (const eventNode of eventNodes) {
    const sessionNodeId = sessionNodeIdByNodeId.get(eventNode.id);
    const groupKey =
      sessionNodeId ??
      (eventNode.sessionId
        ? `unanchored:${eventNode.sessionId}`
        : "unanchored:events");
    const group = eventGroups.get(groupKey) ?? [];
    group.push(eventNode);
    eventGroups.set(groupKey, group);
  }

  const domainKeysByNodeId = new Map<string, string[]>();
  for (const sessionNode of sessionNodes) {
    domainKeysByNodeId.set(sessionNode.id, [
      domainStyleBySessionNodeId.get(sessionNode.id)!.key,
    ]);
  }
  for (const eventNode of eventNodes) {
    const sessionNodeId = sessionNodeIdByNodeId.get(eventNode.id);
    const style = sessionNodeId
      ? domainStyleBySessionNodeId.get(sessionNodeId)
      : DOMAIN_STYLE_BY_KEY.get("unclassified");
    domainKeysByNodeId.set(eventNode.id, [style!.key]);
  }

  const contextualNodes = nodes.filter(
    (node) => node.type === "entity" || node.type === "topic",
  );
  const connectedSessionNodeIdsByContextId = new Map<string, Set<string>>();
  for (const node of contextualNodes) {
    const connectedNodeIds = connectedNodeIdsByNodeId.get(node.id) ?? [];
    const connectedDomainKeys = uniqueStrings(
      connectedNodeIds.flatMap((nodeId) => domainKeysByNodeId.get(nodeId) ?? []),
    ).sort(compareDomainKeys);
    domainKeysByNodeId.set(
      node.id,
      connectedDomainKeys.length > 0 ? connectedDomainKeys : ["unclassified"],
    );

    const connectedSessionNodeIds = findConnectedSessionNodeIds(
      node.id,
      edges,
      sessionNodeIdByNodeId,
    );
    connectedSessionNodeIdsByContextId.set(node.id, connectedSessionNodeIds);
    if (connectedSessionNodeIds.size === 1) {
      sessionNodeIdByNodeId.set(node.id, [...connectedSessionNodeIds][0]!);
    }
  }

  const needsUnclassifiedDomain = nodes.some((node) =>
    domainKeysByNodeId.get(node.id)?.includes("unclassified"),
  );
  const domainStyles = uniqueDomainStyles([
    ...sessionNodes.map((node) => domainStyleBySessionNodeId.get(node.id)!),
    ...(needsUnclassifiedDomain
      ? [DOMAIN_STYLE_BY_KEY.get("unclassified")!]
      : []),
  ]);
  const sessionLayoutMetricsByNodeId = createSessionLayoutMetrics(
    sessionNodes,
    eventGroups,
    contextualNodes,
    sessionNodeIdByNodeId,
  );
  const sharedContextNodesByDomainKey = groupSharedContextNodesByDomain(
    contextualNodes,
    connectedSessionNodeIdsByContextId,
    domainKeysByNodeId,
  );
  const domainLayout = createDomainLayout(
    domainStyles,
    sessionNodes,
    domainStyleBySessionNodeId,
    sessionLayoutMetricsByNodeId,
    sharedContextNodesByDomainKey,
  );
  const domainCenterByKey = domainLayout.centerByKey;
  const sessionAnchorByNodeId = createSessionAnchors(
    sessionNodes,
    domainStyleBySessionNodeId,
    domainCenterByKey,
    sessionLayoutMetricsByNodeId,
  );
  const positionByNodeId = new Map<string, GraphVector>(sessionAnchorByNodeId);
  const chronologyByNodeId = new Map<
    string,
    { index: number; progress: number }
  >();

  for (const [groupKey, group] of [...eventGroups].sort(([left], [right]) =>
    left.localeCompare(right),
  )) {
    const anchor =
      sessionAnchorByNodeId.get(groupKey) ??
      domainCenterByKey.get("unclassified") ??
      unanchoredClusterPosition(groupKey);
    const sortedEvents = [...group].sort(compareEvents);
    const arcRadius =
      sessionLayoutMetricsByNodeId.get(groupKey)?.eventRingRadius ??
      eventRingRadiusForCount(sortedEvents.length);
    const suppliedDuration = nodeById.get(groupKey)
      ? metadataNumber(nodeById.get(groupKey)!, "durationSeconds")
      : null;
    const latestTimestamp = Math.max(
      0,
      ...sortedEvents.map(
        (eventNode) => metadataNumber(eventNode, "timestampSeconds") ?? 0,
      ),
    );
    const progressDenominator =
      suppliedDuration && suppliedDuration > 0
        ? suppliedDuration
        : latestTimestamp > 0
          ? latestTimestamp
          : null;

    sortedEvents.forEach((eventNode, index) => {
      const timestamp = metadataNumber(eventNode, "timestampSeconds");
      const fallbackProgress =
        sortedEvents.length <= 1 ? 0.5 : index / (sortedEvents.length - 1);
      const progress =
        timestamp !== null && progressDenominator
          ? Math.max(0, Math.min(1, timestamp / progressDenominator))
          : fallbackProgress;
      // Time advances along a stable screen-plane arc. Z is only a small,
      // deterministic separation offset and never represents a measurement.
      // Events are evenly spaced in chronological order. Timestamp progress
      // remains available as metadata, but distance is not presented as a
      // quantitative time axis.
      const angle = eventAngle(fallbackProgress);
      positionByNodeId.set(eventNode.id, {
        x: anchor.x + Math.cos(angle) * arcRadius,
        y: anchor.y + Math.sin(angle) * arcRadius,
        z: anchor.z + stableSignedValue(eventNode.id) * 0.46,
      });
      chronologyByNodeId.set(eventNode.id, { index, progress });
    });
  }

  positionContextNodes({
    contextualNodes,
    connectedNodeIdsByNodeId,
    connectedSessionNodeIdsByContextId,
    domainKeysByNodeId,
    domainCenterByKey,
    domainRadiusByKey: domainLayout.radiusByKey,
    sharedContextNodesByDomainKey,
    sharedContextRingMetricsByKey:
      domainLayout.sharedContextRingMetricsByKey,
    sessionAnchorByNodeId,
    sessionLayoutMetricsByNodeId,
    chronologyByNodeId,
    positionByNodeId,
  });

  const defaultLabelNodeIds = selectDefaultLabelNodeIds(
    sessionNodes,
    eventNodes,
    sessionNodeIdByNodeId,
  );

  const positionedNodes = nodes.map((node) => {
    const connectionCount = connectedNodeIdsByNodeId.get(node.id)?.length ?? 0;
    const domainKeys = domainKeysByNodeId.get(node.id) ?? ["unclassified"];
    const domainStyle =
      domainKeys.length > 1
        ? CROSS_DOMAIN_STYLE
        : DOMAIN_STYLE_BY_KEY.get(domainKeys[0]!) ??
          DOMAIN_STYLE_BY_KEY.get("unclassified")!;
    const importance = node.importance ?? 0.5;
    const radius = radiusForNode(node.type, importance, connectionCount);
    const sessionNodeId = sessionNodeIdByNodeId.get(node.id) ?? null;
    const sessionNode = sessionNodeId ? nodeById.get(sessionNodeId) : null;
    const chronology = chronologyByNodeId.get(node.id);

    return {
      ...node,
      position:
        positionByNodeId.get(node.id) ?? unanchoredClusterPosition(node.id),
      radius,
      shape: "sphere",
      surface: node.type === "session" ? "anchor" : node.type,
      color: domainStyle.color,
      labelVisibleByDefault: defaultLabelNodeIds.has(node.id),
      clusterSessionId: sessionNode?.sessionId ?? node.sessionId ?? null,
      timestampSeconds: metadataNumber(node, "timestampSeconds"),
      chronologyIndex: chronology?.index ?? null,
      chronologyProgress: chronology?.progress ?? null,
      connectionCount,
      domainKeys,
      domainLabel:
        domainKeys.length > 1
          ? domainKeys
              .map((key) => DOMAIN_STYLE_BY_KEY.get(key)?.label ?? key)
              .join(" + ")
          : domainStyle.label,
      isCrossDomainBridge: domainKeys.length > 1,
      sizeMeaning: sizeMeaningForNode(node.type),
    } satisfies PositionedGraphNode;
  });

  const domains = domainStyles.map((style) => ({
    ...style,
    position:
      domainCenterByKey.get(style.key) ?? unanchoredClusterPosition(style.key),
    radius: domainLayout.radiusByKey.get(style.key) ?? 4.5,
    sessionCount: positionedNodes.filter(
      (node) => node.type === "session" && node.domainKeys.includes(style.key),
    ).length,
    eventCount: positionedNodes.filter(
      (node) => node.type === "event" && node.domainKeys.includes(style.key),
    ).length,
    nodeCount: positionedNodes.filter((node) => node.domainKeys.includes(style.key))
      .length,
  } satisfies GraphDomainCluster));

  return {
    nodes: positionedNodes,
    edges: edges.map((edge) => ({
      ...edge,
      semanticBridge: edge.type === "semantic_similarity",
    })),
    domains,
    droppedDanglingEdgeIds: droppedDanglingEdgeIds.sort(),
  };
}

function radiusForNode(
  type: GraphNode["type"],
  importance: number,
  connectionCount: number,
): number {
  switch (type) {
    case "session":
      return 1.22;
    case "event":
      return 0.42 + importance * 0.52;
    case "entity":
      return 0.42 + Math.min(connectionCount, 8) * 0.035;
    case "topic":
      return 0.34 + Math.min(connectionCount, 8) * 0.03;
  }
}

function sizeMeaningForNode(type: GraphNode["type"]): string {
  switch (type) {
    case "session":
      return "Largest sphere anchors one viewing session";
    case "event":
      return "Sphere size represents supplied event importance";
    case "entity":
      return "Sphere size represents supplied connections to events";
    case "topic":
      return "Sphere size represents supplied connections to events";
  }
}

function selectDefaultLabelNodeIds(
  sessionNodes: GraphNode[],
  eventNodes: GraphNode[],
  sessionNodeIdByNodeId: Map<string, string>,
): Set<string> {
  const selected = new Set(sessionNodes.map((node) => node.id));
  const eventsBySession = new Map<string, GraphNode[]>();

  for (const node of eventNodes) {
    const groupKey =
      sessionNodeIdByNodeId.get(node.id) ??
      (node.sessionId ? `unanchored:${node.sessionId}` : "unanchored:events");
    const group = eventsBySession.get(groupKey) ?? [];
    group.push(node);
    eventsBySession.set(groupKey, group);
  }

  for (const [, events] of [...eventsBySession].sort(([left], [right]) =>
    left.localeCompare(right),
  )) {
    const mostImportant = [...events].sort(
      (left, right) =>
        (right.importance ?? -1) - (left.importance ?? -1) ||
        compareEvents(left, right),
    )[0];
    if (mostImportant) selected.add(mostImportant.id);
  }

  return selected;
}

function createSessionLayoutMetrics(
  sessionNodes: GraphNode[],
  eventGroups: Map<string, GraphNode[]>,
  contextualNodes: GraphNode[],
  sessionNodeIdByNodeId: Map<string, string>,
): Map<string, SessionLayoutMetrics> {
  const contextCountsBySessionNodeId = new Map<
    string,
    { entity: number; topic: number }
  >();

  for (const node of contextualNodes) {
    const sessionNodeId = sessionNodeIdByNodeId.get(node.id);
    if (!sessionNodeId) continue;
    const counts = contextCountsBySessionNodeId.get(sessionNodeId) ?? {
      entity: 0,
      topic: 0,
    };
    if (node.type === "entity") counts.entity += 1;
    if (node.type === "topic") counts.topic += 1;
    contextCountsBySessionNodeId.set(sessionNodeId, counts);
  }

  return new Map(
    sessionNodes.map((sessionNode) => {
      const eventCount = eventGroups.get(sessionNode.id)?.length ?? 0;
      const counts = contextCountsBySessionNodeId.get(sessionNode.id) ?? {
        entity: 0,
        topic: 0,
      };
      const eventRingRadius = eventRingRadiusForCount(eventCount);
      const entityShellRadius = packedRingRadius(
        counts.entity,
        eventRingRadius + EVENT_MAX_RADIUS + ENTITY_MAX_RADIUS + SHELL_GAP,
        ENTITY_MAX_RADIUS,
      );
      const topicShellRadius = packedRingRadius(
        counts.topic,
        entityShellRadius + ENTITY_MAX_RADIUS + TOPIC_MAX_RADIUS + SHELL_GAP,
        TOPIC_MAX_RADIUS,
      );
      const contentExtent = Math.max(
        1.22,
        eventCount > 0 ? eventRingRadius + 0.98 : 0,
        counts.entity > 0 ? entityShellRadius + 0.76 : 0,
        counts.topic > 0 ? topicShellRadius + 0.66 : 0,
      );

      return [
        sessionNode.id,
        {
          eventRingRadius,
          entityShellRadius,
          topicShellRadius,
          footprintRadius: contentExtent + 0.45,
        },
      ];
    }),
  );
}

function eventRingRadiusForCount(eventCount: number): number {
  if (eventCount <= 1) return 3.6;
  const angularStep = EVENT_ARC_SWEEP / (eventCount - 1);
  const chordFactor = 2 * Math.sin(angularStep / 2);
  return Math.max(
    3.6,
    (EVENT_MAX_RADIUS * 2 + NODE_GAP) / chordFactor,
  );
}

function packedRingRadius(
  nodeCount: number,
  minimumRadius: number,
  maximumNodeRadius: number,
): number {
  if (nodeCount <= 1) return minimumRadius;
  const chordFactor = 2 * Math.sin(Math.PI / nodeCount);
  return Math.max(
    minimumRadius,
    (maximumNodeRadius * 2 + NODE_GAP) / chordFactor,
  );
}

function eventAngle(progress: number): number {
  return EVENT_ARC_START - progress * EVENT_ARC_SWEEP;
}

function groupSharedContextNodesByDomain(
  contextualNodes: GraphNode[],
  connectedSessionNodeIdsByContextId: Map<string, Set<string>>,
  domainKeysByNodeId: Map<string, string[]>,
): Map<string, GraphNode[]> {
  const nodesByDomainKey = new Map<string, GraphNode[]>();

  for (const node of contextualNodes) {
    const connectedSessionNodeIds =
      connectedSessionNodeIdsByContextId.get(node.id) ?? new Set<string>();
    if (connectedSessionNodeIds.size === 1) continue;
    const domainKeys = domainKeysByNodeId.get(node.id) ?? ["unclassified"];
    if (domainKeys.length !== 1) continue;
    const domainKey = domainKeys[0]!;
    const group = nodesByDomainKey.get(domainKey) ?? [];
    group.push(node);
    nodesByDomainKey.set(domainKey, group);
  }

  return nodesByDomainKey;
}

function positionContextNodes({
  contextualNodes,
  connectedNodeIdsByNodeId,
  connectedSessionNodeIdsByContextId,
  domainKeysByNodeId,
  domainCenterByKey,
  domainRadiusByKey,
  sharedContextNodesByDomainKey,
  sharedContextRingMetricsByKey,
  sessionAnchorByNodeId,
  sessionLayoutMetricsByNodeId,
  chronologyByNodeId,
  positionByNodeId,
}: {
  contextualNodes: GraphNode[];
  connectedNodeIdsByNodeId: Map<string, string[]>;
  connectedSessionNodeIdsByContextId: Map<string, Set<string>>;
  domainKeysByNodeId: Map<string, string[]>;
  domainCenterByKey: Map<string, GraphVector>;
  domainRadiusByKey: Map<string, number>;
  sharedContextNodesByDomainKey: Map<string, GraphNode[]>;
  sharedContextRingMetricsByKey: Map<string, SharedContextRingMetrics>;
  sessionAnchorByNodeId: Map<string, GraphVector>;
  sessionLayoutMetricsByNodeId: Map<string, SessionLayoutMetrics>;
  chronologyByNodeId: Map<string, { index: number; progress: number }>;
  positionByNodeId: Map<string, GraphVector>;
}): void {
  const nodesBySessionAndType = new Map<string, GraphNode[]>();

  for (const node of contextualNodes) {
    const connectedSessionNodeIds =
      connectedSessionNodeIdsByContextId.get(node.id) ?? new Set<string>();
    if (connectedSessionNodeIds.size !== 1) continue;
    const sessionNodeId = [...connectedSessionNodeIds][0]!;
    if (!sessionAnchorByNodeId.has(sessionNodeId)) continue;
    const groupKey = `${sessionNodeId}:${node.type}`;
    const group = nodesBySessionAndType.get(groupKey) ?? [];
    group.push(node);
    nodesBySessionAndType.set(groupKey, group);
  }

  for (const [groupKey, group] of [...nodesBySessionAndType].sort(
    ([left], [right]) => left.localeCompare(right),
  )) {
    const separatorIndex = groupKey.lastIndexOf(":");
    const sessionNodeId = groupKey.slice(0, separatorIndex);
    const type = groupKey.slice(separatorIndex + 1) as "entity" | "topic";
    const anchor = sessionAnchorByNodeId.get(sessionNodeId)!;
    const metrics = sessionLayoutMetricsByNodeId.get(sessionNodeId)!;
    const shellRadius =
      type === "entity"
        ? metrics.entityShellRadius
        : metrics.topicShellRadius;
    const sortedNodes = [...group].sort(
      (left, right) =>
        contextChronologyScore(
          left,
          connectedNodeIdsByNodeId,
          chronologyByNodeId,
        ) -
          contextChronologyScore(
            right,
            connectedNodeIdsByNodeId,
            chronologyByNodeId,
          ) ||
        left.id.localeCompare(right.id),
    );

    sortedNodes.forEach((node, index) => {
      const angle =
        sortedNodes.length === 1
          ? eventAngle(
              contextChronologyScore(
                node,
                connectedNodeIdsByNodeId,
                chronologyByNodeId,
              ),
            )
          : EVENT_ARC_START - (index / sortedNodes.length) * Math.PI * 2;
      positionByNodeId.set(node.id, {
        x: anchor.x + Math.cos(angle) * shellRadius,
        y: anchor.y + Math.sin(angle) * shellRadius,
        z: anchor.z + stableSignedValue(`${node.id}:depth`) * 0.54,
      });
    });
  }

  const crossDomainNodes = contextualNodes
    .filter(
      (node) =>
        !positionByNodeId.has(node.id) &&
        (domainKeysByNodeId.get(node.id)?.length ?? 0) > 1,
    )
    .sort((left, right) => {
      const leftCenter = averagePosition(
        (domainKeysByNodeId.get(left.id) ?? [])
          .map((key) => domainCenterByKey.get(key))
          .filter((position): position is GraphVector => Boolean(position)),
      );
      const rightCenter = averagePosition(
        (domainKeysByNodeId.get(right.id) ?? [])
          .map((key) => domainCenterByKey.get(key))
          .filter((position): position is GraphVector => Boolean(position)),
      );
      return leftCenter.x - rightCenter.x || left.id.localeCompare(right.id);
    });

  if (crossDomainNodes.length > 0) {
    const domainBounds = [...domainCenterByKey].map(([key, center]) => ({
      center,
      radius: domainRadiusByKey.get(key) ?? 4,
    }));
    const left = Math.min(
      ...domainBounds.map(({ center, radius }) => center.x - radius),
    );
    const right = Math.max(
      ...domainBounds.map(({ center, radius }) => center.x + radius),
    );
    const top = Math.max(
      ...domainBounds.map(({ center, radius }) => center.y + radius),
    );
    const spacing = ENTITY_MAX_RADIUS * 2 + NODE_GAP;
    const columnCount = Math.max(1, Math.floor((right - left) / spacing) + 1);
    const laneCenter = (left + right) / 2;

    crossDomainNodes.forEach((node, index) => {
      const row = Math.floor(index / columnCount);
      const rowStartIndex = row * columnCount;
      const nodesInRow = Math.min(
        columnCount,
        crossDomainNodes.length - rowStartIndex,
      );
      const column = index - rowStartIndex;
      positionByNodeId.set(node.id, {
        x: laneCenter + (column - (nodesInRow - 1) / 2) * spacing,
        y: top + CROSS_DOMAIN_LANE_GAP + row * spacing,
        z: stableSignedValue(`${node.id}:depth`) * 0.62,
      });
    });
  }

  for (const [domainKey, group] of [...sharedContextNodesByDomainKey].sort(
    ([left], [right]) => compareDomainKeys(left, right),
  )) {
    if (!domainCenterByKey.has(domainKey)) continue;
    const center = domainCenterByKey.get(domainKey)!;
    const entities = group
      .filter((node) => node.type === "entity")
      .sort((left, right) => left.id.localeCompare(right.id));
    const topics = group
      .filter((node) => node.type === "topic")
      .sort((left, right) => left.id.localeCompare(right.id));
    const ringMetrics = sharedContextRingMetricsByKey.get(domainKey);
    if (!ringMetrics) continue;

    for (const [type, nodes, ringRadius] of [
      ["entity", entities, ringMetrics.entityRingRadius],
      ["topic", topics, ringMetrics.topicRingRadius],
    ] as const) {
      nodes.forEach((node, index) => {
        const angle =
          nodes.length === 1
            ? stableAngle(node.id)
            : EVENT_ARC_START - (index / nodes.length) * Math.PI * 2;
        positionByNodeId.set(node.id, {
          x: center.x + Math.cos(angle) * ringRadius,
          y: center.y + Math.sin(angle) * ringRadius,
          z:
            center.z +
            stableSignedValue(`${domainKey}:${type}:${node.id}:depth`) * 0.62,
        });
      });
    }
  }

  for (const node of contextualNodes) {
    if (positionByNodeId.has(node.id)) continue;
    positionByNodeId.set(node.id, unanchoredClusterPosition(node.id));
  }
}

function contextChronologyScore(
  node: GraphNode,
  connectedNodeIdsByNodeId: Map<string, string[]>,
  chronologyByNodeId: Map<string, { index: number; progress: number }>,
): number {
  const progresses = (connectedNodeIdsByNodeId.get(node.id) ?? [])
    .map((nodeId) => chronologyByNodeId.get(nodeId)?.progress)
    .filter((progress): progress is number => typeof progress === "number");
  if (progresses.length === 0) return stableUnitValue(node.id);
  return (
    progresses.reduce((sum, progress) => sum + progress, 0) /
    progresses.length
  );
}

function createAdjacency(
  nodes: GraphNode[],
  edges: GraphEdge[],
): Map<string, string[]> {
  const adjacency = new Map(nodes.map((node) => [node.id, [] as string[]]));
  for (const edge of edges) {
    adjacency.get(edge.source)?.push(edge.target);
    adjacency.get(edge.target)?.push(edge.source);
  }
  for (const connectedNodeIds of adjacency.values()) {
    connectedNodeIds.sort((left, right) => left.localeCompare(right));
  }
  return adjacency;
}

function uniqueNodes(nodes: GraphNode[]): GraphNode[] {
  const seen = new Set<string>();
  return nodes.filter((node) => {
    if (seen.has(node.id)) return false;
    seen.add(node.id);
    return true;
  });
}

function uniqueEdges(edges: GraphEdge[]): GraphEdge[] {
  const seen = new Set<string>();
  return edges.filter((edge) => {
    if (seen.has(edge.id)) return false;
    seen.add(edge.id);
    return true;
  });
}

function compareNodes(left: GraphNode, right: GraphNode): number {
  return (
    TYPE_ORDER[left.type] - TYPE_ORDER[right.type] ||
    left.id.localeCompare(right.id)
  );
}

function compareEvents(left: GraphNode, right: GraphNode): number {
  const leftTimestamp = metadataNumber(left, "timestampSeconds");
  const rightTimestamp = metadataNumber(right, "timestampSeconds");
  if (leftTimestamp !== null || rightTimestamp !== null) {
    return (
      (leftTimestamp ?? Number.POSITIVE_INFINITY) -
        (rightTimestamp ?? Number.POSITIVE_INFINITY) ||
      left.id.localeCompare(right.id)
    );
  }
  return left.id.localeCompare(right.id);
}

function createDomainLayout(
  styles: DomainStyle[],
  sessionNodes: GraphNode[],
  domainStyleBySessionNodeId: Map<string, DomainStyle>,
  sessionLayoutMetricsByNodeId: Map<string, SessionLayoutMetrics>,
  sharedContextNodesByDomainKey: Map<string, GraphNode[]>,
): DomainLayout {
  const sessionsByDomain = groupSessionsByDomain(
    sessionNodes,
    domainStyleBySessionNodeId,
  );
  const radiusByKey = new Map<string, number>();
  const sharedContextRingMetricsByKey = new Map<
    string,
    SharedContextRingMetrics
  >();

  for (const style of styles) {
    const sessions = sessionsByDomain.get(style.key) ?? [];
    const maxFootprint = Math.max(
      4.5,
      ...sessions.map(
        (session) =>
          sessionLayoutMetricsByNodeId.get(session.id)?.footprintRadius ?? 4.5,
      ),
    );
    const orbitRadius = sessionOrbitRadius(sessions.length, maxFootprint);
    const sessionFootprintRadius = orbitRadius + maxFootprint;
    const ringMetrics = createSharedContextRingMetrics(
      sharedContextNodesByDomainKey.get(style.key) ?? [],
      sessionFootprintRadius,
    );
    sharedContextRingMetricsByKey.set(style.key, ringMetrics);
    radiusByKey.set(style.key, ringMetrics.footprintRadius);
  }

  const centerByKey = new Map<string, GraphVector>();
  let cursor = 0;
  for (const style of styles) {
    const radius = radiusByKey.get(style.key) ?? 4.5;
    centerByKey.set(style.key, { x: cursor + radius, y: 0, z: 0 });
    cursor += radius * 2 + DOMAIN_ISLAND_GAP;
  }
  const totalWidth = Math.max(0, cursor - DOMAIN_ISLAND_GAP);
  for (const [key, center] of centerByKey) {
    centerByKey.set(key, { ...center, x: center.x - totalWidth / 2 });
  }

  return { centerByKey, radiusByKey, sharedContextRingMetricsByKey };
}

function createSharedContextRingMetrics(
  nodes: GraphNode[],
  sessionFootprintRadius: number,
): SharedContextRingMetrics {
  const entityCount = nodes.filter((node) => node.type === "entity").length;
  const topicCount = nodes.filter((node) => node.type === "topic").length;
  const entityRingRadius = packedRingRadius(
    entityCount,
    sessionFootprintRadius + ENTITY_MAX_RADIUS + SHELL_GAP,
    ENTITY_MAX_RADIUS,
  );
  const topicRingRadius = packedRingRadius(
    topicCount,
    entityRingRadius + ENTITY_MAX_RADIUS + TOPIC_MAX_RADIUS + SHELL_GAP,
    TOPIC_MAX_RADIUS,
  );
  const sharedContextExtent = Math.max(
    entityCount > 0 ? entityRingRadius + ENTITY_MAX_RADIUS : 0,
    topicCount > 0 ? topicRingRadius + TOPIC_MAX_RADIUS : 0,
  );

  return {
    entityRingRadius,
    topicRingRadius,
    footprintRadius:
      sharedContextExtent > 0
        ? Math.max(sessionFootprintRadius, sharedContextExtent + 0.45)
        : sessionFootprintRadius,
  };
}

function createSessionAnchors(
  sessionNodes: GraphNode[],
  domainStyleBySessionNodeId: Map<string, DomainStyle>,
  domainCenterByKey: Map<string, GraphVector>,
  sessionLayoutMetricsByNodeId: Map<string, SessionLayoutMetrics>,
): Map<string, GraphVector> {
  const anchors = new Map<string, GraphVector>();
  const sessionsByDomain = groupSessionsByDomain(
    sessionNodes,
    domainStyleBySessionNodeId,
  );

  for (const [domainKey, sessions] of [...sessionsByDomain].sort(
    ([left], [right]) => compareDomainKeys(left, right),
  )) {
    const center = domainCenterByKey.get(domainKey) ?? { x: 0, y: 0, z: 0 };
    const sortedSessions = [...sessions].sort(compareSessions);
    const maxFootprint = Math.max(
      4.5,
      ...sortedSessions.map(
        (session) =>
          sessionLayoutMetricsByNodeId.get(session.id)?.footprintRadius ?? 4.5,
      ),
    );
    const orbitRadius = sessionOrbitRadius(
      sortedSessions.length,
      maxFootprint,
    );
    sortedSessions.forEach((session, index) => {
      const angle = (index / sortedSessions.length) * Math.PI * 2 - Math.PI / 2;
      anchors.set(session.id, {
        x: center.x + Math.cos(angle) * orbitRadius,
        y: center.y + Math.sin(angle) * orbitRadius,
        z: center.z + stableSignedValue(session.id) * 0.34,
      });
    });
  }

  return anchors;
}

function groupSessionsByDomain(
  sessionNodes: GraphNode[],
  domainStyleBySessionNodeId: Map<string, DomainStyle>,
): Map<string, GraphNode[]> {
  const sessionsByDomain = new Map<string, GraphNode[]>();
  for (const session of sessionNodes) {
    const domainKey = domainStyleBySessionNodeId.get(session.id)!.key;
    const sessions = sessionsByDomain.get(domainKey) ?? [];
    sessions.push(session);
    sessionsByDomain.set(domainKey, sessions);
  }
  return sessionsByDomain;
}

function sessionOrbitRadius(
  sessionCount: number,
  maximumFootprintRadius: number,
): number {
  if (sessionCount <= 1) return 0;
  const minimumCenterSpacing =
    maximumFootprintRadius * 2 + SESSION_SYSTEM_GAP;
  return minimumCenterSpacing / (2 * Math.sin(Math.PI / sessionCount));
}

function compareSessions(left: GraphNode, right: GraphNode): number {
  const leftStartedAt = metadataDate(left, "startedAt");
  const rightStartedAt = metadataDate(right, "startedAt");
  return rightStartedAt - leftStartedAt || left.id.localeCompare(right.id);
}

function domainStyleForNode(node: GraphNode): DomainStyle {
  const value = metadataString(node, "domain")?.toLocaleLowerCase("en-US") ?? "";
  if (/esport|game|gaming|moba|battle royale/.test(value)) {
    return DOMAIN_STYLE_BY_KEY.get("esports")!;
  }
  if (/football|soccer|basketball|baseball|cricket|tennis|\bsports?\b/.test(value)) {
    return DOMAIN_STYLE_BY_KEY.get("sports")!;
  }
  if (/concert|music|festival|performance/.test(value)) {
    return DOMAIN_STYLE_BY_KEY.get("concerts")!;
  }
  if (/product|launch|keynote|announcement/.test(value)) {
    return DOMAIN_STYLE_BY_KEY.get("product-launches")!;
  }
  if (/creator|livestream|streamer|influencer/.test(value)) {
    return DOMAIN_STYLE_BY_KEY.get("creator-streams")!;
  }
  return DOMAIN_STYLE_BY_KEY.get("unclassified")!;
}

function uniqueDomainStyles(styles: DomainStyle[]): DomainStyle[] {
  const styleByKey = new Map(styles.map((style) => [style.key, style]));
  return [...styleByKey.values()].sort((left, right) =>
    compareDomainKeys(left.key, right.key),
  );
}

function compareDomainKeys(left: string, right: string): number {
  const leftIndex = DOMAIN_STYLES.findIndex((style) => style.key === left);
  const rightIndex = DOMAIN_STYLES.findIndex((style) => style.key === right);
  return (
    (leftIndex < 0 ? Number.POSITIVE_INFINITY : leftIndex) -
      (rightIndex < 0 ? Number.POSITIVE_INFINITY : rightIndex) ||
    left.localeCompare(right)
  );
}

function findLinkedSession(
  nodeId: string,
  edges: GraphEdge[],
  nodeById: Map<string, GraphNode>,
): GraphNode | undefined {
  for (const edge of edges) {
    const otherId =
      edge.source === nodeId
        ? edge.target
        : edge.target === nodeId
          ? edge.source
          : null;
    if (!otherId) continue;
    const otherNode = nodeById.get(otherId);
    if (otherNode?.type === "session") return otherNode;
  }
  return undefined;
}

function findConnectedSessionNodeIds(
  nodeId: string,
  edges: GraphEdge[],
  sessionNodeIdByNodeId: Map<string, string>,
): Set<string> {
  const connected = new Set<string>();
  for (const edge of edges) {
    const otherId =
      edge.source === nodeId
        ? edge.target
        : edge.target === nodeId
          ? edge.source
          : null;
    if (!otherId) continue;
    const sessionNodeId = sessionNodeIdByNodeId.get(otherId);
    if (sessionNodeId) connected.add(sessionNodeId);
  }
  return connected;
}

function averagePosition(positions: GraphVector[]): GraphVector {
  if (positions.length === 0) return { x: 0, y: 0, z: 0 };
  const sum = positions.reduce(
    (current, position) => ({
      x: current.x + position.x,
      y: current.y + position.y,
      z: current.z + position.z,
    }),
    { x: 0, y: 0, z: 0 },
  );
  return {
    x: sum.x / positions.length,
    y: sum.y / positions.length,
    z: sum.z / positions.length,
  };
}

function unanchoredClusterPosition(key: string): GraphVector {
  const angle = stableAngle(key);
  return {
    x: Math.cos(angle) * 4.8,
    y: Math.sin(angle) * 3.2,
    z: stableSignedValue(`${key}:depth`) * 1.2,
  };
}

function stableAngle(value: string): number {
  return stableUnitValue(value) * Math.PI * 2;
}

function stableSignedValue(value: string): number {
  return stableUnitValue(value) * 2 - 1;
}

function stableUnitValue(value: string): number {
  let hash = 2_166_136_261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16_777_619);
  }
  return (hash >>> 0) / 4_294_967_295;
}

function uniqueStrings(values: string[]): string[] {
  return [...new Set(values)];
}

function metadataNumber(node: GraphNode, key: string): number | null {
  const value = node.metadata?.[key];
  return typeof value === "number" && Number.isFinite(value) && value >= 0
    ? value
    : null;
}

function metadataString(node: GraphNode, key: string): string | null {
  const value = node.metadata?.[key];
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function metadataDate(node: GraphNode, key: string): number {
  const value = metadataString(node, key);
  const timestamp = value ? Date.parse(value) : Number.NaN;
  return Number.isFinite(timestamp) ? timestamp : 0;
}
