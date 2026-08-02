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
    <div>
      <h3 className="mb-2.5">Timeline</h3>
      {events.length > 0 ? (
        <EventTimelineList events={events} />
      ) : (
        <p className="text-sm text-muted-foreground">
          Events will appear here as the video plays.
        </p>
      )}
    </div>
  );
}

function EventTimelineList({ events }: { events: TimelineEvent[] }) {
  return (
    <div className="relative pl-4">
      <div className="absolute left-[7px] top-1 bottom-1 w-px bg-border" />
      {events.map((event, index) => (
        <div key={event.id} className="relative mb-3.5 last:mb-0">
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