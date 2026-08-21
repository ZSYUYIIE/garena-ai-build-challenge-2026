import type { GraphEdge, GraphNode } from "../../api/contracts";

export type GraphNodeShape = "sphere";
export type GraphNodeSurface = "anchor" | "event" | "entity" | "topic";
export type GraphProjectionMode = "three-dimensional" | "two-dimensional";
export type GraphSceneScope = "all-domains-overview" | "filtered";
export type GraphPositionMeaning =
  | "structural"
  | "measured-event"
  | "derived-context";

export type GraphVector = {
  x: number;
  y: number;
  z: number;
};

export type GraphAxisTick = {
  value: number | string;
  position: number;
  label: string;
};

export type GraphAxis = {
  key: "progress" | "importance" | "entertainment";
  label: string;
  minimum: number;
  maximum: number;
  ticks: GraphAxisTick[];
};

export type GraphMemoryRoot = {
  label: string;
  position: GraphVector;
  radius: number;
  color: number;
};

export type GraphDomainCluster = {
  key: string;
  label: string;
  color: number;
  position: GraphVector;
  radius: number;
  laneIndex: number;
  lanePosition: number;
  sessionCount: number;
  eventCount: number;
  nodeCount: number;
  isEmpty: boolean;
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
  progress: number | null;
  importanceScore: number | null;
  connectionCount: number;
  domainKeys: string[];
  domainLabel: string;
  lanePosition: number;
  isCrossDomainBridge: boolean;
  positionMeaning: GraphPositionMeaning;
  sizeMeaning: string;
};

export type PositionedGraphEdge = GraphEdge & {
  semanticBridge: boolean;
};

export type GraphSceneModel = {
  nodes: PositionedGraphNode[];
  edges: PositionedGraphEdge[];
  domains: GraphDomainCluster[];
  memoryRoot: GraphMemoryRoot;
  axes: {
    progress: GraphAxis;
    importance: GraphAxis;
    entertainment: GraphAxis;
  };
  projectionMode: GraphProjectionMode;
  scope: GraphSceneScope;
  reservedDomainCount: number;
  droppedDanglingEdgeIds: string[];
};

export type GraphModelOptions = {
  scope?: GraphSceneScope;
};

type DomainStyle = {
  key: string;
  label: string;
  color: number;
};

type SessionPlacement = {
  domainKey: string;
  lanePosition: number;
  position: GraphVector;
};

type ClassifiedGraph = {
  nodes: GraphNode[];
  edges: GraphEdge[];
  nodeById: Map<string, GraphNode>;
  adjacency: Map<string, string[]>;
  sessionNodes: GraphNode[];
  eventNodes: GraphNode[];
  contextNodes: GraphNode[];
  sessionNodeIdByNodeId: Map<string, string>;
  domainStyleBySessionNodeId: Map<string, DomainStyle>;
  domainKeysByNodeId: Map<string, string[]>;
};

const UNCLASSIFIED_DOMAIN_STYLE: DomainStyle = {
  key: "unclassified",
  label: "Domain unavailable",
  color: 0xcbd5e1,
};

const CANONICAL_DOMAIN_STYLES: DomainStyle[] = [
  { key: "sports", label: "Sports", color: 0x2dd4bf },
  { key: "esports", label: "Esports and games", color: 0xa78bfa },
  { key: "concerts", label: "Concerts", color: 0xf472b6 },
  { key: "product-launches", label: "Product launches", color: 0xfbbf24 },
  { key: "creator-streams", label: "Creator livestreams", color: 0x60a5fa },
];

const DOMAIN_STYLES = [...CANONICAL_DOMAIN_STYLES, UNCLASSIFIED_DOMAIN_STYLE];

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

const MEMORY_ROOT_X = -22;
const DOMAIN_ROOT_X = -14;
const SESSION_ROOT_X = -6;
const PLOT_X_MINIMUM = 0;
const PLOT_X_MAXIMUM = 28;
const PLOT_Y_MINIMUM = -7;
const PLOT_Y_MAXIMUM = 7;
const UNSCORED_Y = -9.25;
const DOMAIN_LANE_SPACING = 8.5;
const DOMAIN_SUBLANE_SPREAD = 2.2;
const MEMORY_ROOT_RADIUS = 3.25;
const DOMAIN_ROOT_RADIUS = 2.35;
const SESSION_RADIUS = 1.35;
const EVENT_MIN_RADIUS = 0.48;
const EVENT_MAX_RADIUS = 0.92;
const ENTITY_MAX_RADIUS = 0.54;
const TOPIC_MAX_RADIUS = 0.48;

