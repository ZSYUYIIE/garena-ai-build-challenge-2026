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

test("permits narration only after healthy tab silence and before expiry", () => {
  const fixture = createPolicy();
  makeReadyForNarration(fixture);
  const event = candidate("score:2-1");

  assert.deepEqual(fixture.policy.offerNarration(event), []);
  assert.deepEqual(fixture.policy.poll(), []);
  fixture.setNow(750);
  assert.deepEqual(fixture.policy.poll(), [{ type: "start_narration", candidate: event }]);
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
    assert.equal(fixture.policy.poll()[0].type, "start_narration");
    fixture.policy.markNarrationStarted("narration-1");
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
  fixture.policy.poll();
  fixture.policy.markNarrationStarted("narration-1");
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
