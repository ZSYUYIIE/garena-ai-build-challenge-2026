import assert from "node:assert/strict";
import test from "node:test";

import {
  createSessionCallbackGate,
  createRevisionGuard,
  createSessionGenerationGuard,
  shouldSyncIdleGuidance,
} from "../src/sidepanel/realtime/sessionLifecycle.ts";
import {
  canAcceptTurnRoleUpdate,
  createTurnRoleState,
  descriptionAfterTurnComplete,
  finishTurnRole,
  settlingTurnAfterComplete,
  speakingTurnAfterPlaybackIdle,
} from "../src/sidepanel/realtime/types.ts";

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

test("rejects late media callbacks from a closed generation after replacement", () => {
  const sessions = createSessionGenerationGuard();
  const firstGeneration = sessions.begin();
  const first = createSessionCallbackGate(() => sessions.isCurrent(firstGeneration));
  let delivered = 0;

  assert.equal(first.run(() => { delivered += 1; }), true);
  sessions.invalidate();
  const replacementGeneration = sessions.begin();
  const replacement = createSessionCallbackGate(() => sessions.isCurrent(replacementGeneration));

  assert.equal(first.run(() => { delivered += 100; }), false);
  first.close();
  first.close();
  assert.equal(first.run(() => { delivered += 100; }), false);
  assert.equal(replacement.run(() => { delivered += 1; }), true);
  assert.equal(delivered, 2);
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

test("settles user then assistant independently after turn completion", () => {
  const turnId = "123e4567-e89b-42d3-a456-426614174000";
  const active = createTurnRoleState(turnId);
  let settling = settlingTurnAfterComplete(active, turnId);

  assert.equal(canAcceptTurnRoleUpdate(turnId, "user", null, settling), true);
  settling = finishTurnRole(settling!, "user");
  assert.equal(canAcceptTurnRoleUpdate(turnId, "user", null, settling), false);
  assert.equal(canAcceptTurnRoleUpdate(turnId, "assistant", null, settling), true);
  settling = finishTurnRole(settling, "assistant");
  assert.equal(settlingTurnAfterComplete(settling, turnId), null);
});

test("settles assistant then user independently after turn completion", () => {
  const turnId = "123e4567-e89b-42d3-a456-426614174000";
  let settling = settlingTurnAfterComplete(createTurnRoleState(turnId), turnId)!;

  assert.equal(canAcceptTurnRoleUpdate(turnId, "assistant", null, settling), true);
  settling = finishTurnRole(settling, "assistant");
  assert.equal(canAcceptTurnRoleUpdate(turnId, "assistant", null, settling), false);
  assert.equal(canAcceptTurnRoleUpdate(turnId, "user", null, settling), true);
  settling = finishTurnRole(settling, "user");
  assert.equal(settlingTurnAfterComplete(settling, turnId), null);
});

test("retains only unfinished roles on completion and rejects expired or displaced turns", () => {
  const turnId = "123e4567-e89b-42d3-a456-426614174000";
  const displaced = "123e4567-e89b-42d3-a456-426614174001";
  let active = createTurnRoleState(turnId);
  active = finishTurnRole(active, "user");
  const settling = settlingTurnAfterComplete(active, turnId)!;

  assert.equal(canAcceptTurnRoleUpdate(turnId, "user", null, settling), false);
  assert.equal(canAcceptTurnRoleUpdate(turnId, "assistant", null, settling), true);
  assert.equal(canAcceptTurnRoleUpdate(turnId, "assistant", null, null), false);
  assert.equal(
    canAcceptTurnRoleUpdate(turnId, "assistant", createTurnRoleState(displaced), null),
    false,
  );
});

test("clears speaking only for the matching playback turn after transcripts settle", () => {
  const oldTurnId = "123e4567-e89b-42d3-a456-426614174000";
  const currentTurnId = "123e4567-e89b-42d3-a456-426614174001";
  let settled = createTurnRoleState(currentTurnId);
  settled = finishTurnRole(settled, "user");
  settled = finishTurnRole(settled, "assistant");

  assert.equal(settlingTurnAfterComplete(settled, currentTurnId), null);
  assert.equal(
    speakingTurnAfterPlaybackIdle(currentTurnId, oldTurnId),
    currentTurnId,
  );
  assert.equal(
    speakingTurnAfterPlaybackIdle(currentTurnId, currentTurnId),
    null,
  );
});

test("keeps completed narration visible and clears only interrupted narration", () => {
  assert.equal(
    descriptionAfterTurnComplete("The scoreboard shows 2-1.", "narration", false),
    "The scoreboard shows 2-1.",
  );
  assert.equal(
    descriptionAfterTurnComplete("Stale narration", "narration", true),
    "",
  );
  assert.equal(
    descriptionAfterTurnComplete("Current description", "answer", true),
    "Current description",
  );
});