export function buildGraphSceneModel(
  inputNodes: GraphNode[],
  inputEdges: GraphEdge[],
  options: GraphModelOptions = {},
): GraphSceneModel {
  const scope = options.scope ?? "filtered";
  const validatedNodes = uniqueNodes(inputNodes).sort(compareNodes);
  const validatedNodeById = new Map(
    validatedNodes.map((node) => [node.id, node]),
  );
  const droppedDanglingEdgeIds: string[] = [];
  const validatedEdges = uniqueEdges(inputEdges)
    .filter((edge) => {
      const valid =
        validatedNodeById.has(edge.source) &&
        validatedNodeById.has(edge.target);
      if (!valid) droppedDanglingEdgeIds.push(edge.id);
      return valid;
    })
    .sort((left, right) => left.id.localeCompare(right.id));
  const classified = classifyGraph(validatedNodes, validatedEdges);
  const projected =
    scope === "all-domains-overview"
      ? omitUnclassifiedOverviewSubgraphs(classified)
      : classified;
  const {
    nodes,
    edges,
    nodeById,
    adjacency,
    sessionNodes,
    eventNodes,
    contextNodes,
    sessionNodeIdByNodeId,
    domainStyleBySessionNodeId,
    domainKeysByNodeId,
  } = projected;

  const suppliedDomainStyles = uniqueDomainStyles([
    ...sessionNodes.map((node) => domainStyleBySessionNodeId.get(node.id)!),
    ...nodes
      .filter((node) => domainKeysByNodeId.get(node.id)?.includes("unclassified"))
      .map(() => DOMAIN_STYLE_BY_KEY.get("unclassified")!),
  ]);
  const domainStyles =
    scope === "all-domains-overview"
      ? CANONICAL_DOMAIN_STYLES
      : suppliedDomainStyles;
  const laneByDomainKey = createDomainLanes(domainStyles);
  const sessionsByDomain = groupSessionsByDomain(
    sessionNodes,
    domainStyleBySessionNodeId,
  );
  const sessionPlacementByNodeId = createSessionPlacements(
    sessionsByDomain,
    laneByDomainKey,
  );

  const eventGroups = groupEventsBySession(eventNodes, sessionNodeIdByNodeId);
  const positionByNodeId = new Map<string, GraphVector>();
  const progressByNodeId = new Map<string, number | null>();
  const importanceByNodeId = new Map<string, number | null>();
  const chronologyByNodeId = new Map<
    string,
    { index: number; progress: number | null }
  >();

  for (const session of sessionNodes) {
    const placement = sessionPlacementByNodeId.get(session.id);
    if (placement) positionByNodeId.set(session.id, placement.position);
  }

  for (const [groupKey, group] of [...eventGroups].sort(([left], [right]) =>
    left.localeCompare(right),
  )) {
    const sortedEvents = [...group].sort(compareEvents);
    const session = nodeById.get(groupKey);
    const duration = session ? metadataNumber(session, "durationSeconds") : null;
    const latestTimestamp = Math.max(
      0,
      ...sortedEvents.map((event) => metadataNumber(event, "timestampSeconds") ?? 0),
    );
    const denominator =
      duration && duration > 0
        ? duration
        : latestTimestamp > 0
          ? latestTimestamp
          : null;
    const sessionPlacement = sessionPlacementByNodeId.get(groupKey);
    const fallbackDomainKey = sessionPlacement?.domainKey ?? "unclassified";
    const fallbackLane =
      sessionPlacement?.lanePosition ?? laneByDomainKey.get(fallbackDomainKey) ?? 0;

    sortedEvents.forEach((event, index) => {
      const timestamp = metadataNumber(event, "timestampSeconds");
      const progress = denominator
        ? clamp01((timestamp ?? 0) / denominator)
        : sortedEvents.length <= 1
          ? 0.5
          : index / (sortedEvents.length - 1);
      const importance = validScore(event.importance);
      const domainKey = domainKeysByNodeId.get(event.id)?.[0] ?? fallbackDomainKey;
      const lane = sessionPlacement?.lanePosition ?? laneByDomainKey.get(domainKey) ?? fallbackLane;
      positionByNodeId.set(event.id, {
        x: progressToPosition(progress),
        y: importanceToPosition(importance),
        z: lane,
      });
      progressByNodeId.set(event.id, progress);
      importanceByNodeId.set(event.id, importance);
      chronologyByNodeId.set(event.id, { index, progress });
    });
  }

  positionContextNodes({
    contextNodes,
    edges,
    nodeById,
    domainKeysByNodeId,
    laneByDomainKey,
    positionByNodeId,
    progressByNodeId,
    importanceByNodeId,
  });

  // The hierarchy roots and semantic rulers carry the default overview.
  // Individual node labels are disclosed on hover/selection so the five
  // measured lane planes remain readable instead of becoming a label cloud.
  const defaultLabelNodeIds = new Set<string>();
  const positionedNodes = nodes.map((node) => {
    const connectionCount = adjacency.get(node.id)?.length ?? 0;
    const domainKeys = domainKeysByNodeId.get(node.id) ?? ["unclassified"];
    const style =
      domainKeys.length > 1
        ? CROSS_DOMAIN_STYLE
        : DOMAIN_STYLE_BY_KEY.get(domainKeys[0]!) ??
          DOMAIN_STYLE_BY_KEY.get("unclassified")!;
    const sessionNodeId = sessionNodeIdByNodeId.get(node.id) ?? null;
    const sessionNode = sessionNodeId ? nodeById.get(sessionNodeId) : null;
    const progress = progressByNodeId.get(node.id) ?? null;
    const importance = importanceByNodeId.get(node.id) ?? validScore(node.importance);
    const position =
      positionByNodeId.get(node.id) ??
      ({
        x: PLOT_X_MINIMUM,
        y: UNSCORED_Y,
        z: laneByDomainKey.get(domainKeys[0] ?? "unclassified") ?? 0,
      } satisfies GraphVector);

    return {
      ...node,
      position,
      radius: radiusForNode(node.type, importance, connectionCount),
      shape: "sphere",
      surface: node.type === "session" ? "anchor" : node.type,
      color: style.color,
      labelVisibleByDefault: defaultLabelNodeIds.has(node.id),
      clusterSessionId: sessionNode?.sessionId ?? node.sessionId ?? null,
      timestampSeconds: metadataNumber(node, "timestampSeconds"),
      chronologyIndex: chronologyByNodeId.get(node.id)?.index ?? null,
      chronologyProgress: chronologyByNodeId.get(node.id)?.progress ?? progress,
      progress,
      importanceScore: importance,
      connectionCount,
      domainKeys,
      domainLabel:
        domainKeys.length > 1
          ? domainKeys
              .map((key) => DOMAIN_STYLE_BY_KEY.get(key)?.label ?? key)
              .join(" + ")
          : style.label,
      lanePosition: position.z,
      isCrossDomainBridge: domainKeys.length > 1,
      positionMeaning:
        node.type === "event"
          ? "measured-event"
          : node.type === "entity" || node.type === "topic"
            ? "derived-context"
            : "structural",
      sizeMeaning: sizeMeaningForNode(node.type),
    } satisfies PositionedGraphNode;
  });

  const domains = domainStyles.map((style, laneIndex) => {
    const lanePosition = laneByDomainKey.get(style.key) ?? 0;
    const sessionCount = positionedNodes.filter(
      (node) => node.type === "session" && node.domainKeys.includes(style.key),
    ).length;
    const eventCount = positionedNodes.filter(
      (node) => node.type === "event" && node.domainKeys.includes(style.key),
    ).length;
    const nodeCount = positionedNodes.filter((node) =>
      node.domainKeys.includes(style.key),
    ).length;
    return {
      ...style,
      position: { x: DOMAIN_ROOT_X, y: 0, z: lanePosition },
      radius: DOMAIN_ROOT_RADIUS,
      laneIndex,
      lanePosition,
      sessionCount,
      eventCount,
      nodeCount,
      isEmpty: nodeCount === 0,
    } satisfies GraphDomainCluster;
  });

  return {
    nodes: positionedNodes,
    edges: edges.map((edge) => ({
      ...edge,
      semanticBridge: edge.type === "semantic_similarity",
    })),
    domains,
    memoryRoot: {
      label: "StreamSense Memory",
      position: { x: MEMORY_ROOT_X, y: 0, z: 0 },
      radius: MEMORY_ROOT_RADIUS,
      color: 0xf8fafc,
    },
    axes: createAxes(domains),
    projectionMode:
      scope === "all-domains-overview" || domains.length >= 2
        ? "three-dimensional"
        : "two-dimensional",
    scope,
    reservedDomainCount:
      scope === "all-domains-overview" ? CANONICAL_DOMAIN_STYLES.length : 0,
    droppedDanglingEdgeIds: droppedDanglingEdgeIds.sort(),
  };
}

