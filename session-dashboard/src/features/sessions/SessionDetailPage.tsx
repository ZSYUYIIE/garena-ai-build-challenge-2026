import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link, useLocation, useParams } from "react-router-dom";

import { errorMessage } from "../../api/apiError";
import { historyClient } from "../../api/historyClient";
import { historyQueryKeys } from "../../api/historyQueries";
import {
  EmptyState,
  ErrorState,
  LoadingState,
} from "../../components/AsyncState";
import { DemoDataBanner } from "../../components/DemoDataBanner";
import { PaginationControls } from "../../components/PaginationControls";
import { buttonVariants } from "../../components/StreamSenseUi";
import { TagList } from "../../components/TagList";
import { ContextGraphPanel } from "../context/ContextGraphPanel";
import {
  formatDateTime,
  formatDomain,
  formatDuration,
  isDisplayableDomain,
} from "../../lib/format";
import { EventTimeline } from "./EventTimeline";

export function SessionDetailPage() {
  const { sessionId = "" } = useParams();
  const location = useLocation();
  const openedFromExtension =
    new URLSearchParams(location.search).get("source") === "extension";
  const targetEventId = eventIdFromHash(location.hash);
  const paginationScope = `${sessionId}:${targetEventId ?? "all"}`;
  const [eventPagination, setEventPagination] = useState<{
    scope: string;
    cursor: string | null;
    previous: Array<string | null>;
  }>({ scope: paginationScope, cursor: null, previous: [] });
  const paginationIsCurrent = eventPagination.scope === paginationScope;
  const eventCursor = paginationIsCurrent ? eventPagination.cursor : null;
  const previousEventCursors = paginationIsCurrent ? eventPagination.previous : [];

  useEffect(() => {
    if (!paginationIsCurrent) {
      setEventPagination({ scope: paginationScope, cursor: null, previous: [] });
    }
  }, [paginationIsCurrent, paginationScope]);

  const sessionQuery = useQuery({
    queryKey: historyQueryKeys.session(sessionId),
    queryFn: ({ signal }) => historyClient.getSession(sessionId, signal),
    enabled: Boolean(sessionId),
    refetchInterval: openedFromExtension ? 2_000 : false,
  });
  const eventsQuery = useQuery({
    queryKey: historyQueryKeys.events(sessionId, eventCursor, targetEventId),
    queryFn: ({ signal }) =>
      historyClient.listSessionEvents(
        sessionId,
        {
          limit: 50,
          cursor: targetEventId ? undefined : eventCursor ?? undefined,
          eventId: targetEventId ?? undefined,
        },
        signal,
      ),
    enabled: Boolean(sessionId),
    refetchInterval: openedFromExtension ? 2_000 : false,
  });

  useEffect(() => {
    if (!targetEventId || !eventsQuery.data?.events.some((event) => event.id === targetEventId)) {
      return;
    }
    const frame = window.requestAnimationFrame(() => {
      const target = document.querySelector<HTMLElement>(
        `#event-${targetEventId} article`,
      );
      target?.scrollIntoView?.({ block: "center" });
      target?.focus();
    });
    return () => window.cancelAnimationFrame(frame);
  }, [eventsQuery.data, targetEventId]);

  useEffect(() => {
    if (location.hash !== "#relationships" || !sessionQuery.data) return;
    const frame = window.requestAnimationFrame(() => {
      document.getElementById("relationships")?.scrollIntoView?.({ block: "start" });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [location.hash, sessionQuery.data]);

  if (sessionQuery.isPending) {
    return (
      <section className="page-section">
        <h1 data-route-heading tabIndex={-1} className="visually-hidden">
          Session history
        </h1>
        <LoadingState label="Loading session details…" />
      </section>
    );
  }

  if (sessionQuery.isError) {
    return (
      <section className="page-section narrow-section">
        <p className="eyebrow">Session history</p>
        <h1 data-route-heading tabIndex={-1}>
          This session could not be opened
        </h1>
        <ErrorState
          message={errorMessage(sessionQuery.error)}
          onRetry={() => void sessionQuery.refetch()}
        />
        <Link className="text-link" to="/">
          Return to all sessions
        </Link>
      </section>
    );
  }

  const session = sessionQuery.data.session;
  const domain = isDisplayableDomain(session.domain)
    ? formatDomain(session.domain)
    : null;
  const dataOrigin =
    sessionQuery.data.meta.dataOrigin ?? eventsQuery.data?.meta.dataOrigin ?? null;

  const goForward = () => {
    const nextCursor = eventsQuery.data?.nextCursor;
    if (!nextCursor) return;
    setEventPagination({
      scope: paginationScope,
      cursor: nextCursor,
      previous: [...previousEventCursors, eventCursor],
    });
  };

  const goBack = () => {
    setEventPagination({
      scope: paginationScope,
      cursor: previousEventCursors.at(-1) ?? null,
      previous: previousEventCursors.slice(0, -1),
    });
  };

  return (
    <div className="page-stack">
      <nav aria-label="Breadcrumb">
        <ol className="breadcrumbs">
          <li>
            <Link to="/">Sessions</Link>
          </li>
          <li aria-current="page">{session.title}</li>
        </ol>
      </nav>

      <DemoDataBanner dataOrigin={dataOrigin} />

      <header className="detail-hero">
        <div>
          {domain ? <p className="eyebrow">{domain}</p> : null}
          <h1 data-route-heading tabIndex={-1}>
            {session.title}
          </h1>
          <p className="lede">{session.sourceLabel}</p>
        </div>
        <a
          className={buttonVariants({ variant: "outline", size: "lg" })}
          href="#relationships"
        >
          Jump to relationships
        </a>
      </header>

      <dl className="detail-metadata">
        <div>
          <dt>Started</dt>
          <dd>{formatDateTime(session.startedAt)}</dd>
        </div>
        <div>
          <dt>Duration</dt>
          <dd>{formatDuration(session.durationSeconds)}</dd>
        </div>
        <div>
          <dt>Recorded moments</dt>
          <dd>{session.eventCount}</dd>
        </div>
        <div>
          <dt>Significant moments</dt>
          <dd>{session.importantEventCount}</dd>
        </div>
      </dl>

      <section className="summary-panel" aria-labelledby="summary-heading">
        <div>
          <p className="eyebrow">Session summary</p>
          <h2 id="summary-heading">What happened</h2>
          <p>
            {session.summary ||
              "A generated summary is unavailable. The timestamped events below remain available."}
          </p>
        </div>
        <div className="summary-taxonomy">
          <TagList label="Entities" values={session.entities} />
          <TagList label="Topics" values={session.topics} />
        </div>
      </section>

      <section
        id="relationships"
        className="session-context-section"
        aria-labelledby="relationships-heading"
      >
        <div className="section-heading">
          <div>
            <p className="eyebrow">Session relationships</p>
            <h2 id="relationships-heading">How this session connects</h2>
          </div>
        </div>
        <p className="section-introduction">
          Follow this session’s moments in order and inspect the people and
          topics that connect them. The readable lists contain the same
          relationships as the optional 3D view.
        </p>
        <ContextGraphPanel
          options={{ sessionId: session.sessionId, limit: 100 }}
          refreshIntervalMs={openedFromExtension ? 2_000 : undefined}
          showRelationships
        />
      </section>

      <section aria-labelledby="timeline-heading">
        <div className="section-heading">
          <div>
            <p className="eyebrow">Chronological record</p>
            <h2 id="timeline-heading">Significant events</h2>
          </div>
          {targetEventId ? (
            <Link
              className="text-link"
              to={`/sessions/${sessionId}${
                openedFromExtension ? "?source=extension" : ""
              }`}
            >
              Show the full timeline
            </Link>
          ) : null}
        </div>
        {eventsQuery.isPending ? (
          <LoadingState label="Loading significant events…" />
        ) : eventsQuery.isError ? (
          <ErrorState
            title="Events could not be loaded"
            message={errorMessage(eventsQuery.error)}
            onRetry={() => void eventsQuery.refetch()}
          />
        ) : eventsQuery.data.events.length === 0 ? (
          <EmptyState title="No significant events were recorded">
            <p>This session is saved, but its event timeline is empty.</p>
          </EmptyState>
        ) : (
          <>
            <EventTimeline events={eventsQuery.data.events} />
            <PaginationControls
              label="Session event pages"
              canGoBack={previousEventCursors.length > 0}
              canGoForward={Boolean(eventsQuery.data.nextCursor)}
              onBack={goBack}
              onForward={goForward}
            />
          </>
        )}
      </section>
    </div>
  );
}

function eventIdFromHash(hash: string): string | null {
  const match = /^#event-([0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})$/i.exec(hash);
  return match?.[1] ?? null;
}
