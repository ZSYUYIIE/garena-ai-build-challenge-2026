import assert from "node:assert/strict";
import test from "node:test";

import {
  SpeechCoordinator,
  type PlaybackController,
} from "../src/sidepanel/realtime/speechCoordinator.ts";
import type { VoiceNarrationMode } from "../src/sidepanel/voiceNarration.ts";

type Timer = { at: number; callback: () => void; cancelled: boolean };

class FakeClock {
  now = 0;
  timers: Timer[] = [];
  setTimeout = (callback: () => void, delayMs: number) => {
    const timer = { at: this.now + delayMs, callback, cancelled: false };
    this.timers.push(timer);
    return timer;
  };
  clearTimeout = (timer: Timer) => { timer.cancelled = true; };
  advance(ms: number) {
    this.now += ms;
    for (const timer of this.timers.filter((candidate) => !candidate.cancelled && candidate.at <= this.now)) {
      timer.cancelled = true;
      timer.callback();
    }
  }
}

function modelChunk(turnId: string, mode: "answer" | "narration" = "answer") {
  return {
    turnId,
    mode,
    pcm: new Int16Array(2_400).buffer,
    sampleRate: 24_000,
    mimeType: "audio/pcm;rate=24000",
  };
}

function fixture(voiceNarrationMode: VoiceNarrationMode = "smart") {
  const clock = new FakeClock();
  const gainCalls: Array<{ gain: 0 | 0.3 | 0.4 | 1; fadeMs: number }> = [];
  const failures: Array<{ turnId: string; reason: string }> = [];
  const clears: Array<string | undefined> = [];
  const completions: string[] = [];
  const enqueued: string[] = [];
  let idle: ((turnId: string) => void) | undefined;
  let enqueueResult: "accepted" | "overflow" | "unavailable" = "accepted";
  const playback: PlaybackController = {
    enqueue: (value) => {
      enqueued.push(value.turnId);
      return enqueueResult;
    },
    complete: (turnId) => completions.push(turnId),
    clear: (turnId) => clears.push(turnId),
    stop: () => clears.push("stop"),
    setOnIdleListener: (listener) => { idle = listener; },
  };
  const coordinator = new SpeechCoordinator({
    playback,
    voiceNarrationMode,
    setTabGain: (gain, fadeMs) => gainCalls.push({ gain, fadeMs }),
    onFailTurn: (turnId, reason) => failures.push({ turnId, reason }),
    setTimeout: clock.setTimeout,
    clearTimeout: clock.clearTimeout,
  });
  return {
    coordinator,
    clock,
    gainCalls,
    failures,
    clears,
    completions,
    enqueued,
    emitPlaybackIdle: (turnId: string) => idle?.(turnId),
    makeOverflow: () => { enqueueResult = "overflow"; },
    makeUnavailable: () => { enqueueResult = "unavailable"; },
  };
}

test("mutes tab playback while the user holds push-to-talk, then ducks for the answer", () => {
  const f = fixture();
  f.coordinator.userStarted("answer-1");
  assert.deepEqual(f.gainCalls.at(-1), { gain: 0, fadeMs: 50 });

  f.coordinator.userEnded("answer-1");
  assert.deepEqual(f.gainCalls.at(-1), { gain: 0.3, fadeMs: 150 });

  f.coordinator.turnComplete({ turnId: "answer-1", mode: "answer" });
  f.emitPlaybackIdle("answer-1");
  assert.deepEqual(f.gainCalls.at(-1), { gain: 1, fadeMs: 250 });

  const gainCallCount = f.gainCalls.length;
  f.coordinator.modelAudio(modelChunk("narration-1", "narration"));
  assert.equal(f.gainCalls.length, gainCallCount);
});

test("barge-in immediately clears answer or narration playback and mutes the tab", () => {
  const f = fixture();
  f.coordinator.typedQuestionStarted("answer-1");
  f.coordinator.modelAudio(modelChunk("answer-1"));
  f.coordinator.userStarted("answer-2");
  assert.equal(f.clears.includes("answer-1"), true);
  assert.deepEqual(f.gainCalls.at(-1), { gain: 0, fadeMs: 50 });
});

test("tab activity clears narration without changing tab gain", () => {
  const f = fixture();
  f.coordinator.modelAudio(modelChunk("narration-1", "narration"));
  const gainsBefore = f.gainCalls.length;
  f.coordinator.tabActivity(true);
  assert.equal(f.clears.includes("narration-1"), true);
  assert.equal(f.gainCalls.length, gainsBefore);
});

test("Narrate over audio accepts narration during tab speech and mixes the tab at 40 percent", () => {
  const f = fixture("over_audio");
  f.coordinator.tabActivity(true);

  assert.equal(
    f.coordinator.modelAudio(modelChunk("narration-1", "narration")),
    true,
  );
  assert.deepEqual(f.gainCalls.at(-1), { gain: 0.4, fadeMs: 150 });

  f.coordinator.turnComplete({ turnId: "narration-1", mode: "narration" });
  f.emitPlaybackIdle("narration-1");
  assert.deepEqual(f.gainCalls.at(-1), { gain: 1, fadeMs: 250 });
});

