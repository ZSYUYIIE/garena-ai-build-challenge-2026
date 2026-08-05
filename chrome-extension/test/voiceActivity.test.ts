import assert from "node:assert/strict";
import test from "node:test";

import {
  AdaptiveVoiceActivityDetector,
  EchoAwareUserVadGate,
  TabActivityGate,
  type VadEvent,
} from "../src/sidepanel/realtime/voiceActivity.ts";

const SAMPLE_RATE = 16_000;

function pcm(durationMs: number, amplitude: number, frequency = 220): Int16Array {
  return pcmAtRate(durationMs, amplitude, frequency, SAMPLE_RATE);
}

function pcmAtRate(
  durationMs: number,
  amplitude: number,
  frequency: number,
  sampleRate: number,
): Int16Array {
  const length = (durationMs * sampleRate) / 1_000;
  return Int16Array.from(
    { length },
    (_, index) => Math.round(Math.sin((index * Math.PI * 2 * frequency) / sampleRate) * amplitude * 32_767),
  );
}

function pushFrames(
  detector: { push(pcm: Int16Array, timestampMs: number): VadEvent[] },
  samples: Int16Array,
  startMs: number,
  frameMs = 40,
): VadEvent[] {
  const frameLength = (frameMs * SAMPLE_RATE) / 1_000;
  const events: VadEvent[] = [];
  for (let offset = 0; offset < samples.length; offset += frameLength) {
    events.push(
      ...detector.push(samples.slice(offset, offset + frameLength), startMs + (offset / SAMPLE_RATE) * 1_000),
    );
  }
  return events;
}

function pushMicrophoneFrames(
  gate: EchoAwareUserVadGate,
  samples: Int16Array,
  startMs: number,
  frameMs = 40,
): VadEvent[] {
  const frameLength = (frameMs * SAMPLE_RATE) / 1_000;
  const events: VadEvent[] = [];
  for (let offset = 0; offset < samples.length; offset += frameLength) {
    events.push(
      ...gate.pushMicrophone(
        samples.slice(offset, offset + frameLength),
        startMs + (offset / SAMPLE_RATE) * 1_000,
      ),
    );
  }
  return events;
}

function add(left: Int16Array, right: Int16Array): Int16Array {
  return Int16Array.from(left, (sample, index) => {
    const value = sample + (right[index] ?? 0);
    return Math.max(-32_768, Math.min(32_767, value));
  });
}

test("opens after sustained speech with one pre-roll and closes after the hangover", () => {
  const detector = new AdaptiveVoiceActivityDetector();
  const events = [
    ...pushFrames(detector, pcm(500, 0.002), 0),
    ...pushFrames(detector, pcm(300, 0.32), 500),
    ...pushFrames(detector, new Int16Array(9_600), 800),
  ];
  const starts = events.filter((event) => event.type === "speech_start");
  const audio = events.filter((event) => event.type === "speech_audio");
  const ends = events.filter((event) => event.type === "speech_end");

  assert.equal(starts.length, 1);
  assert.ok(starts[0].preRoll.reduce((total, frame) => total + frame.length, 0) >= 4_800);
  assert.ok(audio.reduce((total, event) => total + event.pcm.length, 0) >= 2_880);
  assert.equal(ends.length, 1);
  assert.ok(ends[0].timestampMs >= 1_300);
});

test("opens sustained speech at the production 20 ms worklet cadence", () => {
  const detector = new AdaptiveVoiceActivityDetector();
  const events = [
    ...pushFrames(detector, pcm(500, 0.002), 0, 20),
    ...pushFrames(detector, pcm(300, 0.32), 500, 20),
    ...pushFrames(detector, new Int16Array(9_600), 800, 20),
  ];
  const starts = events.filter((event) => event.type === "speech_start");
  const ends = events.filter((event) => event.type === "speech_end");

  assert.equal(starts.length, 1);
  assert.equal(starts[0].preRoll.reduce((total, frame) => total + frame.length, 0), 4_800);
  assert.deepEqual(ends.map((event) => event.timestampMs), [1_300]);
});

