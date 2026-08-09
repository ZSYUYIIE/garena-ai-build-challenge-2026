import type { StreamEvent } from "./types.ts";

const MAX_TIMELINE_EVENTS = 100;

export type TimelineEventAdmission = {
  events: StreamEvent[];
  inserted: StreamEvent | null;
};

export type TimelineEventRoute = {
  answerOwnsSpeech: boolean;
  commit: (events: StreamEvent[]) => void;
  offer: (event: Pick<StreamEvent, "id" | "description">) => void;
};

/** Establishes timeline insertion and ID deduplication before speech eligibility. */
export function admitTimelineEvent(
  current: StreamEvent[],
  event: StreamEvent,
): TimelineEventAdmission {
  if (current.some((item) => item.id === event.id)) {
    return { events: current, inserted: null };
  }
  return {
    events: [event, ...current].slice(0, MAX_TIMELINE_EVENTS),
    inserted: event,
  };
}

/** Commits a newly deduplicated event before it can cross the TTS boundary. */
export function routeTimelineEvent(
  current: StreamEvent[],
  event: StreamEvent,
  route: TimelineEventRoute,
): TimelineEventAdmission {
  const admission = admitTimelineEvent(current, event);
  if (!admission.inserted) return admission;
  route.commit(admission.events);
  if (!route.answerOwnsSpeech) {
    route.offer({
      id: admission.inserted.id,
      description: admission.inserted.description,
    });
  }
  return admission;
}
