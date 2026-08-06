import assert from "node:assert/strict";
import test from "node:test";

import {
  DEFAULT_DUPLICATE_WINDOW_SECONDS,
  findDuplicateEvent,
} from "../src/events/deduplicate.js";

function event(overrides = {}) {
  return {
    timestampSeconds: 10,
    eventType: "section_visible",
    description: "The comments section is visible.",
    ...overrides,
  };
}

test("default duplicate window is inclusive through exactly five seconds", () => {
  const existing = event();
  assert.equal(DEFAULT_DUPLICATE_WINDOW_SECONDS, 5);
  assert.equal(
    findDuplicateEvent(event({ timestampSeconds: 15 }), [existing]),
    existing,
  );
  assert.equal(
    findDuplicateEvent(event({ timestampSeconds: 15.001 }), [existing]),
    null,
  );
});

test("distinct event types or descriptions remain eligible inside the window", () => {
  const existing = event();
  assert.equal(
    findDuplicateEvent(
      event({ timestampSeconds: 12, eventType: "winner_announced" }),
      [existing],
    ),
    null,
  );
  assert.equal(
    findDuplicateEvent(
      event({
        timestampSeconds: 12,
        description: "A checkout confirmation with order 42 is visible.",
      }),
      [existing],
    ),
    null,
  );
});