test("Narration only keeps local tab playback muted through narration and answers", () => {
  const f = fixture("narration_only");
  assert.deepEqual(f.gainCalls, [{ gain: 0, fadeMs: 50 }]);

  f.coordinator.tabActivity(true);
  assert.equal(
    f.coordinator.modelAudio(modelChunk("narration-1", "narration")),
    true,
  );
  f.coordinator.clearPlayback("narration-1");
  f.coordinator.typedQuestionStarted("answer-1");
  f.coordinator.turnComplete({ turnId: "answer-1", mode: "answer" });
  f.emitPlaybackIdle("answer-1");

  assert.deepEqual(f.gainCalls, [{ gain: 0, fadeMs: 50 }]);
});

test("live mode changes immediately recompute tab gain and Smart cancels narration during tab speech", () => {
  const f = fixture("over_audio");
  f.coordinator.tabActivity(true);
  assert.equal(
    f.coordinator.modelAudio(modelChunk("narration-1", "narration")),
    true,
  );
  assert.deepEqual(f.gainCalls.at(-1), { gain: 0.4, fadeMs: 150 });

  f.coordinator.setVoiceNarrationMode("narration_only");
  assert.deepEqual(f.gainCalls.at(-1), { gain: 0, fadeMs: 50 });

  f.coordinator.setVoiceNarrationMode("smart");
  assert.equal(f.clears.includes("narration-1"), true);
  assert.deepEqual(f.gainCalls.at(-1), { gain: 1, fadeMs: 250 });
});

test("answers override the over-audio mix, then restore the selected mode target", () => {
  const f = fixture("over_audio");
  f.coordinator.modelAudio(modelChunk("narration-1", "narration"));
  assert.deepEqual(f.gainCalls.at(-1), { gain: 0.4, fadeMs: 150 });

  f.coordinator.typedQuestionStarted("answer-1");
  assert.deepEqual(f.gainCalls.at(-1), { gain: 0.3, fadeMs: 150 });
  f.coordinator.turnComplete({ turnId: "answer-1", mode: "answer" });
  f.emitPlaybackIdle("answer-1");
  assert.deepEqual(f.gainCalls.at(-1), { gain: 1, fadeMs: 250 });
});

test("typed questions duck and failed or empty answers restore volume", () => {
  const f = fixture();
  f.coordinator.typedQuestionStarted("answer-1");
  assert.deepEqual(f.gainCalls.at(-1), { gain: 0.3, fadeMs: 150 });
  f.coordinator.failTurn("answer-1", "network");
  assert.deepEqual(f.gainCalls.at(-1), { gain: 1, fadeMs: 250 });

  f.coordinator.typedQuestionStarted("answer-2");
  f.coordinator.turnComplete({ turnId: "answer-2", mode: "answer" });
  f.emitPlaybackIdle("answer-2");
  assert.deepEqual(f.gainCalls.at(-1), { gain: 1, fadeMs: 250 });
});

test("does not run the inactivity watchdog while the user is speaking", () => {
  const f = fixture();
  f.coordinator.userStarted("answer-1");
  f.clock.advance(20_000);
  assert.deepEqual(f.failures, []);
  f.coordinator.userEnded("answer-1");
  f.clock.advance(15_000);
  assert.deepEqual(f.failures, [{ turnId: "answer-1", reason: "Model response timed out." }]);
  assert.equal(f.coordinator.modelAudio(modelChunk("answer-1")), false);
});

test("regular valid answer progress resets the response watchdog", () => {
  const f = fixture();
  f.coordinator.typedQuestionStarted("answer-1");
  f.clock.advance(14_000);
  assert.equal(f.coordinator.modelAudio(modelChunk("answer-1")), true);
  f.clock.advance(14_000);
  assert.deepEqual(f.failures, []);
  f.coordinator.turnComplete({ turnId: "answer-1", mode: "answer" });
  f.clock.advance(15_000);
  assert.deepEqual(f.failures, []);
});

test("matching answer transcript progress extends the watchdog until later inactivity expires", () => {
  const f = fixture();
  f.coordinator.typedQuestionStarted("answer-1");
  f.clock.advance(14_000);
  f.coordinator.answerProgress("answer-1");
  f.clock.advance(14_000);
  f.coordinator.answerProgress("answer-1");
  f.clock.advance(14_000);
  assert.deepEqual(f.failures, []);

  f.coordinator.answerProgress("stale-answer");
  f.clock.advance(15_000);
  assert.deepEqual(f.failures, [{ turnId: "answer-1", reason: "Model response timed out." }]);
});

test("answer progress never starts or resets a watchdog for speaking, narration, or stopped turns", () => {
  const f = fixture();
  f.coordinator.userStarted("answer-1");
  f.coordinator.answerProgress("answer-1");
  f.clock.advance(20_000);
  assert.deepEqual(f.failures, []);

  f.coordinator.userEnded("answer-1");
  f.clock.advance(14_000);
  f.coordinator.answerProgress("narration-1");
  f.clock.advance(1_000);
  assert.deepEqual(f.failures, [{ turnId: "answer-1", reason: "Model response timed out." }]);

  f.coordinator.stop();
  f.coordinator.answerProgress("answer-1");
  f.clock.advance(20_000);
  assert.equal(f.failures.length, 1);
});

