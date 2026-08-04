import assert from "node:assert/strict";
import test from "node:test";

import { SpeechPolicy } from "../src/session/speechPolicy.js";

function createPolicy(options = {}) {
  let now = options.now ?? 0;
  const policy = new SpeechPolicy({
    nowBackendSessionMs: () => now,
    ...options,
  });

  return {
    policy,
    setNow(value) {
      now = value;
    },
  };
}

function candidate(semanticKey, overrides = {}) {
  return {
    description: `Narrate ${semanticKey}`,
    semanticKey,
    importance: 0.9,
    createdAtMs: 0,
    ...overrides,
  };
}

function makeReadyForNarration(fixture) {
  fixture.policy.setTabAudioState("healthy");
  fixture.policy.setLiveState("ready");
  fixture.policy.setLocalTabSpeech(false);
  fixture.policy.setCloudTabSpeech(false);
}

function assertStartAction(action, event) {
  assert.equal(action.type, "start_narration");
  assert.deepEqual(action.candidate, event);
  assert.equal(typeof action.reservationId, "string");
  assert.ok(action.reservationId.length > 0 && action.reservationId.length <= 16);
  return action.reservationId;
}

function dispatchNarration(fixture, event = candidate("score:2-1")) {
  makeReadyForNarration(fixture);
  fixture.policy.offerNarration(event);
  fixture.setNow(750);
  const actions = fixture.policy.poll();
  assert.equal(actions.length, 1);
  return assertStartAction(actions[0], event);
}

test("permits narration only after healthy tab silence and before expiry", () => {
  const fixture = createPolicy();
  makeReadyForNarration(fixture);
  const event = candidate("score:2-1");

  assert.deepEqual(fixture.policy.offerNarration(event), []);
  assert.deepEqual(fixture.policy.poll(), []);
  fixture.setNow(750);
  const actions = fixture.policy.poll();
  assert.equal(actions.length, 1);
  assertStartAction(actions[0], event);
  assert.deepEqual(fixture.policy.poll(), []);
});

test("permits narration when the tab has no audio track", () => {
  const fixture = createPolicy();
  fixture.policy.setTabAudioState("absent");
  fixture.policy.setLiveState("ready");
  fixture.policy.offerNarration(candidate("score:2-1"));

  fixture.setNow(750);
  assert.equal(fixture.policy.poll()[0].type, "start_narration");
});

test("holds captured audio degraded until a clean STT-ready state starts silence", () => {
  const fixture = createPolicy();
  fixture.policy.setLiveState("ready");
  fixture.policy.offerNarration(candidate("score:2-1"));

  fixture.setNow(500);
  assert.deepEqual(fixture.policy.poll(), []);
  assert.equal(fixture.policy.nextWakeAtMs(), 5_000);

  fixture.policy.setTabAudioState("healthy");
  assert.equal(fixture.policy.nextWakeAtMs(), 1_250);
  fixture.setNow(1_249);
  assert.deepEqual(fixture.policy.poll(), []);
  fixture.setNow(1_250);
  assert.equal(fixture.policy.poll()[0].type, "start_narration");
});

test("blocks narration until Live is ready", () => {
  const fixture = createPolicy();
  fixture.policy.setTabAudioState("absent");
  fixture.policy.offerNarration(candidate("score:2-1"));
  fixture.setNow(750);

  assert.deepEqual(fixture.policy.poll(), []);
  fixture.policy.setLiveState("ready");
  fixture.setNow(1_499);
  assert.deepEqual(fixture.policy.poll(), []);
  fixture.setNow(1_500);
  assert.equal(fixture.policy.poll()[0].type, "start_narration");
});

test("tab speech cancels automatic narration but never cancels a user answer", () => {
  const fixture = createPolicy();
  fixture.policy.markNarrationStarted("narration-1");

  assert.deepEqual(fixture.policy.setCloudTabSpeech(true), [
    { type: "cancel_narration", turnId: "narration-1" },
  ]);
  assert.deepEqual(fixture.policy.setCloudTabSpeech(true), []);

  fixture.policy.startUserTurn("answer-1");
  assert.deepEqual(fixture.policy.setLocalTabSpeech(true), []);
  assert.deepEqual(fixture.policy.setCloudTabSpeech(false), []);
});

