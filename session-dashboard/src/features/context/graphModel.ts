import type { GraphEdge, GraphNode } from "../../api/contracts";

export type GraphNodeShape = "sphere" | "box" | "octahedron" | "torus";

export type GraphVector = {
  x: number;
  y: number;
  z: number;
};

export type PositionedGraphNode = GraphNode & {
  position: GraphVector;
  radius: number;
  shape: GraphNodeShape;
  color: number;
  labelVisibleByDefault: boolean;
  clusterSessionId: string | null;
  timestampSeconds: number | null;
};

export type PositionedGraphEdge = GraphEdge & {
  semanticBridge: boolean;
};

export type GraphSceneModel = {
  nodes: PositionedGraphNode[];
  edges: PositionedGraphEdge[];
  droppedDanglingEdgeIds: string[];
};

const NODE_STYLES: Record<
  GraphNode["type"],
  { shape: GraphNodeShape; color: number; radius: number }
> = {
  session: { shape: "sphere", color: 0x20b8a7, radius: 0.92 },
  event: { shape: "box", color: 0xf6b73c, radius: 0.48 },
  entity: { shape: "octahedron", color: 0x6da7ff, radius: 0.58 },
  topic: { shape: "torus", color: 0xd58cff, radius: 0.54 },
};

const TYPE_ORDER: Record<GraphNode["type"], number> = {
  session: 0,
  event: 1,
  entity: 2,
  topic: 3,
};

const DEFAULT_SESSION_LABEL_LIMIT = 8;
const DEFAULT_EVENT_LABEL_LIMIT = 4;

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

  const sessionNodes = nodes.filter((node) => node.type === "session");
  const sessionAnchorByNodeId = createSessionAnchors(sessionNodes);
  const sessionNodeBySessionId = new Map(
    sessionNodes.flatMap((node) =>
      node.sessionId ? ([[node.sessionId, node]] as const) : [],
    ),
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
    const linkedSession = directSession ?? findLinkedSession(eventNode.id, edges, nodeById);
    if (linkedSession) sessionNodeIdByNodeId.set(eventNode.id, linkedSession.id);
  }

  const eventGroups = new Map<string, GraphNode[]>();
  for (const eventNode of eventNodes) {
    const sessionNodeId = sessionNodeIdByNodeId.get(eventNode.id);
    const groupKey =
      sessionNodeId ??
      (eventNode.sessionId ? `unanchored:${eventNode.sessionId}` : "unanchored:events");
    const group = eventGroups.get(groupKey) ?? [];
    group.push(eventNode);
    eventGroups.set(groupKey, group);
  }

  const positionByNodeId = new Map<string, GraphVector>(sessionAnchorByNodeId);
  for (const [groupKey, group] of [...eventGroups].sort(([left], [right]) =>
    left.localeCompare(right),
  )) {
    const anchor =
      sessionAnchorByNodeId.get(groupKey) ?? unanchoredClusterPosition(groupKey);
    const sortedEvents = [...group].sort(compareEvents);
    const angle = Math.atan2(anchor.z, anchor.x || 0.0001);
    const tangent = { x: -Math.sin(angle), z: Math.cos(angle) };
    const radial = { x: Math.cos(angle), z: Math.sin(angle) };

    sortedEvents.forEach((eventNode, index) => {
      const offset = (index - (sortedEvents.length - 1) / 2) * 1.65;
      const importance = eventNode.importance ?? 0.5;
      positionByNodeId.set(eventNode.id, {
        x: anchor.x + tangent.x * offset + radial.x * 2.3,
        y: 0.35 + importance * 1.8,
        z: anchor.z + tangent.z * offset + radial.z * 2.3,
      });
    });
  }

  const contextualNodes = nodes.filter(
    (node) => node.type === "entity" || node.type === "topic",
  );
  contextualNodes.forEach((node, index) => {
    const connectedSessionNodeIds = findConnectedSessionNodeIds(
      node.id,
      edges,
      sessionNodeIdByNodeId,
    );
    const connectedAnchors = [...connectedSessionNodeIds]
      .map((sessionNodeId) => sessionAnchorByNodeId.get(sessionNodeId))
      .filter((position): position is GraphVector => Boolean(position));
    const base = connectedAnchors.length
      ? averagePosition(connectedAnchors)
      : { x: 0, y: 0, z: 0 };
    const angle = stableAngle(node.id);
    const outerOffset = connectedAnchors.length === 0 ? 7.5 : 3.7;
    const ring = outerOffset + (index % 3) * 0.62;
    positionByNodeId.set(node.id, {
      x: base.x + Math.cos(angle) * ring,
      y: node.type === "entity" ? 2.7 : -1.4,
      z: base.z + Math.sin(angle) * ring,
    });

    if (connectedAnchors.length > 0) {
      const closestSession = closestSessionNodeId(
        positionByNodeId.get(node.id)!,
        sessionAnchorByNodeId,
      );
      if (closestSession) sessionNodeIdByNodeId.set(node.id, closestSession);
    }
  });

  const defaultLabelNodeIds = selectDefaultLabelNodeIds(
    sessionNodes,
    eventNodes,
  );

  const positionedNodes = nodes.map((node) => {
    const style = NODE_STYLES[node.type];
    const importance = node.importance ?? 0.5;
    const radius =
      node.type === "event"
        ? style.radius * (0.72 + importance * 0.78)
        : style.radius;
    const sessionNodeId = sessionNodeIdByNodeId.get(node.id) ?? null;
    const sessionNode = sessionNodeId ? nodeById.get(sessionNodeId) : null;

    return {
      ...node,
      position: positionByNodeId.get(node.id) ?? unanchoredClusterPosition(node.id),
      radius,
      shape: style.shape,
      color: style.color,
      labelVisibleByDefault: defaultLabelNodeIds.has(node.id),
      clusterSessionId: sessionNode?.sessionId ?? node.sessionId ?? null,
      timestampSeconds: metadataNumber(node, "timestampSeconds"),
    } satisfies PositionedGraphNode;
  });

  return {
    nodes: positionedNodes,
    edges: edges.map((edge) => ({
      ...edge,
      semanticBridge: edge.type === "semantic_similarity",
    })),
    droppedDanglingEdgeIds: droppedDanglingEdgeIds.sort(),
  };
}