function classifyGraph(nodes: GraphNode[], edges: GraphEdge[]): ClassifiedGraph {
  const nodeById = new Map(nodes.map((node) => [node.id, node]));
  const adjacency = createAdjacency(nodes, edges);
  const sessionNodes = nodes.filter((node) => node.type === "session");
  const eventNodes = nodes.filter((node) => node.type === "event");
  const contextNodes = nodes.filter(
    (node) => node.type === "entity" || node.type === "topic",
  );
  const sessionNodeBySessionId = new Map(
    sessionNodes.flatMap((node) =>
      node.sessionId ? ([[node.sessionId, node]] as const) : [],
    ),
  );
  const sessionNodeIdByNodeId = new Map<string, string>(
    sessionNodes.map((node) => [node.id, node.id]),
  );
  const domainStyleBySessionNodeId = new Map(
    sessionNodes.map((node) => [node.id, domainStyleForNode(node)]),
  );

  for (const event of eventNodes) {
    const session = event.sessionId
      ? sessionNodeBySessionId.get(event.sessionId)
      : undefined;
    const linked = session ?? findLinkedSession(event.id, edges, nodeById);
    if (linked) sessionNodeIdByNodeId.set(event.id, linked.id);
  }

  const domainKeysByNodeId = new Map<string, string[]>();
  for (const session of sessionNodes) {
    domainKeysByNodeId.set(session.id, [
      domainStyleBySessionNodeId.get(session.id)?.key ?? "unclassified",
    ]);
  }
  for (const event of eventNodes) {
    const sessionNodeId = sessionNodeIdByNodeId.get(event.id);
    const style = sessionNodeId
      ? domainStyleBySessionNodeId.get(sessionNodeId)
      : UNCLASSIFIED_DOMAIN_STYLE;
    domainKeysByNodeId.set(event.id, [style?.key ?? "unclassified"]);
  }
  for (const context of contextNodes) {
    const connectedDomains = uniqueStrings(
      (adjacency.get(context.id) ?? []).flatMap(
        (nodeId) => domainKeysByNodeId.get(nodeId) ?? [],
      ),
    ).sort(compareDomainKeys);
    const canonicalDomains = connectedDomains.filter(
      (domainKey) => domainKey !== "unclassified",
    );
    domainKeysByNodeId.set(
      context.id,
      canonicalDomains.length > 0
        ? canonicalDomains
        : connectedDomains.length > 0
          ? connectedDomains
          : ["unclassified"],
    );
    const connectedSessions = findConnectedSessionNodeIds(
      context.id,
      edges,
      sessionNodeIdByNodeId,
    );
    if (connectedSessions.size === 1) {
      sessionNodeIdByNodeId.set(context.id, [...connectedSessions][0]!);
    }
  }

  return {
    nodes,
    edges,
    nodeById,
    adjacency,
    sessionNodes,
    eventNodes,
    contextNodes,
    sessionNodeIdByNodeId,
    domainStyleBySessionNodeId,
    domainKeysByNodeId,
  };
}

