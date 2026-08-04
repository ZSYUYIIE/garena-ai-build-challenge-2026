import assert from "node:assert/strict";
import test from "node:test";

import {
  ModelAudioPlayback,
  type ModelAudioPlaybackOptions,
} from "../src/sidepanel/realtime/modelAudioPlayback.ts";

class FakeSource {
  onended: (() => void) | null = null;
  starts: number[] = [];
  stopCalls = 0;
  buffer: AudioBuffer | null = null;
  connect() { return undefined; }
  start(at: number) { this.starts.push(at); }
  stop() { this.stopCalls += 1; }
  emitEnded() { this.onended?.(); }
}

class FakeAudioContext {
  currentTime = 0;
  readonly destination = {} as AudioDestinationNode;
  readonly sources: FakeSource[] = [];
  createBuffer(_channels: number, length: number, sampleRate: number) {
    const values = new Float32Array(length);
    return {
      length,
      sampleRate,
      getChannelData: () => values,
    } as unknown as AudioBuffer;
  }
  createBufferSource() {
    const source = new FakeSource();
    this.sources.push(source);
    return source as unknown as AudioBufferSourceNode;
  }
}

function pcm(durationMs = 100, sampleRate = 24_000): ArrayBuffer {
  return Int16Array.from({ length: (durationMs * sampleRate) / 1_000 }, (_, index) => index - 20).buffer;
}

function chunk(turnId = "answer-1", durationMs = 100, sampleRate = 24_000) {
  return {
    turnId,
    mode: "answer" as const,
    pcm: pcm(durationMs, sampleRate),
    sampleRate,
    mimeType: `audio/pcm;rate=${sampleRate}`,
  };
}

function fixture(options: Partial<ModelAudioPlaybackOptions> = {}) {
  const context = new FakeAudioContext();
  const idleTurns: string[] = [];
  const references: Array<{
    pcm: Int16Array;
    sampleRate: number;
    playAtContextTime: number;
    firstSampleExtensionSessionMs: number;
  }> = [];
  const playback = new ModelAudioPlayback({
    audioContext: context as unknown as AudioContext,
    contextTimeToExtensionSessionMs: (time) => 1_000 + time * 1_000,
    onReferencePcm: (reference) => references.push(reference),
    onIdle: (turnId) => idleTurns.push(turnId),
    ...options,
  });
  return { context, playback, idleTurns, references };
}

test("schedules PCM chunks in order and retains every source until clear", () => {
  const f = fixture();
  assert.equal(f.playback.enqueue(chunk("answer-1", 100)), "accepted");
  assert.equal(f.playback.enqueue(chunk("answer-1", 200)), "accepted");
  assert.deepEqual(f.context.sources.map((source) => source.starts), [[0], [0.1]]);

  f.playback.clear("answer-1");
  assert.deepEqual(f.context.sources.map((source) => source.stopCalls), [1, 1]);
});

test("rejects stale turns and malformed PCM atomically without scheduling a partial source", () => {
  const f = fixture();
  f.playback.enqueue(chunk("answer-1"));
  assert.throws(() => f.playback.enqueue(chunk("answer-2")), /stale/i);
  const sourceCount = f.context.sources.length;

  assert.throws(() => f.playback.enqueue({ ...chunk("answer-1"), mimeType: "audio/mp3" }), /mime/i);
  assert.throws(() => f.playback.enqueue({ ...chunk("answer-1"), pcm: new Uint8Array([1]).buffer }), /even/i);
  assert.throws(() => f.playback.enqueue({ ...chunk("answer-1"), sampleRate: 0 }), /rate/i);
  assert.equal(f.context.sources.length, sourceCount);

  f.playback.clear("answer-1");
  assert.throws(() => f.playback.enqueue(chunk("answer-1")), /stale/i);
});

test("returns overflow for valid audio beyond five seconds without truncating it", () => {
  const f = fixture();
  assert.equal(f.playback.enqueue(chunk("answer-1", 5_000)), "accepted");
  assert.equal(f.playback.enqueue(chunk("answer-1", 2)), "overflow");
  assert.equal(f.context.sources.length, 1);
});

test("does not report a turn idle until generation and local PCM playback finish", () => {
  const f = fixture();
  f.playback.enqueue(chunk("answer-1"));
  f.playback.complete("answer-1");
  assert.deepEqual(f.idleTurns, []);
  f.context.sources[0].emitEnded();
  assert.deepEqual(f.idleTurns, ["answer-1"]);
});

test("releases naturally completed source ownership while bounding recent stale-turn tombstones", () => {
  const f = fixture();
  for (let index = 0; index < 130; index += 1) {
    const turnId = `answer-${index}`;
    assert.equal(f.playback.enqueue(chunk(turnId)), "accepted");
    f.playback.complete(turnId);
    f.context.sources.at(-1)!.emitEnded();
  }

  assert.deepEqual(f.playback.getDiagnostics(), {
    activeTurnId: null,
    queuedTurnCount: 0,
    retainedSourceCount: 0,
    retiredTurnCount: 128,
  });
  assert.throws(() => f.playback.enqueue(chunk("answer-129")), /stale/i);
  assert.equal(f.playback.enqueue(chunk("answer-0")), "accepted");
  assert.throws(() => f.playback.enqueue(chunk("answer-new")), /stale/i);
});

test("clear from an ended callback stops all retained sources and cannot resurrect the turn", () => {
  const f = fixture({ onIdle: () => f.playback.clear("answer-1") });
  f.playback.enqueue(chunk("answer-1"));
  f.playback.enqueue(chunk("answer-1"));
  f.playback.complete("answer-1");
  f.context.sources[0].emitEnded();
  f.context.sources[1].emitEnded();
  assert.deepEqual(f.context.sources.map((source) => source.stopCalls), [1, 1]);
  assert.throws(() => f.playback.enqueue(chunk("answer-1")), /stale/i);
});

test("reports original PCM at its delayed real-rate context start for reference correlation", () => {
  const f = fixture();
  f.context.currentTime = 0.25;
  const delayed = chunk("answer-1", 100, 48_000);
  f.playback.enqueue(delayed);
  assert.equal(f.context.sources[0].starts[0], 0.25);
  assert.equal(f.references.length, 1);
  assert.deepEqual(
    { sampleRate: f.references[0].sampleRate, playAtContextTime: f.references[0].playAtContextTime },
    { sampleRate: 48_000, playAtContextTime: 0.25 },
  );
  assert.equal(f.references[0].pcm.length, 4_800);
  assert.equal(f.references[0].firstSampleExtensionSessionMs, 1_250);
});
