import { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";

import type { GraphEdge, GraphNode } from "../../api/contracts";
import {
  Button,
  Label,
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from "../../components/StreamSenseUi";
import {
  formatElapsedTime,
  formatPercent,
  humanizeEventType,
} from "../../lib/format";
import {
  buildGraphSceneModel,
  type GraphSceneModel,
  type PositionedGraphNode,
} from "./graphModel";
import {
  createThreeGraphRenderer,
  type GraphRendererController,
  type GraphRendererFactory,
} from "./threeGraphRenderer";

export type ThreeGraphExplorerProps = {
  nodes: GraphNode[];
  edges: GraphEdge[];
  rendererFactory?: GraphRendererFactory;
};

export function ThreeGraphExplorer({
  nodes,
  edges,
  rendererFactory = createThreeGraphRenderer,
}: ThreeGraphExplorerProps) {
  const model = useMemo(() => buildGraphSceneModel(nodes, edges), [nodes, edges]);
  const reducedMotion = usePrefersReducedMotion();
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const controllerRef = useRef<GraphRendererController | null>(null);
  const [renderStatus, setRenderStatus] = useState<"ready" | "unavailable">(
    "ready",
  );
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);

  const selectedNode =
    model.nodes.find((node) => node.id === selectedNodeId) ?? null;
  const selectedSession = selectedNode?.clusterSessionId
    ? model.nodes.find(
        (node) =>
          node.type === "session" &&
          node.sessionId === selectedNode.clusterSessionId,
      ) ?? null
    : null;
  const summary = summarizeGraph(model);

  useEffect(() => {
    if (
      selectedNodeId &&
      !model.nodes.some((node) => node.id === selectedNodeId)
    ) {
      setSelectedNodeId(null);
    }
  }, [model.nodes, selectedNodeId]);

  useEffect(() => {
    const container = containerRef.current;
    const canvas = canvasRef.current;
    if (!container || !canvas || model.nodes.length === 0) return;

    let controller: GraphRendererController;
    try {
      controller = rendererFactory({
        container,
        canvas,
        model,
        reducedMotion,
        onSelect: setSelectedNodeId,
        onHover: () => undefined,
      });
      setRenderStatus("ready");
    } catch {
      controllerRef.current = null;
      setRenderStatus("unavailable");
      return;
    }

    controllerRef.current = controller;
    controller.selectNode(selectedNodeId);
    controller.setPaused(reducedMotion);
    return () => {
      controller.dispose();
      if (controllerRef.current === controller) controllerRef.current = null;
    };
  }, [model, reducedMotion, rendererFactory]);

  const selectNode = (nodeId: string | null) => {
    setSelectedNodeId(nodeId);
    controllerRef.current?.selectNode(nodeId);
  };

  const resetView = () => {
    selectNode(null);
    controllerRef.current?.resetCamera();
  };

  if (model.nodes.length === 0) {
    return (
      <section className="graph-explorer" aria-labelledby="graph-explorer-heading">
        <div className="graph-explorer-heading">
          <div>
            <p className="eyebrow">StreamSense memory constellation</p>
            <h2 id="graph-explorer-heading">3D relationship map</h2>
          </div>
        </div>
        <p className="graph-empty">No graph nodes are available to visualize.</p>
      </section>
    );
  }

  const groupedNodes = groupNodesByDomain(model.nodes);
  const selectedRelationships = selectedNode
    ? describeRelationships(selectedNode, model)
    : [];
  const hasCrossDomainNodes = model.nodes.some(
    (node) => node.isCrossDomainBridge,
  );

  return (
    <section className="graph-explorer" aria-labelledby="graph-explorer-heading">
      <div className="graph-explorer-heading">
        <div className="graph-title-block">
          <p className="eyebrow">StreamSense memory constellation</p>
          <h2 id="graph-explorer-heading">3D relationship map</h2>
        </div>
        <div className="graph-introduction">
          <p id="graph-map-summary" className="graph-summary">
            {summary}
          </p>
          <p id="graph-layout-explanation" className="graph-layout-explanation">
            This is a memory hierarchy, not an XYZ chart. Horizontal placement
            separates entertainment domains; each session anchors a system,
            moments run clockwise in time, and entities and topics form the
            outer context. Depth only helps separate overlapping spheres.
          </p>
        </div>
      </div>

      <ol className="graph-hierarchy" aria-label="Relationship map hierarchy">
        <li>
          <span>1</span>
          <strong>Domain island</strong>
          <small>Sports, esports, and other entertainment stay distinct.</small>
        </li>
        <li>
          <span>2</span>
          <strong>Session anchor</strong>
          <small>The largest sphere is one captured viewing session.</small>
        </li>
        <li>
          <span>3</span>
          <strong>Moment ring</strong>
          <small>Events progress clockwise in timestamp order.</small>
        </li>
        <li>
          <span>4</span>
          <strong>Context shell</strong>
          <small>Entities and topics sit outside the moments they connect.</small>
        </li>
      </ol>

      <div className="graph-camera-controls" aria-label="3D map camera controls">
        <Button
          className="graph-control-button"
          variant="outline"
          size="sm"
          type="button"
          onClick={() => controllerRef.current?.rotateCamera(-0.24, 0)}
          isDisabled={renderStatus === "unavailable"}
        >
          Rotate left
        </Button>
        <Button
          className="graph-control-button"
          variant="outline"
          size="sm"
          type="button"
          onClick={() => controllerRef.current?.rotateCamera(0.24, 0)}
          isDisabled={renderStatus === "unavailable"}
        >
          Rotate right
        </Button>
        <Button
          className="graph-control-button"
          variant="outline"
          size="sm"
          type="button"
          onClick={() => controllerRef.current?.rotateCamera(0, -0.18)}
          isDisabled={renderStatus === "unavailable"}
        >
          Tilt up
        </Button>
        <Button
          className="graph-control-button"
          variant="outline"
          size="sm"
          type="button"
          onClick={() => controllerRef.current?.rotateCamera(0, 0.18)}
          isDisabled={renderStatus === "unavailable"}
        >
          Tilt down
        </Button>
        <Button
          className="graph-control-button"
          variant="outline"
          size="sm"
          type="button"
          onClick={() => controllerRef.current?.zoomCamera(0.82)}
          isDisabled={renderStatus === "unavailable"}
        >
          Zoom in
        </Button>
        <Button
          className="graph-control-button"
          variant="outline"
          size="sm"
          type="button"
          onClick={() => controllerRef.current?.zoomCamera(1.22)}
          isDisabled={renderStatus === "unavailable"}
        >
          Zoom out
        </Button>
        <Button
          className="graph-control-button"
          variant="outline"
          size="sm"
          type="button"
          onClick={resetView}
          isDisabled={renderStatus === "unavailable"}
        >
          Reset view
        </Button>
      </div>

      <div className="graph-visual-layout">
        <div
          className="graph-viewport"
          ref={containerRef}
          data-render-status={renderStatus}
        >
          <canvas
            ref={canvasRef}
            className="graph-canvas"
            role="img"
            aria-label="Interactive 3D StreamSense memory constellation"
            aria-describedby="graph-map-summary graph-layout-explanation"
          />
          {renderStatus === "unavailable" ? (
            <div className="graph-fallback" role="status">
              <strong>3D view unavailable</strong>
              <span>
                WebGL could not start in this browser. Use the node selector,
                supplied connections, and readable relationship lists instead.
              </span>
            </div>
          ) : null}
        </div>

        <aside className="graph-details" aria-labelledby="graph-details-heading">
          <h3 id="graph-details-heading">Inspect a node</h3>
          <Select
            className="field graph-node-selector"
            selectedKey={selectedNodeId}
            placeholder="Choose a node"
            onSelectionChange={(key) => selectNode(key === null ? null : String(key))}
          >
            <Label>Labeled graph node</Label>
            <SelectTrigger
              id="graph-node-select"
              data-graph-node-selector
              aria-describedby="graph-node-select-hint"
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent className="graph-node-select-content">
              {groupedNodes.map(([domainLabel, domainNodes]) => (
                <SelectGroup key={domainLabel}>
                  <SelectLabel>{domainLabel}</SelectLabel>
                  {domainNodes.map((node) => (
                    <SelectItem
                      key={node.id}
                      id={node.id}
                      textValue={`${humanizeEventType(node.type)}: ${node.label}`}
                    >
                      {humanizeEventType(node.type)}: {node.label}
                    </SelectItem>
                  ))}
                </SelectGroup>
              ))}
            </SelectContent>
            <p id="graph-node-select-hint" className="field-hint">
              This labeled selector is the keyboard alternative to choosing a
              sphere in the canvas. Arrow keys move through every node.
            </p>
          </Select>

          <div className="graph-selection">
            {selectedNode ? (
              <>
                <span
                  className={`graph-detail-type graph-detail-type--${selectedNode.type}`}
                >
                  {humanizeEventType(selectedNode.type)} sphere
                </span>
                <h4>{selectedNode.label}</h4>
                <dl>
                  <div>
                    <dt>Entertainment domain</dt>
                    <dd>{selectedNode.domainLabel}</dd>
                  </div>
                  {selectedNode.timestampSeconds !== null ? (
                    <div>
                      <dt>Session time</dt>
                      <dd>{formatElapsedTime(selectedNode.timestampSeconds)}</dd>
                    </div>
                  ) : null}
                  {typeof selectedNode.importance === "number" ? (
                    <div>
                      <dt>Importance</dt>
                      <dd>{formatPercent(selectedNode.importance)}</dd>
                    </div>
                  ) : null}
                  {selectedSession && selectedSession.id !== selectedNode.id ? (
                    <div>
                      <dt>Session</dt>
                      <dd>{selectedSession.label}</dd>
                    </div>
                  ) : null}
                  <div>
                    <dt>Sphere size</dt>
                    <dd>{selectedNode.sizeMeaning}</dd>
                  </div>
                  <div>
                    <dt>Supplied connections</dt>
                    <dd>{selectedNode.connectionCount}</dd>
                  </div>
                </dl>
                {selectedRelationships.length > 0 ? (
                  <div className="graph-relationship-summary">
                    <h5>How this node connects</h5>
                    <ul>
                      {selectedRelationships.map((relationship) => (
                        <li key={relationship.id}>{relationship.text}</li>
                      ))}
                    </ul>
                  </div>
                ) : (
                  <p>No supplied relationships connect this node.</p>
                )}
                {selectedNode.sessionId ? (
                  <Link
                    className="text-link"
                    to={`/sessions/${selectedNode.sessionId}${
                      selectedNode.eventId
                        ? `#event-${selectedNode.eventId}`
                        : ""
                    }`}
                  >
                    {selectedNode.eventId
                      ? "Open event in session timeline"
                      : "Open session timeline"}
                  </Link>
                ) : null}
              </>
            ) : (
              <p>
                Choose a labeled node or select a sphere. Its supplied
                first-hop connections will brighten while unrelated content
                dims.
              </p>
            )}
          </div>

          <div className="graph-legend-section">
            <h4>Sphere meaning</h4>
            <ul className="graph-legend" aria-label="Graph node role legend">
              <li>
                <span className="legend-sphere legend-session" aria-hidden="true" />
                Session · largest anchor with a double halo
              </li>
              <li>
                <span className="legend-sphere legend-event" aria-hidden="true" />
                Event · filled sphere sized by importance
              </li>
              <li>
                <span className="legend-sphere legend-entity" aria-hidden="true" />
                Entity · wireframe sphere sized by supplied connections
              </li>
              <li>
                <span className="legend-sphere legend-topic" aria-hidden="true" />
                Topic · translucent sphere sized by supplied connections
              </li>
            </ul>
          </div>

          <div className="graph-legend-section">
            <h4>Entertainment domains</h4>
            <ul className="graph-legend" aria-label="Entertainment domain legend">
              {model.domains.map((domain) => (
                <li key={domain.key}>
                  <span
                    className="legend-domain"
                    style={{ backgroundColor: `#${domain.color.toString(16).padStart(6, "0")}` }}
                    aria-hidden="true"
                  />
                  {domain.label} · {domain.sessionCount} {domain.sessionCount === 1 ? "session" : "sessions"}
                </li>
              ))}
              {hasCrossDomainNodes ? (
                <li>
                  <span className="legend-domain legend-cross-domain" aria-hidden="true" />
                  Pearl · connects multiple entertainment domains
                </li>
              ) : null}
            </ul>
          </div>

          <div className="graph-legend-section">
            <h4>Supplied relationships</h4>
            <ul className="graph-legend graph-edge-legend" aria-label="Graph relationship legend">
              <li><span className="legend-line legend-line--session" aria-hidden="true" />Belongs to the same session</li>
              <li><span className="legend-line legend-line--temporal" aria-hidden="true" />Next event in time</li>
              <li><span className="legend-line legend-line--entity" aria-hidden="true" />Mentions this entity</li>
              <li><span className="legend-line legend-line--topic" aria-hidden="true" />Tagged with this topic</li>
              <li><span className="legend-line legend-line--semantic" aria-hidden="true" />Backend-supplied semantic similarity, when available</li>
            </ul>
          </div>
        </aside>
      </div>

      <p className="graph-status" role="status" aria-live="polite">
        {selectedNode
          ? `${selectedNode.label} selected with ${selectedNode.connectionCount} supplied ${selectedNode.connectionCount === 1 ? "connection" : "connections"}.`
          : reducedMotion
            ? "Reduced motion is active. Camera easing is disabled."
            : `${model.nodes.length} spheres and ${model.edges.length} supplied relationships are ready.`}
        {model.droppedDanglingEdgeIds.length > 0
          ? ` ${model.droppedDanglingEdgeIds.length} invalid dangling relationship${model.droppedDanglingEdgeIds.length === 1 ? " was" : "s were"} omitted.`
          : ""}
      </p>
      <p className="graph-readable-handoff">
        Prefer text? Use the labeled node selector and relationship summary.
        Session pages also provide complete readable relationship lists.
      </p>
    </section>
  );
}

function usePrefersReducedMotion(): boolean {
  const [reducedMotion, setReducedMotion] = useState(() =>
    typeof window.matchMedia === "function"
      ? window.matchMedia("(prefers-reduced-motion: reduce)").matches
      : false,
  );

  useEffect(() => {
    if (typeof window.matchMedia !== "function") return;
    const query = window.matchMedia("(prefers-reduced-motion: reduce)");
    const update = () => setReducedMotion(query.matches);
    query.addEventListener("change", update);
    return () => query.removeEventListener("change", update);
  }, []);

  return reducedMotion;
}

function summarizeGraph(model: GraphSceneModel): string {
  const sessions = model.nodes.filter((node) => node.type === "session").length;
  const events = model.nodes.filter((node) => node.type === "event").length;
  const entities = model.nodes.filter((node) => node.type === "entity").length;
  const topics = model.nodes.filter((node) => node.type === "topic").length;
  const domainNames = model.domains.map((domain) => domain.label);
  return `${sessions} ${sessions === 1 ? "session" : "sessions"} and ${events} significant ${events === 1 ? "moment" : "moments"} across ${joinWithAnd(domainNames)}. ${entities} ${entities === 1 ? "entity" : "entities"} and ${topics} ${topics === 1 ? "topic" : "topics"} connect the supplied history.`;
}

function joinWithAnd(values: string[]): string {
  if (values.length === 0) return "no classified entertainment domains";
  if (values.length === 1) return values[0]!;
  if (values.length === 2) return `${values[0]} and ${values[1]}`;
  return `${values.slice(0, -1).join(", ")}, and ${values.at(-1)}`;
}

function groupNodesByDomain(
  nodes: PositionedGraphNode[],
): Array<[string, PositionedGraphNode[]]> {
  const groups = new Map<string, PositionedGraphNode[]>();
  for (const node of nodes) {
    const label = node.isCrossDomainBridge
      ? "Cross-domain bridges"
      : node.domainLabel;
    const group = groups.get(label) ?? [];
    group.push(node);
    groups.set(label, group);
  }
  return [...groups.entries()].sort(([left], [right]) =>
    left.localeCompare(right),
  );
}

function describeRelationships(
  selectedNode: PositionedGraphNode,
  model: GraphSceneModel,
): Array<{ id: string; text: string }> {
  const nodeById = new Map(model.nodes.map((node) => [node.id, node]));
  return model.edges
    .filter(
      (edge) =>
        edge.source === selectedNode.id || edge.target === selectedNode.id,
    )
    .map((edge) => {
      const selectedIsSource = edge.source === selectedNode.id;
      const other = nodeById.get(
        selectedIsSource ? edge.target : edge.source,
      );
      const otherLabel = other?.label ?? "an unavailable node";
      return {
        id: edge.id,
        text: relationshipText(edge.type, selectedIsSource, otherLabel),
      };
    });
}

function relationshipText(
  type: GraphEdge["type"],
  selectedIsSource: boolean,
  otherLabel: string,
): string {
  switch (type) {
    case "same_session":
      return selectedIsSource
        ? `Contains the event “${otherLabel}”.`
        : `Belongs to the session “${otherLabel}”.`;
    case "temporal_relation":
      return selectedIsSource
        ? `Is followed by “${otherLabel}”.`
        : `Follows “${otherLabel}”.`;
    case "shared_entity":
      return selectedIsSource
        ? `Mentions the entity “${otherLabel}”.`
        : `Is mentioned in the event “${otherLabel}”.`;
    case "shared_topic":
      return selectedIsSource
        ? `Is tagged with the topic “${otherLabel}”.`
        : `Tags the event “${otherLabel}”.`;
    case "semantic_similarity":
      return `Has a backend-supplied semantic relationship with “${otherLabel}”.`;
  }
}