test("fails overflow rather than truncating the answer queue", () => {
  const f = fixture();
  f.coordinator.typedQuestionStarted("answer-1");
  f.makeOverflow();
  assert.equal(f.coordinator.modelAudio(modelChunk("answer-1")), false);
  assert.deepEqual(f.failures, [{ turnId: "answer-1", reason: "Model audio queue overflow." }]);
  assert.equal(f.clears.includes("answer-1"), true);
});

test("reports an unavailable playback context separately from queue overflow", () => {
  const f = fixture();
  f.coordinator.typedQuestionStarted("answer-1");
  f.makeUnavailable();

  assert.equal(f.coordinator.modelAudio(modelChunk("answer-1")), false);
  assert.deepEqual(f.failures, [{ turnId: "answer-1", reason: "Model audio playback unavailable." }]);
  assert.equal(f.clears.includes("answer-1"), true);
});

test("ends a sixty-second local speech turn retryably and stop restores gain and PCM", () => {
  const f = fixture();
  f.coordinator.userStarted("answer-1");
  f.clock.advance(60_000);
  assert.deepEqual(f.failures, [{ turnId: "answer-1", reason: "Speech turn exceeded 60 seconds. Please try again." }]);

  f.coordinator.typedQuestionStarted("answer-2");
  f.coordinator.stop();
  assert.equal(f.clears.includes("stop"), true);
  assert.deepEqual(f.gainCalls.at(-1), { gain: 1, fadeMs: 250 });
});

test("stop restores muted Narration only playback before teardown", () => {
  const f = fixture("narration_only");
  f.coordinator.stop();
  assert.deepEqual(f.gainCalls.at(-1), { gain: 1, fadeMs: 250 });
});

test("Chrome timeline narration ducks over-audio gain only while lifecycle is active", () => {
  const f = fixture("over_audio");
  f.coordinator.setTimelineNarrationActive(true);
  assert.deepEqual(f.gainCalls.at(-1), { gain: 0.4, fadeMs: 150 });

  f.coordinator.setTimelineNarrationActive(false);
  assert.deepEqual(f.gainCalls.at(-1), { gain: 1, fadeMs: 250 });
});

test("Chrome timeline narration never changes Narration only mute", () => {
  const f = fixture("narration_only");
  f.coordinator.setTimelineNarrationActive(true);
  f.coordinator.setTimelineNarrationActive(false);
  assert.deepEqual(f.gainCalls, [{ gain: 0, fadeMs: 50 }]);
});

test("answers own speech from admission through failure or playback idle", () => {
  const f = fixture("over_audio");
  assert.equal(f.coordinator.answerOwnsSpeech(), false);
  f.coordinator.setTimelineNarrationActive(true);
  f.coordinator.typedQuestionStarted("answer-1");
  assert.equal(f.coordinator.answerOwnsSpeech(), true);
  assert.deepEqual(f.gainCalls.at(-1), { gain: 0.3, fadeMs: 150 });

  f.coordinator.failTurn("answer-1", "failed");
  assert.equal(f.coordinator.answerOwnsSpeech(), false);
  assert.deepEqual(f.gainCalls.at(-1), { gain: 0.4, fadeMs: 150 });

  f.coordinator.typedQuestionStarted("answer-2");
  f.coordinator.turnComplete({ turnId: "answer-2", mode: "answer" });
  assert.equal(f.coordinator.answerOwnsSpeech(), true);
  f.emitPlaybackIdle("answer-2");
  assert.equal(f.coordinator.answerOwnsSpeech(), false);
});

test("Deep Research retains answer ownership beyond 15 seconds and refreshes from progress", () => {
  const f = fixture("over_audio");
  f.coordinator.typedQuestionStarted("research-1", { deepResearch: true });
  f.clock.advance(16_000);
  assert.equal(f.coordinator.answerOwnsSpeech(), true);
  assert.deepEqual(f.failures, []);

  f.clock.advance(100_000);
  f.coordinator.answerProgress("research-1");
  f.clock.advance(100_000);
  assert.equal(f.coordinator.answerOwnsSpeech(), true);
  assert.deepEqual(f.failures, []);
  assert.equal(f.coordinator.modelAudio(modelChunk("research-1")), true);
});

test("Deep Research microphone release uses the bounded long-response watchdog", () => {
  const f = fixture();
  f.coordinator.userStarted("research-mic");
  f.coordinator.userEnded("research-mic", { deepResearch: true });
  f.clock.advance(16_000);
  assert.equal(f.coordinator.answerOwnsSpeech(), true);
  assert.deepEqual(f.failures, []);
  f.clock.advance(104_000);
  assert.equal(f.coordinator.answerOwnsSpeech(), false);
  assert.deepEqual(f.failures, [{
    turnId: "research-mic",
    reason: "Model response timed out.",
  }]);
});
