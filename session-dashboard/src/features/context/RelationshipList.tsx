import type { ReactNode } from "react";

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
              <span>{relationshipSentence(edge, nodeLabels)}</span>
              <span>{relationshipMeasure(edge)}</span>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}

function relationshipSentence(
  edge: GraphEdge,
  labels: Map<string, string>,
): ReactNode {
  const source = labels.get(edge.source) ?? edge.source;
  const target = labels.get(edge.target) ?? edge.target;

  switch (edge.type) {
    case "same_session":
      return <><strong>{target}</strong> belongs to <strong>{source}</strong>.</>;
    case "temporal_relation":
      return <><strong>{source}</strong> is followed by <strong>{target}</strong>.</>;
    case "shared_entity":
      return <><strong>{source}</strong> mentions <strong>{target}</strong>.</>;
    case "shared_topic":
      return <><strong>{source}</strong> is tagged with <strong>{target}</strong>.</>;
    case "semantic_similarity":
      return <><strong>{source}</strong> is semantically related to <strong>{target}</strong>.</>;
  }
}

function relationshipMeasure(edge: GraphEdge): string {
  switch (edge.type) {
    case "temporal_relation":
      return `${formatPercent(edge.weight)} time-proximity score — not confidence`;
    case "semantic_similarity":
      return `${formatPercent(edge.weight)} backend-supplied similarity`;
    case "same_session":
    case "shared_entity":
    case "shared_topic":
      return "Recorded structural relationship";
  }
}
