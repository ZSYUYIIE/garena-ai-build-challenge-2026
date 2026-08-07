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

const DEFAULT_SESSION_LABEL_LIMIT = 8;
const DEFAULT_EVENT_LABEL_LIMIT = 3;
const DEFAULT_CONTEXT_LABEL_LIMIT = 1;

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

  const domainStyles = uniqueDomainStyles([
    ...sessionNodes.map((node) => domainStyleBySessionNodeId.get(node.id)!),
    ...(sessionNodes.length === 0 && nodes.length > 0
      ? [DOMAIN_STYLE_BY_KEY.get("unclassified")!]
      : []),
  ]);
  const domainCenterByKey = createDomainCenters(domainStyles);
  const sessionAnchorByNodeId = createSessionAnchors(
    sessionNodes,
    domainStyleBySessionNodeId,
    domainCenterByKey,
  );
  const positionByNodeId = new Map<string, GraphVector>(sessionAnchorByNodeId);
  const chronologyByNodeId = new Map<
    string,
    { index: number; progress: number }
  >();

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

  for (const [groupKey, group] of [...eventGroups].sort(([left], [right]) =>
    left.localeCompare(right),
  )) {
    const anchor =
      sessionAnchorByNodeId.get(groupKey) ??
      domainCenterByKey.get("unclassified") ??
      unanchoredClusterPosition(groupKey);
    const sortedEvents = [...group].sort(compareEvents);
    const arcRadius = 2.85 + Math.min(sortedEvents.length, 18) * 0.045;
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
      const angle = Math.PI * 0.82 - progress * Math.PI * 1.64;
      positionByNodeId.set(eventNode.id, {
        x: anchor.x + Math.cos(angle) * arcRadius,
        y: anchor.y + Math.sin(angle) * arcRadius * 0.72,
        z: anchor.z + stableSignedValue(eventNode.id) * 0.72,
      });
      chronologyByNodeId.set(eventNode.id, { index, progress });
    });
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
  for (const node of contextualNodes) {
    const connectedNodeIds = connectedNodeIdsByNodeId.get(node.id) ?? [];
    const connectedPositions = connectedNodeIds
      .map((nodeId) => positionByNodeId.get(nodeId))
      .filter((position): position is GraphVector => Boolean(position));
    const connectedDomainKeys = uniqueStrings(
      connectedNodeIds.flatMap((nodeId) => domainKeysByNodeId.get(nodeId) ?? []),
    ).sort(compareDomainKeys);
    const domainKeys =
      connectedDomainKeys.length > 0 ? connectedDomainKeys : ["unclassified"];
    domainKeysByNodeId.set(node.id, domainKeys);

    const base = connectedPositions.length
      ? averagePosition(connectedPositions)
      : averagePosition(
          domainKeys
            .map((domainKey) => domainCenterByKey.get(domainKey))
            .filter((position): position is GraphVector => Boolean(position)),
        );
    const angle = stableAngle(node.id);
    const offset = connectedPositions.length
      ? node.type === "entity"
        ? 0.78
        : 1.02
      : 3.8;
    positionByNodeId.set(node.id, {
      x: base.x + Math.cos(angle) * offset,
      y: base.y + Math.sin(angle) * offset,
      z: base.z + stableSignedValue(`${node.id}:depth`) * 1.05,
    });

    const connectedSessionNodeIds = findConnectedSessionNodeIds(
      node.id,
      edges,
      sessionNodeIdByNodeId,
    );
    if (connectedSessionNodeIds.size === 1) {
      sessionNodeIdByNodeId.set(node.id, [...connectedSessionNodeIds][0]!);
    }
  }

  const defaultLabelNodeIds = selectDefaultLabelNodeIds(
    sessionNodes,
    eventNodes,
    contextualNodes,
    connectedNodeIdsByNodeId,
    domainKeysByNodeId,
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
  contextualNodes: GraphNode[],
  adjacency: Map<string, string[]>,
  domainKeysByNodeId: Map<string, string[]>,
): Set<string> {
  const selected = new Set(
    sessionNodes
      .slice(0, DEFAULT_SESSION_LABEL_LIMIT)
      .map((node) => node.id),
  );

  [...eventNodes]
    .sort(
      (left, right) =>
        (right.importance ?? -1) - (left.importance ?? -1) ||
        compareEvents(left, right),
    )
    .slice(0, DEFAULT_EVENT_LABEL_LIMIT)
    .forEach((node) => selected.add(node.id));

  [...contextualNodes]
    .sort(
      (left, right) =>
        (domainKeysByNodeId.get(right.id)?.length ?? 0) -
          (domainKeysByNodeId.get(left.id)?.length ?? 0) ||
        (adjacency.get(right.id)?.length ?? 0) -
          (adjacency.get(left.id)?.length ?? 0) ||
        left.id.localeCompare(right.id),
    )
    .slice(0, DEFAULT_CONTEXT_LABEL_LIMIT)
    .forEach((node) => selected.add(node.id));

  return selected;
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

function createDomainCenters(
  styles: DomainStyle[],
): Map<string, GraphVector> {
  const centers = new Map<string, GraphVector>();
  if (styles.length === 1) {
    centers.set(styles[0]!.key, { x: 0, y: 0, z: 0 });
    return centers;
  }

  const radius = Math.max(9.5, styles.length * 3.7);
  styles.forEach((style, index) => {
    const angle = (index / styles.length) * Math.PI * 2;
    centers.set(style.key, {
      x: Math.cos(angle) * radius,
      y: Math.sin(angle) * radius * 0.62,
      z: Math.sin(angle * 2) * 1.5,
    });
  });
  return centers;
}

function createSessionAnchors(
  sessionNodes: GraphNode[],
  domainStyleBySessionNodeId: Map<string, DomainStyle>,
  domainCenterByKey: Map<string, GraphVector>,
): Map<string, GraphVector> {
  const anchors = new Map<string, GraphVector>();
  const sessionsByDomain = new Map<string, GraphNode[]>();
  for (const session of sessionNodes) {
    const domainKey = domainStyleBySessionNodeId.get(session.id)!.key;
    const sessions = sessionsByDomain.get(domainKey) ?? [];
    sessions.push(session);
    sessionsByDomain.set(domainKey, sessions);
  }

  for (const [domainKey, sessions] of [...sessionsByDomain].sort(([left], [right]) =>
    compareDomainKeys(left, right),
  )) {
    const center = domainCenterByKey.get(domainKey) ?? { x: 0, y: 0, z: 0 };
    const sortedSessions = [...sessions].sort(compareSessions);
    const orbitRadius = sortedSessions.length <= 1 ? 0 : 2.55 + sortedSessions.length * 0.3;
    sortedSessions.forEach((session, index) => {
      const angle = (index / sortedSessions.length) * Math.PI * 2 - Math.PI / 2;
      anchors.set(session.id, {
        x: center.x + Math.cos(angle) * orbitRadius,
        y: center.y + Math.sin(angle) * orbitRadius * 0.7,
        z: center.z + stableSignedValue(session.id) * 0.55,
      });
    });
  }

  return anchors;
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
