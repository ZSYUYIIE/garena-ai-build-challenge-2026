import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";

import { errorMessage } from "../../api/apiError";
import { historyClient } from "../../api/historyClient";
import { historyQueryKeys } from "../../api/historyQueries";
import { DemoDataBanner } from "../../components/DemoDataBanner";
import {
  EmptyState,
  ErrorState,
  LoadingState,
} from "../../components/AsyncState";
import { MetricCard } from "../../components/MetricCard";
import { PaginationControls } from "../../components/PaginationControls";
import { formatDuration } from "../../lib/format";
import { SessionCard } from "./SessionCard";

export function HistoryOverviewPage() {
  const [cursor, setCursor] = useState<string | null>(null);
  const [previousCursors, setPreviousCursors] = useState<Array<string | null>>([]);
  const sessionsQuery = useQuery({
    queryKey: historyQueryKeys.sessions(cursor),
    queryFn: ({ signal }) =>
      historyClient.listSessions(
        { limit: 12, cursor: cursor ?? undefined },
        signal,
      ),
  });

  const sessions = sessionsQuery.data?.sessions ?? [];
  const totalEvents = sessions.reduce((total, session) => total + session.eventCount, 0);
  const totalDuration = sessions.reduce(
    (total, session) => total + session.durationSeconds,
    0,
  );
  const domains = new Set(sessions.map((session) => session.domain));

  const goForward = () => {
    const nextCursor = sessionsQuery.data?.nextCursor;
    if (!nextCursor) return;
    setPreviousCursors((entries) => [...entries, cursor]);
    setCursor(nextCursor);
  };

  const goBack = () => {
    setPreviousCursors((entries) => {
      const nextEntries = entries.slice(0, -1);
      setCursor(entries.at(-1) ?? null);
      return nextEntries;
    });
  };

  return (
    <div className="page-stack">
      <section className="hero-section">
        <div>
          <p className="eyebrow">Previous viewing sessions</p>
          <h1 data-route-heading tabIndex={-1}>
            StreamSense History
          </h1>
          <p className="lede">
            Review what happened, find meaningful moments, and understand the
            people and topics that shaped each stream.
          </p>
        </div>
        <Link className="button button-primary" to="/search">
          Search past moments
        </Link>
      </section>

      <DemoDataBanner dataOrigin={sessionsQuery.data?.meta.dataOrigin ?? null} />

      {sessionsQuery.isPending ? (
        <LoadingState label="Loading previous sessions…" />
      ) : sessionsQuery.isError ? (
        <ErrorState
          message={errorMessage(sessionsQuery.error)}
          onRetry={() => void sessionsQuery.refetch()}
        />
      ) : sessions.length === 0 ? (
        <EmptyState title="No session history yet">
          <p>
            Significant moments will appear here after StreamSense completes a
            viewing session. Demo history is loaded only through the explicit
            dashboard seed workflow.
          </p>
        </EmptyState>
      ) : (
        <>
          <section aria-labelledby="overview-heading">
            <div className="section-heading">
              <div>
                <p className="eyebrow">At a glance</p>
                <h2 id="overview-heading">This page of history</h2>
              </div>
              <p>{sessions.length} sessions shown</p>
            </div>
            <dl className="metric-grid">
              <MetricCard label="Sessions" value={String(sessions.length)} />
              <MetricCard label="Recorded moments" value={String(totalEvents)} />
              <MetricCard
                label="Viewing time"
                value={formatDuration(totalDuration)}
              />
              <MetricCard label="Domains" value={String(domains.size)} />
            </dl>
          </section>

          <section aria-labelledby="sessions-heading">
            <div className="section-heading">
              <div>
                <p className="eyebrow">Most recent first</p>
                <h2 id="sessions-heading">Recent sessions</h2>
              </div>
            </div>
            <div className="session-list">
              {sessions.map((session) => (
                <SessionCard key={session.sessionId} session={session} />
              ))}
            </div>
            <PaginationControls
              label="Session history pages"
              canGoBack={previousCursors.length > 0}
              canGoForward={Boolean(sessionsQuery.data.nextCursor)}
              onBack={goBack}
              onForward={goForward}
            />
          </section>
        </>
      )}
    </div>
  );
}