test("either local or Cloud tab speech blocks pending narration and cancels it once active", () => {
  for (const setSpeech of [
    (policy) => policy.setLocalTabSpeech(true),
    (policy) => policy.setCloudTabSpeech(true),
  ]) {
    const fixture = createPolicy();
    makeReadyForNarration(fixture);
    fixture.policy.offerNarration(candidate("score:2-1"));

    assert.deepEqual(setSpeech(fixture.policy), []);
    fixture.setNow(1_000);
    assert.deepEqual(fixture.policy.poll(), []);

    assert.deepEqual(fixture.policy.setLocalTabSpeech(false), []);
    assert.deepEqual(fixture.policy.setCloudTabSpeech(false), []);
    fixture.setNow(1_750);
    const reservationId = assertStartAction(
      fixture.policy.poll()[0],
      candidate("score:2-1"),
    );
    fixture.policy.markNarrationStarted("narration-1", reservationId);
    assert.deepEqual(setSpeech(fixture.policy), [
      { type: "cancel_narration", turnId: "narration-1" },
    ]);
  }
});

test("STT and Live degradation cancel narration and drop pending candidates", () => {
  const stt = createPolicy();
  makeReadyForNarration(stt);
  stt.policy.offerNarration(candidate("score:2-1"));
  assert.deepEqual(stt.policy.setTabAudioState("degraded"), [
    { type: "drop_narration", reason: "tab_audio_degraded" },
  ]);
  stt.policy.setTabAudioState("healthy");
  stt.policy.markNarrationStarted("narration-1");
  assert.deepEqual(stt.policy.setTabAudioState("degraded"), [
    { type: "cancel_narration", turnId: "narration-1" },
  ]);

  const live = createPolicy();
  makeReadyForNarration(live);
  live.policy.offerNarration(candidate("score:2-1"));
  assert.deepEqual(live.policy.setLiveState("degraded"), [
    { type: "drop_narration", reason: "live_degraded" },
  ]);
  live.policy.setLiveState("ready");
  live.policy.markNarrationStarted("narration-2");
  assert.deepEqual(live.policy.setLiveState("closed"), [
    { type: "cancel_narration", turnId: "narration-2" },
  ]);
});

test("a user turn drops pending narration and keeps only one Live speech turn active", () => {
  const fixture = createPolicy();
  makeReadyForNarration(fixture);
  fixture.policy.offerNarration(candidate("score:2-1"));

  assert.deepEqual(fixture.policy.startUserTurn("answer-1"), [
    { type: "drop_narration", reason: "user_turn" },
  ]);
  fixture.setNow(1_000);
  assert.deepEqual(fixture.policy.poll(), []);
  assert.deepEqual(fixture.policy.markNarrationStarted("narration-1"), []);
  assert.deepEqual(fixture.policy.startUserTurn("answer-2"), []);
  assert.deepEqual(fixture.policy.finishTurn("narration-1"), []);
  assert.deepEqual(fixture.policy.finishTurn("answer-1"), []);

  fixture.policy.markNarrationStarted("narration-2");
  assert.deepEqual(fixture.policy.startUserTurn("answer-3"), [
    { type: "cancel_narration", turnId: "narration-2" },
  ]);
});

test("records semantic cooldown only when narration actually starts", () => {
  const fixture = createPolicy();
  makeReadyForNarration(fixture);
  const first = candidate("score:2-1");
  fixture.policy.offerNarration(first);
  fixture.setNow(750);
  const reservationId = assertStartAction(fixture.policy.poll()[0], first);
  fixture.policy.markNarrationStarted("narration-1", reservationId);
  fixture.policy.finishTurn("narration-1");

  fixture.setNow(1_000);
  assert.deepEqual(fixture.policy.offerNarration(candidate("score:2-1", { createdAtMs: 1_000 })), []);
  fixture.setNow(15_749);
  assert.deepEqual(fixture.policy.offerNarration(candidate("score:2-1", { createdAtMs: 15_749 })), []);
  fixture.setNow(15_750);
  assert.deepEqual(fixture.policy.offerNarration(candidate("score:2-1", { createdAtMs: 15_750 })), []);
  assert.equal(fixture.policy.nextWakeAtMs(), 15_750);
});

test("coalesces an identical pending semantic key without refreshing TTL", () => {
  const fixture = createPolicy();
  fixture.policy.offerNarration(candidate("score:2-1", { createdAtMs: 0 }));
  fixture.setNow(100);
  fixture.policy.offerNarration(candidate("score:2-1", { createdAtMs: 100, importance: 1 }));

  fixture.setNow(5_000);
  assert.deepEqual(fixture.policy.poll(), [
    { type: "drop_narration", reason: "expired" },
  ]);
});

