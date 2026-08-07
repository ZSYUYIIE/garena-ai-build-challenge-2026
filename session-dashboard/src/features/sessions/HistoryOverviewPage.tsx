import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";

import { errorMessage } from "../../api/apiError";
import { historyClient } from "../../api/historyClient";
import { historyQueryKeys } from "../../api/historyQueries";
import { DemoDataBanner } from "../../components/DemoDataBanner";
import {
  buttonVariants,
  Label,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../../components/StreamSenseUi";
import {
  EmptyState,
  ErrorState,
  LoadingState,
} from "../../components/AsyncState";
import { MetricCard } from "../../components/MetricCard";
import { PaginationControls } from "../../components/PaginationControls";
import { ContextGraphPanel } from "../context/ContextGraphPanel";
import { formatDuration } from "../../lib/format";
import { SessionCard } from "./SessionCard";

export function HistoryOverviewPage() {
  const [cursor, setCursor] = useState<string | null>(null);
  const [graphDomain, setGraphDomain] = useState("");
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
  const domains = [...new Set(sessions.map((session) => session.domain))].sort(
    (left, right) => left.localeCompare(right),
  );

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
      <section className="memory-hero" aria-labelledby="memory-heading">
        <header className="memory-hero-copy">
          <div>
            <p className="eyebrow">Live moments become connected memory</p>
            <h1 id="memory-heading" data-route-heading tabIndex={-1}>
              Your streams, remembered.
            </h1>
            <p className="lede">
              StreamSense turns important moments from the Chrome extension
              into a searchable constellation of sessions, events, people, and
              recurring ideas.
            </p>
          </div>
          <div className="hero-actions">
            <Link
              className={buttonVariants({ variant: "default", size: "lg" })}
              to="/search"
            >
              Search past moments
            </Link>
            <a
              className={buttonVariants({ variant: "outline", size: "lg" })}
              href="#recent-sessions"
            >
              Skip to sessions
            </a>
          </div>
        </header>

        <DemoDataBanner dataOrigin={sessionsQuery.data?.meta.dataOrigin ?? null} />

        <div className="memory-map-shell" id="memory-map">
          <div className="memory-map-heading">
            <div>
              <p className="eyebrow">Memory constellation</p>
              <h2>See how moments connect</h2>
            </div>
            <Select
              className="field memory-domain-filter"
              selectedKey={graphDomain || "all"}
              onSelectionChange={(key) =>
                setGraphDomain(key === null || key === "all" ? "" : String(key))
              }
            >
              <Label>Entertainment domain</Label>
              <SelectTrigger id="memory-domain">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem id="all">All domains</SelectItem>
                {domains.map((domain) => (
                  <SelectItem key={domain} id={domain}>
                    {domain}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <ContextGraphPanel
            options={{
              domain: graphDomain || undefined,
              limit: 80,
            }}
          />
        </div>
      </section>

      {sessionsQuery.isPending ? (
        <section className="page-section" aria-labelledby="history-loading-heading">
          <h2 id="history-loading-heading" className="visually-hidden">
            Session history
          </h2>
          <LoadingState label="Loading previous sessions…" />
        </section>
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
                <h2 id="overview-heading">This page of memory</h2>
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
              <MetricCard label="Domains" value={String(domains.length)} />
            </dl>
          </section>

          <section id="recent-sessions" aria-labelledby="sessions-heading">
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
