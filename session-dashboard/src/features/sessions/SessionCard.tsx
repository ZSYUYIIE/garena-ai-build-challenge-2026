import { Link } from "react-router-dom";

import type { Session } from "../../api/contracts";
import { TagList } from "../../components/TagList";
import {
  formatDateTime,
  formatDomain,
  formatDuration,
  isDisplayableDomain,
} from "../../lib/format";

export function SessionCard({ session }: { session: Session }) {
  const domain = isDisplayableDomain(session.domain)
    ? formatDomain(session.domain)
    : null;

  return (
    <article className="session-card">
      <div className="session-card-heading">
        <div>
          {domain ? <p className="domain-label">{domain}</p> : null}
          <h3>
            <Link to={`/sessions/${session.sessionId}`}>{session.title}</Link>
          </h3>
        </div>
        <span className="moment-count">
          {session.importantEventCount} significant {session.importantEventCount === 1 ? "moment" : "moments"}
        </span>
      </div>
      <dl className="inline-metadata">
        <div>
          <dt>Watched</dt>
          <dd>{formatDateTime(session.startedAt)}</dd>
        </div>
        <div>
          <dt>Duration</dt>
          <dd>{formatDuration(session.durationSeconds)}</dd>
        </div>
        <div>
          <dt>Source</dt>
          <dd>{session.sourceLabel}</dd>
        </div>
      </dl>
      <p className="session-summary">
        {session.summary || "A summary has not been generated for this session yet."}
      </p>
      <div className="session-card-tags">
        <TagList label="Top entities" values={session.entities} limit={4} />
        <TagList label="Top topics" values={session.topics} limit={4} />
      </div>
    </article>
  );
}