test("replaces a pending candidate only when it is fresher and at least as important", () => {
  const fixture = createPolicy();
  const first = candidate("score:2-1", { createdAtMs: 100, importance: 0.9 });
  fixture.policy.offerNarration(first);

  fixture.setNow(200);
  fixture.policy.offerNarration(candidate("wicket:3", { createdAtMs: 99, importance: 1 }));
  fixture.policy.offerNarration(candidate("wicket:3", { createdAtMs: 101, importance: 0.8 }));
  const replacement = candidate("wicket:3", { createdAtMs: 101, importance: 0.9 });
  assert.deepEqual(fixture.policy.offerNarration(replacement), [
    { type: "drop_narration", reason: "replaced" },
  ]);

  fixture.setNow(5_100);
  assert.deepEqual(fixture.policy.poll(), []);
  fixture.setNow(5_101);
  assert.deepEqual(fixture.policy.poll(), [
    { type: "drop_narration", reason: "expired" },
  ]);
});

test("nextWakeAtMs is exact, replaces a silence wake after renewed speech, and clears after expiry", () => {
  const fixture = createPolicy();
  makeReadyForNarration(fixture);
  fixture.policy.offerNarration(candidate("score:2-1"));

  assert.equal(fixture.policy.nextWakeAtMs(), 750);
  assert.equal(fixture.policy.nextWakeAtMs(), 750);
  fixture.setNow(749);
  assert.deepEqual(fixture.policy.setLocalTabSpeech(true), []);
  assert.equal(fixture.policy.nextWakeAtMs(), 5_000);
  fixture.setNow(5_000);
  assert.deepEqual(fixture.policy.poll(), [
    { type: "drop_narration", reason: "expired" },
  ]);
  assert.equal(fixture.policy.nextWakeAtMs(), null);
});

test("requires a finite monotonic backend session clock", () => {
  assert.throws(() => new SpeechPolicy(), /nowBackendSessionMs/i);
  assert.throws(() => new SpeechPolicy({ nowBackendSessionMs: () => Number.NaN }), /finite/i);

  const fixture = createPolicy();
  fixture.setNow(10);
  fixture.policy.poll();
  fixture.setNow(9);
  assert.throws(() => fixture.policy.poll(), /monotonic/i);
});

test("Live reconnect cancels active narration and repeated connecting is idempotent", () => {
  const fixture = createPolicy();
  makeReadyForNarration(fixture);
  fixture.policy.markNarrationStarted("narration-1");

  assert.deepEqual(fixture.policy.setLiveState("connecting"), [
    { type: "cancel_narration", turnId: "narration-1" },
  ]);
  assert.deepEqual(fixture.policy.setLiveState("connecting"), []);
});

test("local or Cloud speech invalidates a dispatched narration and cancels a late start once", () => {
  for (const setSpeech of [
    (policy) => policy.setLocalTabSpeech(true),
    (policy) => policy.setCloudTabSpeech(true),
  ]) {
    const fixture = createPolicy();
    const reservationId = dispatchNarration(fixture);

    assert.deepEqual(setSpeech(fixture.policy), [
      { type: "drop_narration", reason: "tab_speech" },
    ]);
    assert.equal(fixture.policy.nextWakeAtMs(), null);
    assert.deepEqual(fixture.policy.markNarrationStarted("narration-late", reservationId), [
      { type: "cancel_narration", turnId: "narration-late" },
    ]);
    assert.deepEqual(
      fixture.policy.markNarrationStarted("narration-late", reservationId),
      [],
    );
  }
});

test("a user turn invalidates a dispatched narration and a late mark cannot replace the answer", () => {
  const fixture = createPolicy();
  const reservationId = dispatchNarration(fixture);

  assert.deepEqual(fixture.policy.startUserTurn("answer-1"), [
    { type: "drop_narration", reason: "user_turn" },
  ]);
  assert.deepEqual(fixture.policy.markNarrationStarted("narration-late", reservationId), [
    { type: "cancel_narration", turnId: "narration-late" },
  ]);
  assert.deepEqual(
    fixture.policy.markNarrationStarted("narration-late", reservationId),
    [],
  );
  assert.deepEqual(fixture.policy.finishTurn("answer-1"), []);

  fixture.policy.markNarrationStarted("narration-2");
  assert.deepEqual(fixture.policy.setCloudTabSpeech(true), [
    { type: "cancel_narration", turnId: "narration-2" },
  ]);
});

test("STT degradation invalidates a dispatched narration and cancels its late start once", () => {
  const fixture = createPolicy();
  const reservationId = dispatchNarration(fixture);

  assert.deepEqual(fixture.policy.setTabAudioState("degraded"), [
    { type: "drop_narration", reason: "tab_audio_degraded" },
  ]);
  assert.deepEqual(fixture.policy.markNarrationStarted("narration-late", reservationId), [
    { type: "cancel_narration", turnId: "narration-late" },
  ]);
  assert.deepEqual(
    fixture.policy.markNarrationStarted("narration-late", reservationId),
    [],
  );
});