test("keeps production-cadence ambient noise and short spikes closed", () => {
  assert.equal(
    pushFrames(new AdaptiveVoiceActivityDetector(), pcm(2_000, 0.002), 0, 20)
      .some((event) => event.type === "speech_start"),
    false,
  );

  const spikeDetector = new AdaptiveVoiceActivityDetector();
  const spikeEvents = [
    ...pushFrames(spikeDetector, pcm(500, 0.002), 0, 20),
    ...pushFrames(spikeDetector, pcm(40, 0.6), 500, 20),
    ...pushFrames(spikeDetector, pcm(400, 0.002), 540, 20),
  ];
  assert.equal(spikeEvents.some((event) => event.type === "speech_start"), false);
});

test("opens a natural rising speech onset at the production cadence", () => {
  const detector = new AdaptiveVoiceActivityDetector();
  const events = pushFrames(detector, pcm(500, 0.002), 0, 20);
  let timestampMs = 500;
  for (const amplitude of [0.02, 0.04, 0.08, 0.16, 0.24, 0.32, 0.32, 0.32]) {
    events.push(...pushFrames(detector, pcm(20, amplitude), timestampMs, 20));
    timestampMs += 20;
  }

  assert.equal(events.filter((event) => event.type === "speech_start").length, 1);
});

test("does not open a user turn for a 40 ms spike", () => {
  const detector = new AdaptiveVoiceActivityDetector();
  const events = [
    ...pushFrames(detector, pcm(500, 0.002), 0),
    ...pushFrames(detector, pcm(40, 0.6), 500),
    ...pushFrames(detector, pcm(400, 0.002), 540),
  ];

  assert.equal(events.some((event) => event.type === "speech_start"), false);
});

test("keeps at least 300 ms of pre-roll for uniform 40 ms input frames", () => {
  const detector = new AdaptiveVoiceActivityDetector();
  const events = [
    ...pushFrames(detector, pcm(480, 0.002), 0),
    ...pushFrames(detector, pcm(120, 0.32), 480),
  ];
  const start = events.find((event) => event.type === "speech_start");

  assert.ok(start);
  assert.ok(start.preRoll.reduce((total, frame) => total + frame.length, 0) >= 4_800);
});

for (const source of ["tab", "model"] as const) {
  test(`rejects delayed attenuated ${source} playback leakage without suppressing barge-in`, () => {
    const referenceSampleRate = source === "model" ? 48_000 : SAMPLE_RATE;
    const reference = pcmAtRate(800, 0.2, 310, referenceSampleRate);
    const leakage = pcm(800, 0.09, 310);
    const leakageGate = new EchoAwareUserVadGate();
    leakageGate.pushReference({
      source,
      pcm: reference,
      sampleRate: referenceSampleRate,
      firstSampleExtensionSessionMs: 0,
    });

    const leakageEvents = pushMicrophoneFrames(leakageGate, leakage.slice(0, 4_800), 80, 20);
    assert.equal(leakageEvents.some((event) => event.type === "speech_start"), false);

    const bargeInGate = new EchoAwareUserVadGate();
    bargeInGate.pushReference({
      source,
      pcm: reference,
      sampleRate: referenceSampleRate,
      firstSampleExtensionSessionMs: 0,
    });
    const nearEndSpeech = pcm(300, 0.42, 760);
    const mixed = add(leakage.slice(0, nearEndSpeech.length), nearEndSpeech);

    const bargeInEvents = pushMicrophoneFrames(bargeInGate, mixed, 80, 20);
    assert.equal(bargeInEvents.filter((event) => event.type === "speech_start").length, 1);
  });
}

test("rejects leakage when one microphone window spans adjacent reference pushes", () => {
  const reference = pcm(800, 0.2, 310);
  const leakage = pcm(300, 0.09, 310);
  const gate = new EchoAwareUserVadGate();

  for (let offset = 0; offset < reference.length; offset += 320) {
    gate.pushReference({
      source: "tab",
      pcm: reference.slice(offset, offset + 320),
      sampleRate: SAMPLE_RATE,
      firstSampleExtensionSessionMs: (offset / SAMPLE_RATE) * 1_000,
    });
  }

  const events = pushMicrophoneFrames(gate, leakage, 80);

  assert.equal(events.some((event) => event.type === "speech_start"), false);
});