function omitUnclassifiedOverviewSubgraphs(
  graph: ClassifiedGraph,
): ClassifiedGraph {
  const retainedNodeIds = new Set(
    graph.nodes
      .filter((node) =>
        (graph.domainKeysByNodeId.get(node.id) ?? ["unclassified"]).some(
          (domainKey) => domainKey !== "unclassified",
        ),
      )
      .map((node) => node.id),
  );
  const nodes = graph.nodes.filter((node) => retainedNodeIds.has(node.id));
  const edges = graph.edges.filter(
    (edge) =>
      retainedNodeIds.has(edge.source) && retainedNodeIds.has(edge.target),
  );
  return classifyGraph(nodes, edges);
}

function createAxes(domains: GraphDomainCluster[]): GraphSceneModel["axes"] {
  return {
    progress: {
      key: "progress",
      label: "Stream progress",
      minimum: PLOT_X_MINIMUM,
      maximum: PLOT_X_MAXIMUM,
      ticks: [0, 0.25, 0.5, 0.75, 1].map((progress) => ({
        value: progress,
        position: progressToPosition(progress),
        label: `${Math.round(progress * 100)}%`,
      })),
    },
    importance: {
      key: "importance",
      label: "Moment importance",
      minimum: UNSCORED_Y,
      maximum: PLOT_Y_MAXIMUM,
      ticks: [
        { value: "unscored", position: UNSCORED_Y, label: "Not scored" },
        { value: 0, position: PLOT_Y_MINIMUM, label: "Routine · 0%" },
        { value: 0.5, position: 0, label: "Notable · 50%" },
        { value: 1, position: PLOT_Y_MAXIMUM, label: "Critical · 100%" },
      ],
    },
    entertainment: {
      key: "entertainment",
      label: "Entertainment lane",
      minimum: Math.min(0, ...domains.map((domain) => domain.lanePosition)),
      maximum: Math.max(0, ...domains.map((domain) => domain.lanePosition)),
      ticks: domains.map((domain) => ({
        value: domain.key,
        position: domain.lanePosition,
        label: domain.label,
      })),
    },
  };
}

