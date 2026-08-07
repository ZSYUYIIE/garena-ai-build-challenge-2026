import { useState, type FormEvent } from "react";
import { useQuery } from "@tanstack/react-query";
import { useSearchParams } from "react-router-dom";

import {
  errorMessage,
  isUnavailableError,
} from "../../api/apiError";
import { historyClient, type ContextGraphOptions } from "../../api/historyClient";
import { historyQueryKeys } from "../../api/historyQueries";
import {
  EmptyState,
  ErrorState,
  LoadingState,
  UnavailableState,
} from "../../components/AsyncState";
import { DemoDataBanner } from "../../components/DemoDataBanner";
import { RelationshipList } from "./RelationshipList";

export function ContextEntryPage() {
  const [searchParameters] = useSearchParams();
  const initialSessionId = searchParameters.get("sessionId") ?? "";
  const [sessionId, setSessionId] = useState(initialSessionId);
  const [query, setQuery] = useState("");
  const [domain, setDomain] = useState("");
  const [filters, setFilters] = useState<ContextGraphOptions>({
    sessionId: initialSessionId || undefined,
    limit: 80,
  });

  const graphQuery = useQuery({
    queryKey: historyQueryKeys.graph(filters),
    queryFn: ({ signal }) => historyClient.getContextGraph(filters, signal),
    retry: false,
  });

  const submitFilters = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setFilters({
      sessionId: sessionId.trim() || undefined,
      query: query.trim() || undefined,
      domain: domain.trim() || undefined,
      limit: 80,
    });
  };

  return (
    <div className="page-stack">
      <header className="page-header">
        <p className="eyebrow">Relationship explorer</p>
        <h1 data-route-heading tabIndex={-1}>
          Explore session context
        </h1>
        <p className="lede">
          Inspect how sessions, significant moments, entities, and topics are
          connected. This readable list remains the primary representation even
          when an optional visual graph is added later.
        </p>
      </header>

      <form className="filter-panel" onSubmit={submitFilters}>
        <div className="field">
          <label htmlFor="context-query">Topic or idea</label>
          <input
            id="context-query"
            type="search"
            maxLength={500}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Momentum shift"
          />
        </div>
        <div className="field">
          <label htmlFor="context-domain">Domain</label>
          <input
            id="context-domain"
            type="text"
            maxLength={80}
            value={domain}
            onChange={(event) => setDomain(event.target.value)}
            placeholder="Football"
          />
        </div>
        <div className="field field-grow">
          <label htmlFor="context-session">Session ID</label>
          <input
            id="context-session"
            type="text"
            value={sessionId}
            onChange={(event) => setSessionId(event.target.value)}
            placeholder="Optional session UUID"
          />
        </div>
        <button className="button button-primary" type="submit">
          Update relationships
        </button>
      </form>

      <DemoDataBanner dataOrigin={graphQuery.data?.meta.dataOrigin ?? null} />

      {graphQuery.isPending ? (
        <LoadingState label="Loading relationship data…" />
      ) : graphQuery.isError && isUnavailableError(graphQuery.error) ? (
        <UnavailableState title="Context exploration is not available yet">
          <p>
            Session lists, summaries, and timelines remain available. This
            surface will work when the bounded context-graph endpoint is active.
          </p>
        </UnavailableState>
      ) : graphQuery.isError ? (
        <ErrorState
          title="Relationships could not be loaded"
          message={errorMessage(graphQuery.error)}
          onRetry={() => void graphQuery.refetch()}
        />
      ) : graphQuery.data.nodes.length === 0 ? (
        <EmptyState title="No relationships match these filters">
          <p>Try removing a filter or explore another saved session.</p>
        </EmptyState>
      ) : (
        <RelationshipList
          nodes={graphQuery.data.nodes}
          edges={graphQuery.data.edges}
        />
      )}
    </div>
  );
}
