import {
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { Link } from "react-router-dom";

import type { GraphEdge, GraphNode } from "../../api/contracts";
import {
  formatElapsedTime,
  formatPercent,
  humanizeEventType,
} from "../../lib/format";
import { buildGraphSceneModel } from "./graphModel";
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
  const [hoveredNodeId, setHoveredNodeId] = useState<string | null>(null);
  const [paused, setPaused] = useState(reducedMotion);

  const selectedNode = model.nodes.find((node) => node.id === selectedNodeId) ?? null;
  const hoveredNode = model.nodes.find((node) => node.id === hoveredNodeId) ?? null;
  const selectedSession = selectedNode?.sessionId
    ? model.nodes.find(
        (node) =>
          node.type === "session" && node.sessionId === selectedNode.sessionId,
      ) ?? null
    : null;

  useEffect(() => {
    if (reducedMotion) setPaused(true);
  }, [reducedMotion]);

  useEffect(() => {
    if (selectedNodeId && !model.nodes.some((node) => node.id === selectedNodeId)) {
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
        onHover: setHoveredNodeId,
      });
      setRenderStatus("ready");
    } catch {
      controllerRef.current = null;
      setRenderStatus("unavailable");
      return;
    }

    controllerRef.current = controller;
    controller.selectNode(selectedNodeId);
    controller.setPaused(paused);
    return () => {
      controller.dispose();
      if (controllerRef.current === controller) controllerRef.current = null;
    };
  }, [model, reducedMotion, rendererFactory]);

  useEffect(() => {
    controllerRef.current?.setPaused(paused);
  }, [paused]);

  const selectNode = (nodeId: string | null) => {
    setSelectedNodeId(nodeId);
    controllerRef.current?.selectNode(nodeId);
  };

  const resetView = () => {
    setSelectedNodeId(null);
    setHoveredNodeId(null);
    controllerRef.current?.selectNode(null);
    controllerRef.current?.resetCamera();
  };

  if (model.nodes.length === 0) {
    return (
      <section className="graph-explorer" aria-labelledby="graph-explorer-heading">
        <div className="graph-explorer-heading">
          <div>
            <p className="eyebrow">Optional visual view</p>
            <h2 id="graph-explorer-heading">3D relationship map</h2>
          </div>
        </div>
        <p className="graph-empty">No graph nodes are available to visualize.</p>
      </section>
    );
  }

  return (
    <section className="graph-explorer" aria-labelledby="graph-explorer-heading">
      <div className="graph-explorer-heading">
        <div>
          <p className="eyebrow">Optional visual view</p>
          <h2 id="graph-explorer-heading">3D relationship map</h2>
          <p>
            Drag to orbit, scroll to zoom, or choose any node below. The map
            labels session anchors and key events; hover or select a shape to
            reveal its label. Readable relationship lists remain available
            after this map.
          </p>
        </div>
        <div className="graph-toolbar" aria-label="3D map controls">
          <button
            className="button graph-control-button"
            type="button"
            onClick={() => setPaused((current) => !current)}
            disabled={renderStatus === "unavailable" || reducedMotion}
          >
            {reducedMotion
              ? "Motion reduced"
              : paused
                ? "Resume motion"
                : "Pause motion"}
          </button>
          <button
            className="button graph-control-button"
            type="button"
            onClick={resetView}
            disabled={renderStatus === "unavailable"}
          >
            Reset view
          </button>
        </div>
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
            aria-label="Interactive 3D context graph showing supplied sessions, events, entities, topics, and their relationships. Use the labeled node selector for keyboard access."
          />
          {renderStatus === "unavailable" ? (
            <div className="graph-fallback" role="status">
              <strong>3D view unavailable</strong>
              <span>
                WebGL could not start in this browser. Use the node selector and
                readable relationship lists instead.
              </span>
            </div>
          ) : null}
        </div>

        <aside className="graph-details" aria-labelledby="graph-details-heading">
          <h3 id="graph-details-heading">Inspect a node</h3>
          <div className="field graph-node-selector">
            <label htmlFor="graph-node-select">Labeled graph node</label>
            <select
              id="graph-node-select"
              value={selectedNodeId ?? ""}
              onChange={(event) => selectNode(event.target.value || null)}
            >
              <option value="">Choose a node</option>
              {model.nodes.map((node) => (
                <option key={node.id} value={node.id}>
                  {humanizeEventType(node.type)}: {node.label}
                </option>
              ))}
            </select>
          </div>

          <div className="graph-selection" aria-live="polite">
            {selectedNode ? (
              <>
                <span className={`graph-detail-type graph-detail-type--${selectedNode.type}`}>
                  {humanizeEventType(selectedNode.type)} · {shapeLabel(selectedNode.shape)}
                </span>
                <h4>{selectedNode.label}</h4>
                <dl>
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
                    <dt>Connected edges</dt>
                    <dd>{countConnectedEdges(selectedNode.id, model.edges)}</dd>
                  </div>
                </dl>
                {selectedNode.sessionId ? (
                  <Link
                    className="text-link"
                    to={`/sessions/${selectedNode.sessionId}${
                      selectedNode.eventId ? `#event-${selectedNode.eventId}` : ""
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
                Choose a labeled node or select a shape in the map to inspect
                its type, importance, and session link.
              </p>
            )}
          </div>

          <ul className="graph-legend" aria-label="Graph node type legend">
            <li><span className="legend-shape legend-session" aria-hidden="true" />Session · sphere</li>
            <li><span className="legend-shape legend-event" aria-hidden="true" />Event · cube, sized by importance</li>
            <li><span className="legend-shape legend-entity" aria-hidden="true" />Entity · diamond</li>
            <li><span className="legend-shape legend-topic" aria-hidden="true" />Topic · ring</li>
          </ul>
        </aside>
      </div>

      <p className="graph-status" role="status" aria-live="polite">
        {reducedMotion
          ? "Reduced motion is active. The graph renders only on interaction."
          : paused
            ? "Graph motion is paused."
            : hoveredNode
              ? `Pointing at ${hoveredNode.label}, ${humanizeEventType(hoveredNode.type)}.`
              : `${model.nodes.length} nodes and ${model.edges.length} supplied relationships are ready.`}
        {model.droppedDanglingEdgeIds.length > 0
          ? ` ${model.droppedDanglingEdgeIds.length} invalid dangling relationship${model.droppedDanglingEdgeIds.length === 1 ? " was" : "s were"} omitted.`
          : ""}
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

function shapeLabel(shape: string): string {
  switch (shape) {
    case "sphere":
      return "sphere";
    case "box":
      return "cube";
    case "octahedron":
      return "diamond";
    case "torus":
      return "ring";
    default:
      return shape;
  }
}

function countConnectedEdges(
  nodeId: string,
  edges: Array<{ source: string; target: string }>,
): number {
  return edges.filter((edge) => edge.source === nodeId || edge.target === nodeId)
    .length;
}