function createDomainLanes(styles: DomainStyle[]): Map<string, number> {
  const center = (styles.length - 1) / 2;
  return new Map(
    styles.map((style, index) => [
      style.key,
      (index - center) * DOMAIN_LANE_SPACING,
    ]),
  );
}

function createSessionPlacements(
  sessionsByDomain: Map<string, GraphNode[]>,
  laneByDomainKey: Map<string, number>,
): Map<string, SessionPlacement> {
  const placements = new Map<string, SessionPlacement>();
  for (const [domainKey, sessions] of [...sessionsByDomain].sort(([left], [right]) =>
    compareDomainKeys(left, right),
  )) {
    const sorted = [...sessions].sort(compareSessions);
    const center = (sorted.length - 1) / 2;
    sorted.forEach((session, index) => {
      const relative = sorted.length <= 1 ? 0 : (index - center) / center;
      const lanePosition =
        (laneByDomainKey.get(domainKey) ?? 0) + relative * DOMAIN_SUBLANE_SPREAD;
      placements.set(session.id, {
        domainKey,
        lanePosition,
        position: {
          x: SESSION_ROOT_X,
          y: relative * 3.2,
          z: lanePosition,
        },
      });
    });
  }
  return placements;
}

function positionContextNodes({
  contextNodes,
  edges,
  nodeById,
  domainKeysByNodeId,
  laneByDomainKey,
  positionByNodeId,
  progressByNodeId,
  importanceByNodeId,
}: {
  contextNodes: GraphNode[];
  edges: GraphEdge[];
  nodeById: Map<string, GraphNode>;
  domainKeysByNodeId: Map<string, string[]>;
  laneByDomainKey: Map<string, number>;
  positionByNodeId: Map<string, GraphVector>;
  progressByNodeId: Map<string, number | null>;
  importanceByNodeId: Map<string, number | null>;
}): void {
  for (const context of contextNodes) {
    const connections = edges.flatMap((edge) => {
      const otherId =
        edge.source === context.id
          ? edge.target
          : edge.target === context.id
            ? edge.source
            : null;
      if (!otherId || nodeById.get(otherId)?.type !== "event") return [];
      const position = positionByNodeId.get(otherId);
      if (!position) return [];
      return [{
        nodeId: otherId,
        position,
        weight: edge.weight > 0 ? edge.weight : 1,
      }];
    });
    const domainKeys = domainKeysByNodeId.get(context.id) ?? ["unclassified"];
    if (connections.length === 0) {
      positionByNodeId.set(context.id, {
        x: PLOT_X_MINIMUM,
        y: UNSCORED_Y,
        z: laneByDomainKey.get(domainKeys[0] ?? "unclassified") ?? 0,
      });
      progressByNodeId.set(context.id, null);
      importanceByNodeId.set(context.id, null);
      continue;
    }

    const totalWeight = connections.reduce((sum, item) => sum + item.weight, 0);
    const centroid = connections.reduce(
      (sum, item) => ({
        x: sum.x + item.position.x * item.weight,
        y: sum.y + item.position.y * item.weight,
        z: sum.z + item.position.z * item.weight,
      }),
      { x: 0, y: 0, z: 0 },
    );
    centroid.x /= totalWeight;
    centroid.y /= totalWeight;
    centroid.z /= totalWeight;
    const jitter = stableSignedValue(context.id);
    const roleDirection = context.type === "entity" ? 1 : -1;
    positionByNodeId.set(context.id, {
      x: centroid.x + jitter * 0.58,
      y: centroid.y + roleDirection * 0.72,
      z: centroid.z + jitter * 0.62,
    });
    progressByNodeId.set(
      context.id,
      weightedNullableAverage(
        connections.map((item) => ({
          value: progressByNodeId.get(item.nodeId) ?? null,
          weight: item.weight,
        })),
      ),
    );
    importanceByNodeId.set(
      context.id,
      weightedNullableAverage(
        connections.map((item) => ({
          value: importanceByNodeId.get(item.nodeId) ?? null,
          weight: item.weight,
        })),
      ),
    );
  }
}

