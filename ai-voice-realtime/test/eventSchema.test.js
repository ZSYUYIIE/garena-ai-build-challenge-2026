import test from "node:test";
import assert from "node:assert/strict";

import {
  eventCandidateSchema,
  formatTimestamp,
  normalizeTimestampSeconds,
} from "../src/events/eventSchema.js";

test("eventCandidateSchema trims and validates a structured event", () => {
  const event = eventCandidateSchema.parse({
    eventType: " shot_saved ",
    entities: [" Team A ", "Player 9"],
    description: " The goalkeeper saves a close-range shot. ",
    importance: 0.91,
    confidence: 0.88,
  });

  assert.deepEqual(event, {
    eventType: "shot_saved",
    entities: ["Team A", "Player 9"],
    description: "The goalkeeper saves a close-range shot.",
    importance: 0.91,
    confidence: 0.88,
  });
});

test("eventCandidateSchema rejects malformed event fields", () => {
  assert.throws(() =>
    eventCandidateSchema.parse({
      eventType: "Shot Saved",
      entities: [],
      description: "",
      importance: 1.2,
      confidence: -0.1,
      unexpected: true,
    })
  );
});

test("timestamps are normalized and formatted for UI display", () => {
  assert.equal(normalizeTimestampSeconds(222.4567), 222.457);
  assert.equal(normalizeTimestampSeconds("bad", 4.1254), 4.125);
  assert.equal(formatTimestamp(222.9), "03:42");
  assert.equal(formatTimestamp(3723), "01:02:03");
});