test("Live reconnect invalidates a dispatched narration and cancels its late start once", () => {
  const fixture = createPolicy();
  const reservationId = dispatchNarration(fixture);

  assert.deepEqual(fixture.policy.setLiveState("connecting"), [
    { type: "drop_narration", reason: "live_degraded" },
  ]);
  assert.deepEqual(fixture.policy.markNarrationStarted("narration-late", reservationId), [
    { type: "cancel_narration", turnId: "narration-late" },
  ]);
  assert.deepEqual(
    fixture.policy.markNarrationStarted("narration-late", reservationId),
    [],
  );
  assert.deepEqual(fixture.policy.setLiveState("connecting"), []);
});

test("a dispatched start schedules only its future expiry and expiry remains observable to poll", () => {
  const fixture = createPolicy();
  const reservationId = dispatchNarration(fixture);

  assert.equal(fixture.policy.nextWakeAtMs(), 5_000);
  assert.equal(fixture.policy.nextWakeAtMs(), 5_000);
  fixture.setNow(5_000);
  assert.equal(fixture.policy.nextWakeAtMs(), null);
  assert.equal(fixture.policy.nextWakeAtMs(), null);
  assert.deepEqual(fixture.policy.poll(), [
    { type: "drop_narration", reason: "expired" },
  ]);
  assert.deepEqual(fixture.policy.poll(), []);
  assert.equal(fixture.policy.nextWakeAtMs(), null);
  assert.deepEqual(fixture.policy.markNarrationStarted("narration-late", reservationId), [
    { type: "cancel_narration", turnId: "narration-late" },
  ]);
});

test("an invalidated dispatch with no acknowledgement does not block a healthy newer dispatch", () => {
  const fixture = createPolicy({ narrationSilenceMs: 0 });
  makeReadyForNarration(fixture);
  const eventA = candidate("score:A");
  fixture.policy.offerNarration(eventA);
  const reservationA = assertStartAction(fixture.policy.poll()[0], eventA);

  assert.deepEqual(fixture.policy.setLocalTabSpeech(true), [
    { type: "drop_narration", reason: "tab_speech" },
  ]);
  fixture.policy.setLocalTabSpeech(false);
  const eventB = candidate("score:B");
  assert.deepEqual(fixture.policy.offerNarration(eventB), []);
  const reservationB = assertStartAction(fixture.policy.poll()[0], eventB);

  assert.notEqual(reservationA, reservationB);
  assert.deepEqual(fixture.policy.markNarrationStarted("narration-B", reservationB), []);
  assert.deepEqual(fixture.policy.setCloudTabSpeech(true), [
    { type: "cancel_narration", turnId: "narration-B" },
  ]);
});

test("a stale token cannot consume a newer reservation and the exact token cooldowns only B", () => {
  const fixture = createPolicy({ narrationSilenceMs: 0 });
  makeReadyForNarration(fixture);
  const eventA = candidate("score:A");
  fixture.policy.offerNarration(eventA);
  const reservationA = assertStartAction(fixture.policy.poll()[0], eventA);
  fixture.policy.setLocalTabSpeech(true);
  fixture.policy.setLocalTabSpeech(false);

  const eventB = candidate("score:B");
  fixture.policy.offerNarration(eventB);
  const reservationB = assertStartAction(fixture.policy.poll()[0], eventB);
  assert.deepEqual(fixture.policy.markNarrationStarted("narration-A", reservationA), [
    { type: "cancel_narration", turnId: "narration-A" },
  ]);
  assert.deepEqual(fixture.policy.markNarrationStarted("narration-A", reservationA), []);
  assert.deepEqual(fixture.policy.markNarrationStarted("narration-B", reservationB), []);
  assert.deepEqual(fixture.policy.markNarrationStarted("narration-B", reservationB), []);
  fixture.policy.finishTurn("narration-B");

  assert.deepEqual(fixture.policy.offerNarration(candidate("score:B")), []);
  assert.equal(fixture.policy.nextWakeAtMs(), null);
  assert.deepEqual(fixture.policy.offerNarration(candidate("score:A")), []);
  assertStartAction(fixture.policy.poll()[0], eventA);
});

