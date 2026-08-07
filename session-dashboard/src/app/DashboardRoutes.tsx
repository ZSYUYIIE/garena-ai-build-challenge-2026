import { Navigate, Route, Routes, useLocation } from "react-router-dom";

import { SearchPage } from "../features/search/SearchPage";
import { HistoryOverviewPage } from "../features/sessions/HistoryOverviewPage";
import { SessionDetailPage } from "../features/sessions/SessionDetailPage";
import { AppShell } from "./AppShell";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function DashboardRoutes() {
  return (
    <Routes>
      <Route element={<AppShell />}>
        <Route index element={<HistoryOverviewPage />} />
        <Route path="sessions/:sessionId" element={<SessionDetailPage />} />
        <Route path="search" element={<SearchPage />} />
        <Route path="explore" element={<LegacyExploreRedirect />} />
        <Route path="*" element={<NotFoundPage />} />
      </Route>
    </Routes>
  );
}

function LegacyExploreRedirect() {
  const location = useLocation();
  return <Navigate replace to={legacyExploreDestination(location.search)} />;
}

export function legacyExploreDestination(search: string): string {
  const parameters = new URLSearchParams(search);
  const sessionIds = parameters.getAll("sessionId");
  const sources = parameters.getAll("source");
  const sessionId = sessionIds.length === 1 ? sessionIds[0] : null;
  const fromExtension = sources.length === 1 && sources[0] === "extension";
  const handoffQuery = fromExtension ? "?source=extension" : "";

  if (sessionId && UUID_PATTERN.test(sessionId)) {
    return `/sessions/${sessionId}${handoffQuery}#relationships`;
  }

  return `/${handoffQuery}`;
}

function NotFoundPage() {
  return (
    <section className="page-section narrow-section">
      <p className="eyebrow">Not found</p>
      <h1 data-route-heading tabIndex={-1}>
        This StreamSense page does not exist
      </h1>
      <p className="lede">
        The link may be out of date. Return to StreamSense Memory to choose a
        saved session or relationship.
      </p>
      <a className="button button-primary" href="/dashboard/">
        Return to Memory
      </a>
    </section>
  );
}
