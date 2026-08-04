import assert from "node:assert/strict";
import test from "node:test";

import {
  createRevisionGuard,
  createSessionGenerationGuard,
  shouldSyncIdleGuidance,
} from "../src/sidepanel/realtime/sessionLifecycle.ts";
import { shouldAcceptTurnUpdate } from "../src/sidepanel/realtime/types.ts";

test("invalidates an older startup when a replacement session begins", () => {
  const sessions = createSessionGenerationGuard();
  const first = sessions.begin();

  sessions.invalidate();
  const second = sessions.begin();

  assert.equal(sessions.isCurrent(first), false);
  assert.equal(sessions.isCurrent(second), true);
});

test("invalidates the current startup when the session stops", () => {
  const sessions = createSessionGenerationGuard();
  const startup = sessions.begin();

  sessions.invalidate();

  assert.equal(sessions.isCurrent(startup), false);
});

test("rejects initial state after a newer browser event arrives", () => {
  const revisions = createRevisionGuard();
  const initialRequest = revisions.snapshot();

  revisions.markChanged();

  assert.equal(revisions.isCurrent(initialRequest), false);
  assert.equal(revisions.isCurrent(revisions.snapshot()), true);
});

test("syncs idle guidance only when the guidance itself changes", () => {
  assert.equal(
    shouldSyncIdleGuidance(true, null, "Click the toolbar icon."),
    true,
  );
  assert.equal(
    shouldSyncIdleGuidance(
      true,
      "Click the toolbar icon.",
      "Ready to describe this tab.",
    ),
    true,
  );
  assert.equal(
    shouldSyncIdleGuidance(
      true,
      "Ready to describe this tab.",
      "Ready to describe this tab.",
    ),
    false,
  );
  assert.equal(
    shouldSyncIdleGuidance(
      false,
      "This tab is not authorized.",
      "Ready to describe this tab.",
    ),
    false,
  );
});

test("keeps one bounded completed turn available for late transcript settlement", () => {
  const turnId = "123e4567-e89b-42d3-a456-426614174000";
  const displaced = "123e4567-e89b-42d3-a456-426614174001";

  assert.equal(shouldAcceptTurnUpdate(turnId, turnId, null), true);
  assert.equal(shouldAcceptTurnUpdate(turnId, null, turnId), true);
  assert.equal(shouldAcceptTurnUpdate(turnId, null, displaced), false);
  assert.equal(shouldAcceptTurnUpdate(turnId, null, null), false);
});