test("a no-token state-seeding mark cannot consume a tokenized reservation", () => {
  const fixture = createPolicy({ narrationSilenceMs: 0 });
  makeReadyForNarration(fixture);
  const eventB = candidate("score:B");
  fixture.policy.offerNarration(eventB);
  const reservationB = assertStartAction(fixture.policy.poll()[0], eventB);

  assert.deepEqual(fixture.policy.markNarrationStarted("seed-without-token"), [
    { type: "cancel_narration", turnId: "seed-without-token" },
  ]);
  assert.deepEqual(fixture.policy.markNarrationStarted("seed-without-token"), []);
  assert.deepEqual(fixture.policy.markNarrationStarted("narration-B", reservationB), []);
  assert.deepEqual(fixture.policy.setCloudTabSpeech(true), [
    { type: "cancel_narration", turnId: "narration-B" },
  ]);
});

test("recent direct settlements are bounded while recent duplicates remain idempotent", () => {
  const fixture = createPolicy({ recentSettlementLimit: 2 });
  for (const turnId of ["direct-1", "direct-2", "direct-3"]) {
    assert.deepEqual(fixture.policy.markNarrationStarted(turnId), []);
    assert.deepEqual(fixture.policy.finishTurn(turnId), []);
  }

  assert.deepEqual(fixture.policy.markNarrationStarted("direct-3"), []);
  assert.deepEqual(fixture.policy.setLocalTabSpeech(true), []);
  fixture.policy.setLocalTabSpeech(false);

  assert.deepEqual(fixture.policy.markNarrationStarted("direct-1"), []);
  assert.deepEqual(fixture.policy.setLocalTabSpeech(true), [
    { type: "cancel_narration", turnId: "direct-1" },
  ]);
});

test("bounded invalidated-token history cannot block or corrupt current reservations", () => {
  const fixture = createPolicy({
    narrationSilenceMs: 0,
    invalidatedReservationLimit: 2,
    recentSettlementLimit: 2,
  });
  makeReadyForNarration(fixture);
  const invalidated = [];
  for (let index = 0; index < 5; index += 1) {
    const event = candidate(`old:${index}`);
    fixture.policy.offerNarration(event);
    invalidated.push(assertStartAction(fixture.policy.poll()[0], event));
    fixture.policy.setLocalTabSpeech(true);
    fixture.policy.setLocalTabSpeech(false);
  }

  const current = candidate("current");
  fixture.policy.offerNarration(current);
  const currentReservation = assertStartAction(fixture.policy.poll()[0], current);
  assert.deepEqual(
    fixture.policy.markNarrationStarted("very-late", invalidated[0]),
    [{ type: "cancel_narration", turnId: "very-late" }],
  );
  assert.deepEqual(
    fixture.policy.markNarrationStarted("very-late", invalidated[0]),
    [],
  );
  assert.deepEqual(
    fixture.policy.markNarrationStarted("current-turn", currentReservation),
    [],
  );
  assert.deepEqual(fixture.policy.setCloudTabSpeech(true), [
    { type: "cancel_narration", turnId: "current-turn" },
  ]);
});

test("semantic cooldown storage is capped and all expired keys are pruned before offers", () => {
  const fixture = createPolicy({
    narrationSilenceMs: 0,
    semanticCooldownLimit: 2,
  });
  makeReadyForNarration(fixture);

  for (let index = 0; index < 5; index += 1) {
    const event = candidate(`semantic:${index}`);
    fixture.policy.offerNarration(event);
    const reservationId = assertStartAction(fixture.policy.poll()[0], event);
    fixture.policy.markNarrationStarted(`narration-${index}`, reservationId);
    fixture.policy.finishTurn(`narration-${index}`);
  }

  assert.deepEqual(fixture.policy.offerNarration(candidate("semantic:4")), []);
  assert.equal(fixture.policy.nextWakeAtMs(), null);
  const evicted = candidate("semantic:0");
  fixture.policy.offerNarration(evicted);
  assertStartAction(fixture.policy.poll()[0], evicted);

  const fresh = createPolicy({ narrationSilenceMs: 0, semanticCooldownLimit: 2 });
  makeReadyForNarration(fresh);
  for (const key of ["expired:A", "expired:B"]) {
    const event = candidate(key);
    fresh.policy.offerNarration(event);
    const reservationId = assertStartAction(fresh.policy.poll()[0], event);
    fresh.policy.markNarrationStarted(`turn:${key}`, reservationId);
    fresh.policy.finishTurn(`turn:${key}`);
  }
  fresh.setNow(15_000);
  const afterExpiry = candidate("fresh:C", { createdAtMs: 15_000 });
  fresh.policy.offerNarration(afterExpiry);
  assertStartAction(fresh.policy.poll()[0], afterExpiry);
});