function selectDefaultLabelNodeIds(
  sessionNodes: GraphNode[],
  eventNodes: GraphNode[],
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

  return selected;
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
  return TYPE_ORDER[left.type] - TYPE_ORDER[right.type] || left.id.localeCompare(right.id);
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

function createSessionAnchors(sessionNodes: GraphNode[]): Map<string, GraphVector> {
  const anchors = new Map<string, GraphVector>();
  const radius = sessionNodes.length <= 1 ? 0 : Math.max(7, sessionNodes.length * 2.5);

  sessionNodes.forEach((node, index) => {
    const angle = (index / Math.max(1, sessionNodes.length)) * Math.PI * 2 - Math.PI / 2;
    anchors.set(node.id, {
      x: Math.cos(angle) * radius,
      y: 0,
      z: Math.sin(angle) * radius,
    });
  });

  return anchors;
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

function closestSessionNodeId(
  position: GraphVector,
  anchors: Map<string, GraphVector>,
): string | null {
  let closestId: string | null = null;
  let closestDistance = Number.POSITIVE_INFINITY;
  for (const [id, anchor] of anchors) {
    const distance =
      (position.x - anchor.x) ** 2 +
      (position.y - anchor.y) ** 2 +
      (position.z - anchor.z) ** 2;
    if (distance < closestDistance) {
      closestDistance = distance;
      closestId = id;
    }
  }
  return closestId;
}

function unanchoredClusterPosition(key: string): GraphVector {
  const angle = stableAngle(key);
  return {
    x: Math.cos(angle) * 4.8,
    y: 0,
    z: Math.sin(angle) * 4.8,
  };
}

function stableAngle(value: string): number {
  let hash = 2_166_136_261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16_777_619);
  }
  return ((hash >>> 0) / 4_294_967_295) * Math.PI * 2;
}

function metadataNumber(node: GraphNode, key: string): number | null {
  const value = node.metadata?.[key];
  return typeof value === "number" && Number.isFinite(value) && value >= 0
    ? value
    : null;
}
