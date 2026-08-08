export type TimelineEvent = {
  id: string;
  timestamp: string;
  description: string;
};

type EventTimelineSectionProps = {
  events: TimelineEvent[];
};

export function EventTimelineSection({ events }: EventTimelineSectionProps) {
  return (
    <section className="flex min-h-0 flex-1 flex-col">
      <h3 className="mb-1.5 shrink-0">Timeline</h3>
      {events.length > 0 ? (
        <EventTimelineList events={events} />
      ) : (
        <p className="text-sm text-muted-foreground">
          Events will appear here as the video plays.
        </p>
      )}
    </section>
  );
}

function EventTimelineList({ events }: { events: TimelineEvent[] }) {
  return (
    <div className="relative min-h-0 flex-1 overflow-y-auto pl-4 pr-1">
      <div className="absolute left-[7px] top-1 bottom-1 w-px bg-border" />
      {events.map((event, index) => (
        <div key={event.id} className="relative mb-2.5 last:mb-0">
          <span
            className={`absolute -left-4 top-1 h-1.5 w-1.5 rounded-full ${
              index === 0 ? "bg-narrating" : "bg-border"
            }`}
          />
          <div className="font-mono text-[11px] text-muted-foreground">
            {event.timestamp}
          </div>
          <div
            className={`text-sm ${
              index === 0 ? "text-foreground" : "text-muted-foreground"
            }`}
          >
            {event.description}
          </div>
        </div>
      ))}
    </div>
  );
}
