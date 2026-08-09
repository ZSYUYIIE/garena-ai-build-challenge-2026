import assert from "node:assert/strict";
import test from "node:test";

import {
  createMicrophoneTurnOwnership,
  createSessionCallbackGate,
  createRevisionGuard,
  createSessionResourceLifecycle,
  createSessionGenerationGuard,
  shouldSyncIdleGuidance,
} from "../src/sidepanel/realtime/sessionLifecycle.ts";
import {
  canAcceptTurnRoleUpdate,
  createTurnRoleState,
  descriptionAfterTurnComplete,
  descriptionTurnOwnsCompletion,
  finishTurnRole,
  isRealtimeSessionRunning,
  mergeNarrationTranscript,
  settlingTurnAfterComplete,
  speakingTurnAfterPlaybackIdle,
} from "../src/sidepanel/realtime/types.ts";

test("keeps the running switch on throughout capture startup", () => {
  assert.equal(isRealtimeSessionRunning("idle"), false);
  assert.equal(isRealtimeSessionRunning("requesting_capture"), true);
  assert.equal(isRealtimeSessionRunning("connecting"), true);
  assert.equal(isRealtimeSessionRunning("connected"), true);
  assert.equal(isRealtimeSessionRunning("error"), false);
});

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

test("retires microphone ownership before typed admission and rejects every stale callback", () => {
  const ownership = createMicrophoneTurnOwnership<{
    turnId: string;
    packets: Int16Array[];
    bytes: number;
  }>();
  const first = {
    turnId: "11111111-1111-4111-8111-111111111111",
    packets: [new Int16Array([1, 2])],
    bytes: 4,
  };
  const fresh = {
    turnId: "22222222-2222-4222-8222-222222222222",
    packets: [] as Int16Array[],
    bytes: 0,
  };
  const transitions: string[] = [];

  ownership.claim(first);
  const retired = ownership.retire(first.turnId);
  if (retired) transitions.push(`retire:${retired.turnId}`);
  transitions.push("typed:admitted");

  assert.strictEqual(retired, first);
  assert.deepEqual(first.packets, []);
  assert.equal(first.bytes, 0);
  assert.equal(ownership.isCurrent(first), false);
  assert.equal(ownership.current(), null);
  assert.deepEqual(transitions, [
    "retire:11111111-1111-4111-8111-111111111111",
    "typed:admitted",
  ]);

  ownership.claim(fresh);
  assert.equal(ownership.isCurrent(first), false);
  assert.equal(ownership.isCurrent(fresh), true);
});

test("matching backend completion clears only the current microphone owner", () => {
  const ownership = createMicrophoneTurnOwnership<{
    turnId: string;
    packets: Int16Array[];
    bytes: number;
  }>();
  const first = {
    turnId: "33333333-3333-4333-8333-333333333333",
    packets: [new Int16Array([3, 4])],
    bytes: 4,
  };
  const replacement = {
    turnId: "44444444-4444-4444-8444-444444444444",
    packets: [] as Int16Array[],
    bytes: 0,
  };

  ownership.claim(first);
  assert.equal(ownership.retire("stale-turn"), null);
  assert.equal(ownership.isCurrent(first), true);
  assert.strictEqual(ownership.retire(first.turnId), first);
  ownership.claim(replacement);
  assert.equal(ownership.isCurrent(replacement), true);
  assert.equal(ownership.retire(first.turnId), null);
  assert.equal(ownership.isCurrent(replacement), true);
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

test("composes pagehide, stop, and tab-change cleanup while rejecting every late callback", async () => {
  let current = true;
  const lifecycle = createSessionResourceLifecycle(() => current);
  const track = { stopCalls: 0, stop() { this.stopCalls += 1; } };
  const timer = { clearCalls: 0, clear() { this.clearCalls += 1; } };
  const provider = { closeCalls: 0, close() { this.closeCalls += 1; } };
  const worklet = { closeCalls: 0, close() { this.closeCalls += 1; } };
  const modelPlayback = { stopCalls: 0, stop() { this.stopCalls += 1; } };
  const transcript = { segments: ["tab words"], clear() { this.segments = []; } };
  const microphoneTurn = {
    packets: [new Int16Array([1, 2])],
    clear() { this.packets = []; },
  };
  assert.equal(lifecycle.register(() => track.stop()), null);
  assert.equal(lifecycle.register(() => timer.clear()), null);
  assert.equal(lifecycle.register(() => provider.close()), null);
  assert.equal(lifecycle.register(() => worklet.close()), null);
  assert.equal(lifecycle.register(() => modelPlayback.stop()), null);
  assert.equal(lifecycle.register(() => transcript.clear()), null);
  assert.equal(lifecycle.register(() => microphoneTurn.clear()), null);
  let delivered = 0;
  assert.equal(lifecycle.callbacks.run(() => { delivered += 1; }), true);

  // These are the three production release paths. They must share one cleanup.
  current = false;
  const pagehide = lifecycle.release();
  const stop = lifecycle.release();
  const tabChangeDuringSpeech = lifecycle.release();
  assert.strictEqual(pagehide, stop);
  assert.strictEqual(stop, tabChangeDuringSpeech);
  await pagehide;

  let lateWorkletPackets = 0;
  let lateModelAudio = 0;
  assert.equal(lifecycle.callbacks.run(() => { lateWorkletPackets += 1; }), false);
  assert.equal(lifecycle.callbacks.run(() => { lateModelAudio += 1; }), false);
  const latePermissionTrack = { stopCalls: 0, stop() { this.stopCalls += 1; } };
  const latePermissionCleanup = lifecycle.register(() => latePermissionTrack.stop());
  assert.ok(latePermissionCleanup);
  await latePermissionCleanup;

  assert.equal(delivered, 1);
  assert.equal(lateWorkletPackets, 0);
  assert.equal(lateModelAudio, 0);
  assert.equal(track.stopCalls, 1);
  assert.equal(timer.clearCalls, 1);
  assert.equal(provider.closeCalls, 1);
  assert.equal(worklet.closeCalls, 1);
  assert.equal(modelPlayback.stopCalls, 1);
  assert.deepEqual(transcript.segments, []);
  assert.deepEqual(microphoneTurn.packets, []);
  assert.equal(latePermissionTrack.stopCalls, 1);
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

test("settles narration description only for its current turn owner", () => {
  assert.equal(descriptionTurnOwnsCompletion("narration-2", "narration-2", "narration"), true);
  assert.equal(descriptionTurnOwnsCompletion("narration-2", "narration-1", "narration"), false);
  assert.equal(descriptionTurnOwnsCompletion("narration-2", "narration-2", "answer"), false);
  assert.equal(descriptionTurnOwnsCompletion(null, "narration-1", "narration"), false);
});

test("builds Now describing from the actual streamed audio transcript", () => {
  let text = mergeNarrationTranscript("", "Three attackers are entering");
  text = mergeNarrationTranscript(text, "entering the penalty area.");
  assert.equal(text, "Three attackers are entering the penalty area.");
  assert.equal(
    mergeNarrationTranscript(text, "Three attackers are entering the penalty area."),
    text,
  );
});
