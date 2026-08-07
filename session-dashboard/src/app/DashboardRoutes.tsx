import { Route, Routes } from "react-router-dom";

import { ContextEntryPage } from "../features/context/ContextEntryPage";
import { SearchPage } from "../features/search/SearchPage";
import { HistoryOverviewPage } from "../features/sessions/HistoryOverviewPage";
import { SessionDetailPage } from "../features/sessions/SessionDetailPage";
import { AppShell } from "./AppShell";

export function DashboardRoutes() {
  return (
    <Routes>
      <Route element={<AppShell />}>
        <Route index element={<HistoryOverviewPage />} />
        <Route path="sessions/:sessionId" element={<SessionDetailPage />} />
        <Route path="search" element={<SearchPage />} />
        <Route path="explore" element={<ContextEntryPage />} />
        <Route path="*" element={<NotFoundPage />} />
      </Route>
    </Routes>
  );
}

function NotFoundPage() {
  return (
    <section className="page-section narrow-section">
      <p className="eyebrow">Not found</p>
      <h1 data-route-heading tabIndex={-1}>
        This history page does not exist
      </h1>
      <p className="lede">
        The link may be out of date. Return to StreamSense History to choose a
        saved session.
      </p>
      <a className="button button-primary" href="/dashboard/">
        Return to history
      </a>
    </section>
  );
}
