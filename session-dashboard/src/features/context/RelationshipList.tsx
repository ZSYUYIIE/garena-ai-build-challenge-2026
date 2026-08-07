import type { GraphEdge, GraphNode } from "../../api/contracts";
import { formatPercent, humanizeEventType } from "../../lib/format";

export function RelationshipList({
  nodes,
  edges,
}: {
  nodes: GraphNode[];
  edges: GraphEdge[];
}) {
  const nodeLabels = new Map(nodes.map((node) => [node.id, node.label]));

  return (
    <div className="relationship-layout">
      <section className="relationship-panel" aria-labelledby="context-nodes-heading">
        <div className="panel-heading">
          <h2 id="context-nodes-heading">People, topics, sessions, and moments</h2>
          <span>{nodes.length} items</span>
        </div>
        <ul className="relationship-list">
          {nodes.map((node) => (
            <li key={node.id}>
              <span className="relationship-type">{humanizeEventType(node.type)}</span>
              <strong>{node.label}</strong>
              {typeof node.importance === "number" ? (
                <span>{formatPercent(node.importance)} importance</span>
              ) : null}
            </li>
          ))}
        </ul>
      </section>

      <section className="relationship-panel" aria-labelledby="context-edges-heading">
        <div className="panel-heading">
          <h2 id="context-edges-heading">Relationships</h2>
          <span>{edges.length} connections</span>
        </div>
        <ul className="relationship-list relationship-edges">
          {edges.map((edge) => (
            <li key={edge.id}>
              <span>
                <strong>{nodeLabels.get(edge.source) ?? edge.source}</strong>
                {" and "}
                <strong>{nodeLabels.get(edge.target) ?? edge.target}</strong>
              </span>
              <span>
                {humanizeEventType(edge.type)} · {formatPercent(edge.weight)} weight
              </span>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
