import { useQuery } from "@tanstack/react-query";

import {
  errorMessage,
  isUnavailableError,
} from "../../api/apiError";
import {
  historyClient,
  type ContextGraphOptions,
} from "../../api/historyClient";
import { historyQueryKeys } from "../../api/historyQueries";
import {
  EmptyState,
  ErrorState,
  LoadingState,
  UnavailableState,
} from "../../components/AsyncState";
import { RelationshipList } from "./RelationshipList";
import { ThreeGraphExplorer } from "./ThreeGraphExplorer";

type ContextGraphPanelProps = {
  options?: ContextGraphOptions;
  refreshIntervalMs?: number;
  showRelationships?: boolean;
};

export function ContextGraphPanel({
  options = { limit: 80 },
  refreshIntervalMs,
  showRelationships = false,
}: ContextGraphPanelProps) {
  const graphQuery = useQuery({
    queryKey: historyQueryKeys.graph(options),
    queryFn: ({ signal }) => historyClient.getContextGraph(options, signal),
    refetchInterval: refreshIntervalMs ?? false,
    retry: false,
  });

  if (graphQuery.isPending) {
    return <LoadingState label="Building the memory constellation…" />;
  }

  if (graphQuery.isError && isUnavailableError(graphQuery.error)) {
    return (
      <UnavailableState title="The relationship map is not available yet">
        <p>
          Session summaries and timelines remain available while the bounded
          context service is offline.
        </p>
      </UnavailableState>
    );
  }

  if (graphQuery.isError) {
    return (
      <ErrorState
        title="The memory constellation could not be loaded"
        message={errorMessage(graphQuery.error)}
        onRetry={() => void graphQuery.refetch()}
      />
    );
  }

  if (graphQuery.data.nodes.length === 0) {
    return (
      <EmptyState title="No connected moments are available">
        <p>Choose another entertainment domain or saved session.</p>
      </EmptyState>
    );
  }

  return (
    <div className="context-explorer-stack">
      {showRelationships ? (
        <RelationshipList
          nodes={graphQuery.data.nodes}
          edges={graphQuery.data.edges}
        />
      ) : null}
      <ThreeGraphExplorer
        nodes={graphQuery.data.nodes}
        edges={graphQuery.data.edges}
      />
    </div>
  );
}