test("rebases a large reference timestamp discontinuity without retaining a gap", () => {
  const previousReference = pcm(800, 0.2, 310);
  const restartedReference = pcm(800, 0.2, 470);
  const restartedLeakage = pcm(300, 0.09, 470);
  const restartedAtMs = 1_000_000_000;
  const gate = new EchoAwareUserVadGate();

  gate.pushReference({
    source: "tab",
    pcm: previousReference,
    sampleRate: SAMPLE_RATE,
    firstSampleExtensionSessionMs: 0,
  });
  const arrayBuffersBefore = process.memoryUsage().arrayBuffers;
  assert.doesNotThrow(() =>
    gate.pushReference({
      source: "tab",
      pcm: restartedReference,
      sampleRate: SAMPLE_RATE,
      firstSampleExtensionSessionMs: restartedAtMs,
    }),
  );
  const allocatedArrayBuffers = process.memoryUsage().arrayBuffers - arrayBuffersBefore;
  assert.ok(allocatedArrayBuffers < 1_000_000);

  const events = pushMicrophoneFrames(gate, restartedLeakage, restartedAtMs + 80);

  assert.equal(events.some((event) => event.type === "speech_start"), false);
});

test("keeps earlier reference history when a second sample rate initializes", () => {
  const originalReference = pcm(800, 0.2, 310);
  const laterReference = pcmAtRate(20, 0.2, 470, 48_000);
  const originalLeakage = pcm(300, 0.09, 310);
  const gate = new EchoAwareUserVadGate();

  gate.pushReference({
    source: "tab",
    pcm: originalReference,
    sampleRate: SAMPLE_RATE,
    firstSampleExtensionSessionMs: 0,
  });
  gate.pushReference({
    source: "tab",
    pcm: laterReference,
    sampleRate: 48_000,
    firstSampleExtensionSessionMs: 800,
  });

  const events = pushMicrophoneFrames(gate, originalLeakage, 80);

  assert.equal(events.some((event) => event.type === "speech_start"), false);
});

test("evicts stale samples from an oversized initial reference packet", () => {
  const reference = pcm(2_000, 0.2, 310);
  const staleLeakage = Int16Array.from(reference.slice(0, 4_800), (sample) =>
    Math.round(sample * 0.45),
  );
  const gate = new EchoAwareUserVadGate();

  gate.pushReference({
    source: "tab",
    pcm: reference,
    sampleRate: SAMPLE_RATE,
    firstSampleExtensionSessionMs: 0,
  });

  const events = pushMicrophoneFrames(gate, staleLeakage, 80);

  assert.equal(events.filter((event) => event.type === "speech_start").length, 1);
});

test("keeps the timestamp-aligned tail of an oversized restarted reference packet", () => {
  const restartedAtMs = 1_000_000_000;
  const reference = pcm(2_000, 0.2, 470);
  const staleLeakage = Int16Array.from(reference.slice(0, 4_800), (sample) =>
    Math.round(sample * 0.45),
  );
  const retainedOffsetSamples = (1_520 * SAMPLE_RATE) / 1_000;
  const recentLeakage = Int16Array.from(
    reference.slice(retainedOffsetSamples, retainedOffsetSamples + 4_800),
    (sample) => Math.round(sample * 0.45),
  );
  const createRestartedGate = (): EchoAwareUserVadGate => {
    const gate = new EchoAwareUserVadGate();
    gate.pushReference({
      source: "tab",
      pcm: pcm(100, 0.2, 220),
      sampleRate: SAMPLE_RATE,
      firstSampleExtensionSessionMs: 0,
    });
    gate.pushReference({
      source: "tab",
      pcm: reference,
      sampleRate: SAMPLE_RATE,
      firstSampleExtensionSessionMs: restartedAtMs,
    });
    return gate;
  };

  const staleEvents = pushMicrophoneFrames(
    createRestartedGate(),
    staleLeakage,
    restartedAtMs + 80,
  );
  assert.equal(staleEvents.filter((event) => event.type === "speech_start").length, 1);

  const events = pushMicrophoneFrames(
    createRestartedGate(),
    recentLeakage,
    restartedAtMs + 1_600,
  );

  assert.equal(events.some((event) => event.type === "speech_start"), false);
});

test("marks tab speech-like packets active immediately and releases after hysteresis", () => {
  const gate = new TabActivityGate();

  assert.deepEqual(gate.push(pcm(100, 0.18), 0), { changed: true, active: true });
  assert.deepEqual(gate.push(new Int16Array(1_600), 100), { changed: false, active: true });
  assert.deepEqual(gate.push(new Int16Array(1_600), 600), { changed: true, active: false });
});
