import assert from "node:assert/strict";
import test from "node:test";

import {
  TimelineNarrator,
  type TimelineTtsEvent,
  type TimelineTtsPort,
} from "../src/sidepanel/realtime/timelineNarrator.ts";
import type { VoiceNarrationMode } from "../src/sidepanel/voiceNarration.ts";

type Timer = { at: number; callback: () => void; cancelled: boolean };

class FakeClock {
  nowMs = 0;
  private timers: Timer[] = [];

  now = () => this.nowMs;
  setTimeout = (callback: () => void, delayMs: number) => {
    const timer = { at: this.nowMs + delayMs, callback, cancelled: false };
    this.timers.push(timer);
    return timer;
  };
  clearTimeout = (timer: Timer) => { timer.cancelled = true; };

  advance(ms: number) {
    this.nowMs += ms;
    while (true) {
      const due = this.timers
        .filter((timer) => !timer.cancelled && timer.at <= this.nowMs)
        .sort((left, right) => left.at - right.at)[0];
      if (!due) return;
      due.cancelled = true;
      due.callback();
    }
  }
}

class FakeTts implements TimelineTtsPort {
  spokenText: string[] = [];
  callbacks: Array<(event: TimelineTtsEvent) => void> = [];
  stopCalls = 0;
  rejection: Error | null = null;
  throwOnSpeak = false;

  speak(text: string, onEvent: (event: TimelineTtsEvent) => void): void | Promise<void> {
    this.spokenText.push(text);
    this.callbacks.push(onEvent);
    if (this.throwOnSpeak) throw new Error("synchronous engine failure");
    if (this.rejection) return Promise.reject(this.rejection);
  }

  stop() { this.stopCalls += 1; }

  emit(index: number, type: string, errorMessage?: string) {
    this.callbacks[index]?.({ type, errorMessage });
  }
}

function fixture(options: {
  mode?: VoiceNarrationMode;
  enabled?: boolean;
} = {}) {
  const clock = new FakeClock();
  const tts = new FakeTts();
  const activeChanges: boolean[] = [];
  const errors: string[] = [];
  const narrator = new TimelineNarrator({
    tts,
    voiceNarrationMode: options.mode ?? "smart",
    automaticNarrationEnabled: options.enabled ?? true,
    now: clock.now,
    setTimeout: clock.setTimeout,
    clearTimeout: clock.clearTimeout,
    onActiveChange: (active) => activeChanges.push(active),
    onError: (message) => errors.push(message),
  });
  return { clock, tts, activeChanges, errors, narrator };
}

const event = (id: string, description = `Description ${id}.`) => ({ id, description });

test("Chrome timeline narration speaks exact trimmed text once per event ID", () => {
  const f = fixture({ mode: "over_audio" });
  f.narrator.offer(event("event-1", "  Goal by Rivera.  "));
  f.tts.emit(0, "start");
  f.tts.emit(0, "end");
  f.narrator.offer(event("event-1", "Changed duplicate text."));

  assert.deepEqual(f.tts.spokenText, ["Goal by Rivera."]);
  assert.deepEqual(f.activeChanges, [true, false]);
});

test("Chrome timeline narration rejects empty text without reserving the ID", () => {
  const f = fixture({ mode: "over_audio" });
  f.narrator.offer(event("event-1", "   "));
  f.narrator.offer(event("event-1", "Now valid."));
  assert.deepEqual(f.tts.spokenText, ["Now valid."]);
});

test("Smart narration requires 750 ms of continuous local silence", () => {
  const f = fixture({ mode: "smart" });
  f.narrator.setTabActivity(true);
  f.narrator.offer(event("event-1"));
  f.narrator.setTabActivity(false);
  f.clock.advance(749);
  assert.deepEqual(f.tts.spokenText, []);

  f.narrator.setTabActivity(true);
  f.narrator.setTabActivity(false);
  f.clock.advance(749);
  assert.deepEqual(f.tts.spokenText, []);
  f.clock.advance(1);
  assert.deepEqual(f.tts.spokenText, ["Description event-1."]);
});

test("always-narrate modes start immediately during tab activity", () => {
  for (const mode of ["over_audio", "narration_only"] as const) {
    const f = fixture({ mode });
    f.narrator.setTabActivity(true);
    f.narrator.offer(event(mode));
    assert.deepEqual(f.tts.spokenText, [`Description ${mode}.`]);
  }
});

