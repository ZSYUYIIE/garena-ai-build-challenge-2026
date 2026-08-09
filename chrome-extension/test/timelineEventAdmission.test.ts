import assert from "node:assert/strict";
import test from "node:test";

import {
  admitTimelineEvent,
  routeTimelineEvent,
} from "../src/sidepanel/realtime/timelineEventAdmission.ts";
import type { StreamEvent } from "../src/sidepanel/realtime/types.ts";

function event(id: string, description = `Description ${id}.`): StreamEvent {
  return {
    id,
    timestampSeconds: 3,
    timestamp: "00:03",
    eventType: "goal",
    entities: ["Rivera"],
    description,
    importance: 0.9,
    confidence: 0.95,
  };
}

test("timeline event admission returns exact event only after a new ID is inserted", () => {
  const recorded = event("event-1", "Rivera scores.");
  const first = admitTimelineEvent([], recorded);

  assert.deepEqual(first.events, [recorded]);
  assert.strictEqual(first.inserted, recorded);

  const duplicate = admitTimelineEvent(first.events, event("event-1", "Duplicate text."));
  assert.strictEqual(duplicate.events, first.events);
  assert.equal(duplicate.inserted, null);
});

test("timeline event admission bounds display while preserving the newest exact object", () => {
  const current = Array.from({ length: 100 }, (_, index) => event(`old-${index}`));
  const newest = event("newest");
  const result = admitTimelineEvent(current, newest);

  assert.equal(result.events.length, 100);
  assert.strictEqual(result.events[0], newest);
  assert.equal(result.events.some((item) => item.id === "old-99"), false);
});

test("timeline TTS integration commits insertion before offering exact recorded text", () => {
  const transitions: string[] = [];
  const offers: Array<{ id: string; description: string }> = [];
  const recorded = event("event-1", "Exact recorded description.");

  const result = routeTimelineEvent([], recorded, {
    answerOwnsSpeech: false,
    commit: (events) => {
      assert.strictEqual(events[0], recorded);
      transitions.push("timeline:inserted");
    },
    offer: (offered) => {
      transitions.push("tts:offered");
      offers.push(offered);
    },
  });

  assert.strictEqual(result.inserted, recorded);
  assert.deepEqual(transitions, ["timeline:inserted", "tts:offered"]);
  assert.deepEqual(offers, [{ id: "event-1", description: "Exact recorded description." }]);
});

test("events during answer ownership remain visible without timeline TTS replay", () => {
  const committed: StreamEvent[][] = [];
  const offers: unknown[] = [];
  const recorded = event("during-answer");

  const result = routeTimelineEvent([], recorded, {
    answerOwnsSpeech: true,
    commit: (events) => committed.push(events),
    offer: (offered) => offers.push(offered),
  });

  assert.strictEqual(result.inserted, recorded);
  assert.strictEqual(committed[0]?.[0], recorded);
  assert.deepEqual(offers, []);
});
