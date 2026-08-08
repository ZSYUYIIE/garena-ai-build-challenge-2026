import type { HistoryEvent } from "../../api/contracts";
import { TagList } from "../../components/TagList";
import {
  formatElapsedTime,
  formatPercent,
  humanizeEventType,
} from "../../lib/format";

export function EventTimeline({ events }: { events: HistoryEvent[] }) {
  const chronologicalEvents = [...events].sort(
    (left, right) => left.timestampSeconds - right.timestampSeconds,
  );

  return (
    <ol className="event-timeline">
      {chronologicalEvents.map((event) => (
        <li key={event.id} id={`event-${event.id}`}>
          <article
            className="timeline-event"
            aria-labelledby={`event-title-${event.id}`}
            tabIndex={-1}
          >
            <div className="timeline-marker" aria-hidden="true" />
            <div className="timeline-event-body">
              <div className="event-heading">
                <div>
                  <time
                    className="event-time"
                    dateTime={`PT${Math.floor(event.timestampSeconds)}S`}
                    aria-label={`${formatElapsedTime(event.timestampSeconds)} into the session`}
                  >
                    {event.timestamp}
                  </time>
                  <h3 id={`event-title-${event.id}`}>
                    {humanizeEventType(event.eventType)}
                  </h3>
                </div>
                <span className="importance-label">
                  {formatPercent(event.importance)} importance
                </span>
              </div>
              <p>{event.description}</p>
              <TagList label="Entities" values={event.entities} />
              {event.topicLabels ? (
                <TagList label="Topics" values={event.topicLabels} />
              ) : null}
              <dl className="score-list">
                <div>
                  <dt>Importance</dt>
                  <dd>
                    <meter
                      min="0"
                      max="1"
                      value={event.importance}
                      aria-label={`Importance ${formatPercent(event.importance)}`}
                    >
                      {formatPercent(event.importance)}
                    </meter>
                    <span>{formatPercent(event.importance)}</span>
                  </dd>
                </div>
                <div>
                  <dt>Confidence</dt>
                  <dd>
                    <meter
                      min="0"
                      max="1"
                      value={event.confidence}
                      aria-label={`Confidence ${formatPercent(event.confidence)}`}
                    >
                      {formatPercent(event.confidence)}
                    </meter>
                    <span>{formatPercent(event.confidence)}</span>
                  </dd>
                </div>
              </dl>
            </div>
          </article>
        </li>
      ))}
    </ol>
  );
}