test("retains only one active utterance and the newest pending event", () => {
  const f = fixture({ mode: "over_audio" });
  f.narrator.offer(event("active"));
  f.narrator.offer(event("older-pending"));
  f.narrator.offer(event("newest-pending"));
  assert.deepEqual(f.tts.spokenText, ["Description active."]);

  f.tts.emit(0, "end");
  assert.deepEqual(f.tts.spokenText, ["Description active.", "Description newest-pending."]);
});

test("drops pending work at the five-second freshness boundary", () => {
  const f = fixture({ mode: "over_audio" });
  f.narrator.offer(event("active"));
  f.narrator.offer(event("pending"));
  f.clock.advance(5_000);
  f.tts.emit(0, "end");
  assert.deepEqual(f.tts.spokenText, ["Description active."]);
});

test("settles every Chrome terminal event once and ignores late callbacks", () => {
  for (const terminal of ["end", "interrupted", "cancelled", "error"] as const) {
    const f = fixture({ mode: "over_audio" });
    f.narrator.offer(event(terminal));
    f.tts.emit(0, "start");
    f.tts.emit(0, terminal, terminal === "error" ? "voice unavailable" : undefined);
    f.tts.emit(0, "end");
    assert.deepEqual(f.activeChanges, [true, false], terminal);
    assert.deepEqual(f.errors, terminal === "error" ? ["voice unavailable"] : [], terminal);
  }
});

test("a terminal error continues with the newest unexpired pending event", () => {
  const f = fixture({ mode: "over_audio" });
  f.narrator.offer(event("active"));
  f.narrator.offer(event("pending"));
  f.tts.emit(0, "error", "engine failed");
  assert.deepEqual(f.tts.spokenText, ["Description active.", "Description pending."]);
});

test("synchronous and rejected speak failures settle without stale ownership", async () => {
  const sync = fixture({ mode: "over_audio" });
  sync.tts.throwOnSpeak = true;
  sync.narrator.offer(event("sync"));
  assert.deepEqual(sync.errors, ["Chrome could not start timeline narration."]);
  assert.deepEqual(sync.activeChanges, []);

  const rejected = fixture({ mode: "over_audio" });
  rejected.tts.rejection = new Error("voice rejected");
  rejected.narrator.offer(event("rejected"));
  await Promise.resolve();
  await Promise.resolve();
  assert.deepEqual(rejected.errors, ["voice rejected"]);
  assert.deepEqual(rejected.activeChanges, []);
});

test("question interruption clears active and pending work before late callbacks", () => {
  const f = fixture({ mode: "over_audio" });
  f.narrator.offer(event("active"));
  f.tts.emit(0, "start");
  f.narrator.offer(event("pending"));
  f.narrator.interruptForQuestion();
  f.tts.emit(0, "end");

  assert.equal(f.tts.stopCalls, 1);
  assert.deepEqual(f.activeChanges, [true, false]);
  assert.deepEqual(f.tts.spokenText, ["Description active."]);
});

test("Question only and stop clear unsafe work without replay", () => {
  const f = fixture({ mode: "smart" });
  f.narrator.offer(event("pending"));
  f.narrator.setAutomaticNarrationEnabled(false);
  f.clock.advance(750);
  f.narrator.offer(event("disabled"));
  f.narrator.setAutomaticNarrationEnabled(true);
  f.clock.advance(750);
  assert.deepEqual(f.tts.spokenText, []);

  f.narrator.offer(event("active"));
  f.clock.advance(750);
  f.tts.emit(0, "start");
  f.narrator.stop();
  f.narrator.stop();
  f.tts.emit(0, "end");
  assert.equal(f.tts.stopCalls, 1);
  assert.deepEqual(f.activeChanges, [true, false]);
});

test("mode changes re-evaluate pending work and Smart interrupts during tab activity", () => {
  const f = fixture({ mode: "smart" });
  f.narrator.setTabActivity(true);
  f.narrator.offer(event("pending"));
  f.narrator.setVoiceNarrationMode("over_audio");
  assert.deepEqual(f.tts.spokenText, ["Description pending."]);
  f.tts.emit(0, "start");

  f.narrator.setVoiceNarrationMode("smart");
  assert.equal(f.tts.stopCalls, 1);
  assert.deepEqual(f.activeChanges, [true, false]);
});