function weightedNullableAverage(
  values: Array<{ value: number | null; weight: number }>,
): number | null {
  const supplied = values.filter(
    (item): item is { value: number; weight: number } => item.value !== null,
  );
  if (supplied.length === 0) return null;
  const weight = supplied.reduce((sum, item) => sum + item.weight, 0);
  return supplied.reduce((sum, item) => sum + item.value * item.weight, 0) / weight;
}

function radiusForNode(
  type: GraphNode["type"],
  importance: number | null,
  connectionCount: number,
): number {
  switch (type) {
    case "session":
      return SESSION_RADIUS;
    case "event":
      return EVENT_MIN_RADIUS + (importance ?? 0.32) * (EVENT_MAX_RADIUS - EVENT_MIN_RADIUS);
    case "entity":
      return Math.min(ENTITY_MAX_RADIUS, 0.34 + connectionCount * 0.025);
    case "topic":
      return Math.min(TOPIC_MAX_RADIUS, 0.29 + connectionCount * 0.022);
  }
}

function sizeMeaningForNode(type: GraphNode["type"]): string {
  switch (type) {
    case "session":
      return "Session spheres are smaller than domain roots and larger than every moment";
    case "event":
      return "Sphere size represents supplied event importance";
    case "entity":
      return "Sphere size represents supplied connections to events";
    case "topic":
      return "Sphere size represents supplied connections to events";
  }
}

function groupEventsBySession(
  eventNodes: GraphNode[],
  sessionNodeIdByNodeId: Map<string, string>,
): Map<string, GraphNode[]> {
  const groups = new Map<string, GraphNode[]>();
  for (const event of eventNodes) {
    const groupKey =
      sessionNodeIdByNodeId.get(event.id) ??
      (event.sessionId ? `unanchored:${event.sessionId}` : "unanchored:events");
    const group = groups.get(groupKey) ?? [];
    group.push(event);
    groups.set(groupKey, group);
  }
  return groups;
}

function groupSessionsByDomain(
  sessionNodes: GraphNode[],
  domainStyleBySessionNodeId: Map<string, DomainStyle>,
): Map<string, GraphNode[]> {
  const groups = new Map<string, GraphNode[]>();
  for (const session of sessionNodes) {
    const key = domainStyleBySessionNodeId.get(session.id)?.key ?? "unclassified";
    const group = groups.get(key) ?? [];
    group.push(session);
    groups.set(key, group);
  }
  return groups;
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
  return TYPE_ORDER[left.type] - TYPE_ORDER[right.type] || left.id.localeCompare(right.id);
}

function compareEvents(left: GraphNode, right: GraphNode): number {
  return (
    (metadataNumber(left, "timestampSeconds") ?? Number.POSITIVE_INFINITY) -
      (metadataNumber(right, "timestampSeconds") ?? Number.POSITIVE_INFINITY) ||
    left.id.localeCompare(right.id)
  );
}

function compareSessions(left: GraphNode, right: GraphNode): number {
  return metadataDate(left, "startedAt") - metadataDate(right, "startedAt") ||
    left.id.localeCompare(right.id);
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
  const byKey = new Map(styles.map((style) => [style.key, style]));
  return [...byKey.values()].sort((left, right) => compareDomainKeys(left.key, right.key));
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
    const other = nodeById.get(otherId);
    if (other?.type === "session") return other;
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

function progressToPosition(progress: number): number {
  return PLOT_X_MINIMUM + clamp01(progress) * (PLOT_X_MAXIMUM - PLOT_X_MINIMUM);
}

function importanceToPosition(importance: number | null): number {
  return importance === null
    ? UNSCORED_Y
    : PLOT_Y_MINIMUM + clamp01(importance) * (PLOT_Y_MAXIMUM - PLOT_Y_MINIMUM);
}

function validScore(value: number | undefined): number | null {
  return typeof value === "number" && Number.isFinite(value)
    ? clamp01(value)
    : null;
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function stableSignedValue(value: string): number {
  let hash = 2_166_136_261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16_777_619);
  }
  return ((hash >>> 0) / 4_294_967_295) * 2 - 1;
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
