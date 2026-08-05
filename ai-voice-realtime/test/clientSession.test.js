import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import test from "node:test";

import { WebSocket } from "ws";

import { EventStore } from "../src/events/eventStore.js";
import { GeminiLiveSession } from "../src/gemini/liveSession.js";
import { parseServerOutput } from "../src/protocol/browserMessages.js";
import { ClientSession } from "../src/session/clientSession.js";
import { SpeechPolicy } from "../src/session/speechPolicy.js";
import { GoogleSpeechTranscriber } from "../src/stt/googleSpeechTranscriber.js";

test("acknowledges protocol v2 only after hello and validates every emitted server message", async (t) => {
  const fixture = createFixture({
    model: "vision-model",
    liveModel: "live-model",
    liveSessionFactory: () => new FakeLiveSession(),
  });
  t.after(() => fixture.eventStore.close());
  await fixture.session.start();

  assert.deepEqual(fixture.browser.messages, []);
  hello(fixture, "absent");
  await flushAsyncWork();

  assert.deepEqual(fixture.browser.messages[0], {
    type: "connected",
    protocolVersion: 2,
    model: "live-model",
  });
  for (const message of fixture.browser.messages) {
    assert.deepEqual(parseServerOutput(message), message);
  }
});

test("routes Live telemetry diagnostics outside provider readiness health", async (t) => {
  const fixture = createFixture({ liveSessionFactory: () => new FakeLiveSession() });
  t.after(() => fixture.eventStore.close());
  await fixture.session.start();
  hello(fixture, "absent");

  fixture.session.handleLiveMessage({ type: "health", state: "telemetry", message: "Dropped stale output." });

  assert.equal(
    fixture.browser.messages.some((message) => message.type === "provider_health" && message.state === "telemetry"),
    false,
  );
  assert.deepEqual(fixture.browser.messages.at(-1), {
    type: "telemetry",
    text: "Dropped stale output.",
  });
});

test("closes malformed and non-object JSON as a client policy violation", async () => {
  for (const raw of ["{", "null", "[]"]) {
    const fixture = createFixture();
    await fixture.session.start();

    fixture.browser.emit("message", Buffer.from(raw), false);

    assert.equal(fixture.browser.closed[0]?.code, 1008, raw);
    fixture.eventStore.close();
  }
});

test("rejects binary data before a valid hello", async (t) => {
  const fixture = createFixture();
  t.after(() => fixture.eventStore.close());
  await fixture.session.start();

  fixture.browser.emit("message", Buffer.from([1, 2, 3]), true);

  assert.equal(fixture.browser.closed[0]?.code, 1008);
});

test("routes admitted microphone and captured-tab PCM to their separate providers", async (t) => {
  const live = new FakeLiveSession();
  const transcriber = new FakeTranscriber();
  const fixture = createFixture({
    liveSessionFactory: () => live,
    transcriberFactory: () => transcriber,
  });
  t.after(() => fixture.eventStore.close());
  await fixture.session.start();

  fixture.browser.emit("message", Buffer.from(JSON.stringify({
    type: "session_hello",
    protocolVersion: 2,
    tabAudioState: "captured",
    microphoneState: "ready",
  })), false);
  const turnId = "11111111-1111-4111-8111-111111111111";
  fixture.browser.emit("message", Buffer.from(JSON.stringify({ type: "user_activity_start", turnId })), false);
  const mic = audioPacket(1, 0, Buffer.from([1, 0, 2, 0]));
  const tab = audioPacket(2, 0, Buffer.from([3, 0, 4, 0]));
  fixture.browser.emit("message", mic, true);
  fixture.browser.emit("message", tab, true);
  fixture.browser.emit("message", Buffer.from(JSON.stringify({ type: "user_activity_end", turnId })), false);

  assert.deepEqual(live.microphoneWrites, [Buffer.from([1, 0, 2, 0])]);
  assert.deepEqual(transcriber.writes.map(({ pcm }) => pcm), [Buffer.from([3, 0, 4, 0])]);
  assert.deepEqual(live.tabWrites, []);
  assert.deepEqual(transcriber.microphoneWrites, []);
});

test("runs atomic narration from an admitted browser video frame without a direct request", async (t) => {
  let analyses = 0;
  const fixture = createFixture({
    analyzeFrame: async () => {
      analyses += 1;
      return approvedAnalysis();
    },
    liveSessionFactory: () => new FakeLiveSession(),
  });
  t.after(() => fixture.eventStore.close());
  await fixture.session.start();
  hello(fixture, "absent");
  await flushAsyncWork();

  fixture.browser.emit("message", Buffer.from(JSON.stringify({
    type: "video_frame", timestampSeconds: 1, mimeType: "image/jpeg", data: Buffer.from("frame").toString("base64"),
  })), false);
  await flushAsyncWork();

  assert.equal(analyses, 1);
  assert.equal(fixture.browser.messages.some((message) => message.type === "event"), true);
});

test("coalesces sustained admitted frames behind a slow atomic analysis without aborting it", async (t) => {
  let now = 0;
  const first = deferred();
  const second = deferred();
  const inputs = [];
  const fixture = createFixture({
    now: () => now,
    analyzeFrame(input) {
      inputs.push(input);
      return inputs.length === 1 ? first.promise : second.promise;
    },
    liveSessionFactory: () => new FakeLiveSession(),
  });
  t.after(() => fixture.eventStore.close());
  await fixture.session.start();
  hello(fixture, "absent");
  await flushAsyncWork();

  const frame = (timestampSeconds, data) => fixture.browser.emit("message", Buffer.from(JSON.stringify({
    type: "video_frame", timestampSeconds, mimeType: "image/jpeg", data: Buffer.from(data).toString("base64"),
  })), false);
  frame(1, "first");
  await flushAsyncWork();
  now = 1_000;
  frame(2, "latest");

  assert.equal(inputs.length, 1);
  assert.equal(inputs[0].signal.aborted, false);
  first.resolve(approvedAnalysis({ semanticKey: "first", event: null }));
  await flushAsyncWork();
  assert.equal(inputs.length, 2);
  assert.equal(inputs[1].timestampSeconds, 2);
  second.resolve(approvedAnalysis({ semanticKey: "latest", event: null }));
  await flushAsyncWork();
  assert.equal(fixture.session.lastGroundedDescription, approvedAnalysis({ semanticKey: "latest", event: null }).description);
});

test("keeps ready captured-tab narration eligibility through a microphone-only media update", async (t) => {
  let now = 0;
  const live = new FakeLiveSession();
  const fixture = createFixture({
    now: () => now,
    liveSessionFactory: () => live,
    transcriberFactory: () => new FakeTranscriber(),
  });
  t.after(() => fixture.eventStore.close());
  await fixture.session.start();
  hello(fixture, "captured");
  await flushAsyncWork();

  fixture.browser.emit("message", Buffer.from(JSON.stringify({
    type: "media_state", tabAudioState: "captured", microphoneState: "ready",
  })), false);
  now = 750;
  fixture.session.handleNarrationCandidate({ description: "A score changed.", semanticKey: "score:1", importance: 1, createdAtMs: 0 });

  assert.equal(live.narrations.length, 1);
});

test("retains ordinary STT backpressure through drain without a destructive discontinuity", async (t) => {
  DrainSpeechClient.instances = [];
  let transcriber;
  const fixture = createFixture({
    liveSessionFactory: () => new FakeLiveSession(),
    transcriberFactory(options) {
      transcriber = new GoogleSpeechTranscriber({
        ...options,
        SpeechClient: DrainSpeechClient,
        projectId: "project-1",
      });
      return transcriber;
    },
  });
  t.after(async () => {
    await fixture.session.close();
    fixture.eventStore.close();
  });
  await fixture.session.start();
  hello(fixture, "captured");
  await flushAsyncWork();
  const stream = DrainSpeechClient.instances[0].streams[0];
  stream.writeResults = [false];
  const first = Buffer.from([1, 0, 2, 0]);
  const second = Buffer.from([3, 0, 4, 0]);

  assert.equal(transcriber.health, "connecting");
  stream.emit("metadata", {});
  assert.equal(transcriber.health, "ready");

  fixture.browser.emit("message", timedAudioPacket(2, 0, 0, first), true);
  fixture.browser.emit("message", timedAudioPacket(2, 1, 100, second), true);
  stream.emit("drain");

  assert.equal(stream.destroyCalls, 0);
  assert.deepEqual(
    stream.writes.slice(1).map(({ audio }) => audio),
    [first, second],
  );
  assert.equal(transcriber.health, "ready");
});

test("coalesces destructive STT overflow recovery without recursive discontinuities", async (t) => {
  DrainSpeechClient.instances = [];
  let transcriber;
  let discontinuities = 0;
  const fixture = createFixture({
    liveSessionFactory: () => new FakeLiveSession(),
    transcriberFactory(options) {
      transcriber = new GoogleSpeechTranscriber({
        ...options,
        SpeechClient: DrainSpeechClient,
        projectId: "project-1",
      });
      const markDiscontinuity = transcriber.markDiscontinuity.bind(transcriber);
      transcriber.markDiscontinuity = () => {
        discontinuities += 1;
        return markDiscontinuity();
      };
      return transcriber;
    },
  });
  t.after(async () => {
    await fixture.session.close();
    fixture.eventStore.close();
  });
  await fixture.session.start();
  hello(fixture, "captured");
  await flushAsyncWork();
  const stream = DrainSpeechClient.instances[0].streams[0];
  stream.writeResults = [false];

  for (let sequence = 0; sequence < 12; sequence += 1) {
    fixture.browser.emit(
      "message",
      timedAudioPacket(2, sequence, sequence * 100, Buffer.alloc(3_200, sequence)),
      true,
    );
  }
  await flushAsyncWork();

  assert.equal(stream.destroyCalls, 1);
  assert.equal(discontinuities, 1);
  assert.equal(transcriber.health, "degraded");
});

test("browser close during STT rotation clears timers, streams, transcript, and late callbacks", async (t) => {
  DrainSpeechClient.instances = [];
  const rotationTimers = new RotationTimers();
  const fixture = createFixture({
    liveSessionFactory: () => new FakeLiveSession(),
    transcriberFactory(options) {
      return new GoogleSpeechTranscriber({
        ...options,
        SpeechClient: DrainSpeechClient,
        projectId: "project-1",
        timers: rotationTimers,
        rotateAfterMs: 100,
      });
    },
  });
  t.after(() => fixture.eventStore.close());
  await fixture.session.start();
  hello(fixture, "captured");
  await flushAsyncWork();
  const client = DrainSpeechClient.instances[0];
  const first = client.streams[0];
  fixture.browser.emit("message", timedAudioPacket(2, 0, 0, Buffer.from([1, 0, 2, 0])), true);

  rotationTimers.advance(100);
  const replacement = client.streams[1];
  replacement.emit("data", {
    results: [{
      isFinal: true,
      alternatives: [{ transcript: "rotation context" }],
      languageCode: "en-US",
      resultEndOffset: { seconds: 0, nanos: 100_000_000 },
    }],
  });
  assert.equal(fixture.session.tabTranscriptBuffer.size, 1);
  assert.equal(first.endCalls, 1);
  assert.equal(rotationTimers.pending, 1);

  fixture.browser.emit("close");
  await fixture.session.close();
  replacement.emit("data", {
    results: [{
      isFinal: true,
      alternatives: [{ transcript: "late rotation context" }],
      languageCode: "en-US",
      resultEndOffset: { seconds: 0, nanos: 200_000_000 },
    }],
  });

  assert.equal(first.endCalls, 1);
  assert.equal(replacement.endCalls, 1);
  assert.equal(client.closeCalls, 1);
  assert.equal(rotationTimers.pending, 0);
  assert.equal(fixture.session.tabTranscriptBuffer.size, 0);
});

test("rejects a repeated user activity end marker", async (t) => {
  const live = new FakeLiveSession();
  const fixture = createFixture({ liveSessionFactory: () => live });
  t.after(() => fixture.eventStore.close());
  await fixture.session.start();
  fixture.browser.emit("message", Buffer.from(JSON.stringify({
    type: "session_hello", protocolVersion: 2, tabAudioState: "absent", microphoneState: "ready",
  })), false);
  const turnId = "22222222-2222-4222-8222-222222222222";
  fixture.browser.emit("message", Buffer.from(JSON.stringify({ type: "user_activity_start", turnId })), false);
  fixture.browser.emit("message", Buffer.from(JSON.stringify({ type: "user_activity_end", turnId })), false);
  fixture.browser.emit("message", Buffer.from(JSON.stringify({ type: "user_activity_end", turnId })), false);

  assert.equal(fixture.browser.closed[0]?.code, 1008);
});

test("degrades captured tab context after a timestamp gap", async (t) => {
  const transcriber = new FakeTranscriber();
  const fixture = createFixture({
    liveSessionFactory: () => new FakeLiveSession(),
    transcriberFactory: () => transcriber,
  });
  t.after(() => fixture.eventStore.close());
  await fixture.session.start();
  fixture.browser.emit("message", Buffer.from(JSON.stringify({
    type: "session_hello", protocolVersion: 2, tabAudioState: "captured", microphoneState: "ready",
  })), false);
  fixture.browser.emit("message", timedAudioPacket(2, 0, 0, Buffer.from([1, 0])) , true);
  fixture.browser.emit("message", timedAudioPacket(2, 1, 1_000, Buffer.from([1, 0])) , true);
  await flushAsyncWork();

  assert.equal(transcriber.discontinuities, 1);
});

test("uses Live once for typed text and preserves attributed transcript chunks", async (t) => {
  let callbacks;
  const live = new FakeLiveSession();
  const fixture = createFixture({
    liveSessionFactory(options) { callbacks = options; return live; },
  });
  t.after(() => fixture.eventStore.close());
  await fixture.session.start();
  hello(fixture, "absent");
  const turnId = "33333333-3333-4333-8333-333333333333";
  fixture.browser.emit("message", Buffer.from(JSON.stringify({ type: "typed_question", turnId, text: "What changed?" })), false);
  callbacks.onInputTranscript({ turnId, text: "what changed", finished: false, languageCode: "en-US" });
  callbacks.onOutputTranscript({ turnId, mode: "answer", text: "The score changed.", finished: true, languageCode: "en-US" });
  callbacks.onTurnComplete({ turnId, mode: "answer", interrupted: false });

  assert.deepEqual(live.typedQuestions, [{ turnId, text: "What changed?" }]);
  assert.equal(fixture.browser.messages.filter((message) => message.type === "user_transcript" && message.turnId === turnId).length, 2);
  assert.equal(fixture.browser.messages.filter((message) => message.type === "user_transcript" && message.turnId === turnId).every((message) => message.mode === "answer"), true);
  assert.deepEqual(fixture.browser.messages.find((message) => message.type === "answer_update"), {
    type: "answer_update", turnId, mode: "answer", text: "The score changed.", finished: true, languageCode: "en-US",
  });
  assert.equal(fixture.browser.messages.some((message) => message.type === "turn_complete" && message.turnId === turnId && message.retryable === false), true);
});

test("rejects an answer immediately after Live GoAway without leaving an active turn or replaying it", async (t) => {
  const reconnectDelay = deferred();
  const callbacks = [];
  const first = new FakeSdkLiveConnection();
  const replacement = new FakeSdkLiveConnection();
  const connections = [first, replacement];
  const GoogleGenAI = class {
    constructor() {
      this.live = {
        connect: async (options) => {
          callbacks.push(options.callbacks);
          return connections.shift();
        },
      };
    }
  };
  const fixture = createFixture({
    liveSessionFactory: (options) => new GeminiLiveSession({
      ...options,
      GoogleGenAI,
      sleep: () => reconnectDelay.promise,
    }),
  });
  t.after(async () => {
    await fixture.session.close();
    fixture.eventStore.close();
  });
  await fixture.session.start();
  hello(fixture, "absent");
  await flushAsyncWork();
  assert.equal(fixture.session.liveHealth, "ready");

  callbacks[0].onmessage({ goAway: {} });
  const turnId = "34343434-3434-4434-8434-343434343434";
  fixture.browser.emit("message", Buffer.from(JSON.stringify({
    type: "typed_question",
    turnId,
    text: "Did reconnect finish?",
  })), false);

  assert.equal(fixture.session.liveHealth, "connecting");
  assert.equal(fixture.session.activeSpeechTurn, null);
  assert.equal(fixture.browser.messages.filter((message) => (
    message.type === "turn_complete"
    && message.turnId === turnId
    && message.retryable === true
  )).length, 1);

  reconnectDelay.resolve();
  for (let index = 0; index < 4; index += 1) await flushAsyncWork();
  assert.deepEqual(replacement.realtimeInputs, []);
  assert.equal(fixture.session.activeSpeechTurn, null);
});

test("barge-in clears displaced Live output before opening the replacement", async (t) => {
  const live = new FakeLiveSession();
  const fixture = createFixture({ liveSessionFactory: () => live });
  t.after(() => fixture.eventStore.close());
  await fixture.session.start();
  hello(fixture, "absent");
  const first = "44444444-4444-4444-8444-444444444444";
  const second = "55555555-5555-4555-8555-555555555555";
  fixture.browser.emit("message", Buffer.from(JSON.stringify({ type: "user_activity_start", turnId: first })), false);
  fixture.browser.emit("message", Buffer.from(JSON.stringify({ type: "user_activity_start", turnId: second })), false);

  assert.deepEqual(live.discarded, [first]);
  const clear = fixture.browser.messages.findIndex((message) => message.type === "playback_clear" && message.turnId === first);
  const replacement = fixture.browser.messages.findIndex((message) => message.type === "turn_started" && message.turnId === second);
  assert.ok(clear >= 0 && clear < replacement);
});

test("samples Live video at one frame per rolling second and retains only the latest pending frame", async (t) => {
  let now = 0;
  const timers = createFakeTimers(() => now);
  const live = new FakeLiveSession();
  const fixture = createFixture({ now: () => now, timers, liveSessionFactory: () => live });
  t.after(() => fixture.eventStore.close());
  await fixture.session.start();
  hello(fixture, "absent");
  fixture.session.sendVideo(Buffer.from("first"), "image/jpeg", 0);
  now = 500;
  fixture.session.sendVideo(Buffer.from("second"), "image/jpeg", 0);
  fixture.session.sendVideo(Buffer.from("forced"), "image/jpeg", 0, { force: true });
  now = 1_000;
  timers.runDue();

  assert.deepEqual(live.videoWrites.map(({ data }) => Buffer.from(data, "base64").toString()), ["first", "forced"]);
});

test("starts a reserved narration after silence and cancels it when Live degrades", async (t) => {
  let now = 0;
  let callbacks;
  const policy = new SpeechPolicy({ nowBackendSessionMs: () => now });
  const live = new FakeLiveSession();
  const fixture = createFixture({
    now: () => now,
    speechPolicy: policy,
    liveSessionFactory(options) { callbacks = options; return live; },
  });
  t.after(() => fixture.eventStore.close());
  await fixture.session.start();
  hello(fixture, "absent");
  await flushAsyncWork();
  fixture.session.handleNarrationCandidate({ description: "A score is visible.", semanticKey: "score:1", importance: 1, createdAtMs: 0 });
  now = 750;
  fixture.session.applySpeechActions(policy.poll());
  const narration = live.narrations[0];
  callbacks.onHealth({ state: "degraded", message: "do not expose this" });

  assert.equal(live.narrations.length, 1);
  assert.equal(fixture.browser.messages.some((message) => message.type === "narration_update" && message.turnId === narration.turnId), true);
  assert.deepEqual(live.discarded, [narration.turnId]);
  assert.equal(fixture.browser.messages.some((message) => message.type === "provider_health" && Object.hasOwn(message, "message")), false);
});

test("returns one close promise and closes providers before the browser", async (t) => {
  const closeGate = deferred();
  const live = new FakeLiveSession();
  live.close = () => closeGate.promise;
  const fixture = createFixture({ liveSessionFactory: () => live });
  t.after(() => fixture.eventStore.close());
  await fixture.session.start();
  hello(fixture, "absent");
  const first = fixture.session.close();
  const second = fixture.session.close();

  assert.strictEqual(first, second);
  assert.equal(fixture.browser.closed.length, 0);
  closeGate.resolve();
  await first;
  assert.equal(fixture.browser.closed[0]?.code, 1000);
});

test("attempts every provider cleanup when another close throws synchronously", async (t) => {
  let liveCloseCalls = 0;
  let sttCloseCalls = 0;
  const live = new FakeLiveSession();
  live.close = () => {
    liveCloseCalls += 1;
    throw new Error("live close failed");
  };
  const transcriber = new FakeTranscriber();
  transcriber.close = () => {
    sttCloseCalls += 1;
    throw new Error("stt close failed");
  };
  const fixture = createFixture({
    liveSessionFactory: () => live,
    transcriberFactory: () => transcriber,
  });
  t.after(() => fixture.eventStore.close());
  await fixture.session.start();
  hello(fixture, "captured");
  await flushAsyncWork();

  await fixture.session.close();

  assert.equal(liveCloseCalls, 1);
  assert.equal(sttCloseCalls, 1);
  assert.equal(fixture.browser.closed[0]?.code, 1000);
});

test("drops a Live audio turn and closes when buffered output cannot carry control", async (t) => {
  let callbacks;
  const live = new FakeLiveSession();
  const fixture = createFixture({ liveSessionFactory(options) { callbacks = options; return live; } });
  t.after(() => fixture.eventStore.close());
  await fixture.session.start();
  hello(fixture, "absent");
  const turnId = "66666666-6666-4666-8666-666666666666";
  fixture.browser.emit("message", Buffer.from(JSON.stringify({ type: "typed_question", turnId, text: "hello" })), false);
  fixture.browser.bufferedAmount = 256 * 1024 + 1;
  callbacks.onAudio({ turnId, mode: "answer", data: "AAAA", mimeType: "audio/pcm;rate=24000" });

  assert.deepEqual(live.discarded, [turnId]);
  assert.equal(fixture.browser.closed[0]?.code, 1013);
});

test("records an atomic result during a Live answer without replacing its speech turn", async (t) => {
  const analysis = deferred();
  const policy = new FakeSpeechPolicy();
  const live = new FakeLiveSession();
  const fixture = createFixture({
    analyzeFrame: () => analysis.promise,
    speechPolicy: policy,
    liveSessionFactory: () => live,
  });
  t.after(() => fixture.eventStore.close());
  await fixture.session.start();
  hello(fixture, "absent");
  fixture.session.sendVideo(Buffer.from("scoreboard"), "image/jpeg", 12.5);
  fixture.session.requestNarration(false);
  const turnId = "77777777-7777-4777-8777-777777777777";
  fixture.browser.emit("message", Buffer.from(JSON.stringify({ type: "typed_question", turnId, text: "What changed?" })), false);
  analysis.resolve(approvedAnalysis());
  await flushAsyncWork();

  assert.equal(fixture.eventStore.listBySession(fixture.session.sessionId).length, 1);
  assert.deepEqual(policy.offers, []);
  assert.equal(fixture.session.activeSpeechTurn?.turnId, turnId);
  assert.deepEqual(live.discarded, []);
});

test("keeps captured routing through an STT restart and clean ready recovery", async (t) => {
  let sttCallbacks;
  const transcriber = new FakeTranscriber();
  const fixture = createFixture({
    liveSessionFactory: () => new FakeLiveSession(),
    transcriberFactory(options) { sttCallbacks = options; return transcriber; },
  });
  t.after(() => fixture.eventStore.close());
  await fixture.session.start();
  hello(fixture, "captured");
  fixture.browser.emit("message", timedAudioPacket(2, 0, 0, Buffer.from([1, 0])), true);
  fixture.browser.emit("message", timedAudioPacket(2, 1, 1_000, Buffer.from([2, 0])), true);
  await flushAsyncWork();
  sttCallbacks.onHealth("ready");
  fixture.browser.emit("message", timedAudioPacket(2, 2, 1_100, Buffer.from([3, 0])), true);

  assert.equal(fixture.browser.readyState, WebSocket.OPEN);
  assert.deepEqual(transcriber.writes.map(({ pcm }) => [...pcm]), [[1, 0], [3, 0]]);
});

test("uses backend acceptance time for STT regardless of packet timestamp origin", async (t) => {
  async function acceptedAt(packetTimestampMs) {
    let now = 0;
    const transcriber = new FakeTranscriber();
    const fixture = createFixture({
      now: () => now,
      liveSessionFactory: () => new FakeLiveSession(),
      transcriberFactory: () => transcriber,
    });
    t.after(() => fixture.eventStore.close());
    await fixture.session.start();
    now = 10_000;
    hello(fixture, "captured");
    fixture.browser.emit("message", timedAudioPacket(2, 0, packetTimestampMs, Buffer.from([1, 0])), true);
    return transcriber.writes[0].timestampMs;
  }

  assert.equal(await acceptedAt(12), 10_000);
  assert.equal(await acceptedAt(900_000), 10_000);
});

test("recreates captured STT after media degradation and restores PCM on clean ready", async (t) => {
  const transcribers = [];
  const fixture = createFixture({
    liveSessionFactory: () => new FakeLiveSession(),
    transcriberFactory() {
      const transcriber = new FakeTranscriber();
      transcribers.push(transcriber);
      return transcriber;
    },
  });
  t.after(() => fixture.eventStore.close());
  await fixture.session.start();
  hello(fixture, "captured");
  fixture.browser.emit("message", Buffer.from(JSON.stringify({
    type: "media_state", tabAudioState: "degraded", microphoneState: "ready",
  })), false);
  await flushAsyncWork();
  fixture.browser.emit("message", Buffer.from(JSON.stringify({
    type: "media_state", tabAudioState: "captured", microphoneState: "ready",
  })), false);
  await flushAsyncWork();
  fixture.browser.emit("message", timedAudioPacket(2, 0, 50, Buffer.from([7, 0])), true);

  assert.equal(transcribers.length, 2);
  assert.equal(fixture.browser.readyState, WebSocket.OPEN);
  assert.deepEqual(transcribers[1].writes.map(({ pcm }) => [...pcm]), [[7, 0]]);
});

test("answer barge-in retires exact policy ownership without duplicate cleanup", async (t) => {
  let now = 0;
  let callbacks;
  const policy = new SpeechPolicy({ nowBackendSessionMs: () => now });
  const live = new FakeLiveSession();
  const fixture = createFixture({
    now: () => now,
    speechPolicy: policy,
    liveSessionFactory(options) {
      callbacks = options;
      live.onDiscard = (turnId) => callbacks.onPlaybackClear({ turnId, reason: "discarded" });
      return live;
    },
  });
  t.after(() => fixture.eventStore.close());
  await fixture.session.start();
  hello(fixture, "absent");
  await flushAsyncWork();
  const first = "88888888-8888-4888-8888-888888888888";
  const second = "99999999-9999-4999-8999-999999999999";
  fixture.session.beginAnswerTurn({ turnId: first, source: "typed", text: "first" });
  fixture.session.beginAnswerTurn({ turnId: second, source: "typed", text: "second" });
  callbacks.onTurnComplete({ turnId: second, mode: "answer" });
  fixture.session.handleNarrationCandidate({ description: "Eligible again.", semanticKey: "again", importance: 1, createdAtMs: 0 });
  now = 750;
  fixture.session.applySpeechActions(policy.poll());

  assert.equal(fixture.browser.messages.filter((message) => message.type === "playback_clear" && message.turnId === first).length, 1);
  assert.equal(fixture.browser.messages.filter((message) => message.type === "turn_complete" && message.turnId === first).length, 1);
  assert.equal(live.narrations.length, 1);
});

test("narration barge-in retires exact policy ownership without duplicate cleanup", async (t) => {
  let now = 0;
  let callbacks;
  const policy = new SpeechPolicy({ nowBackendSessionMs: () => now });
  const live = new FakeLiveSession();
  const fixture = createFixture({
    now: () => now,
    speechPolicy: policy,
    liveSessionFactory(options) {
      callbacks = options;
      live.onDiscard = (turnId) => callbacks.onPlaybackClear({ turnId, reason: "discarded" });
      return live;
    },
  });
  t.after(() => fixture.eventStore.close());
  await fixture.session.start();
  hello(fixture, "absent");
  await flushAsyncWork();
  fixture.session.handleNarrationCandidate({ description: "Narrate.", semanticKey: "n", importance: 1, createdAtMs: 0 });
  now = 750;
  fixture.session.applySpeechActions(policy.poll());
  const narrationId = live.narrations[0].turnId;
  fixture.session.beginAnswerTurn({ turnId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", source: "typed", text: "stop" });

  assert.equal(fixture.browser.messages.filter((message) => message.type === "playback_clear" && message.turnId === narrationId).length, 1);
  assert.equal(fixture.browser.messages.filter((message) => message.type === "turn_complete" && message.turnId === narrationId).length, 1);
  assert.equal(live.discarded.filter((turnId) => turnId === narrationId).length, 1);
});

test("invalidates a reserved narration when Live is unavailable at dispatch", async (t) => {
  let now = 0;
  const policy = new SpeechPolicy({ nowBackendSessionMs: () => now });
  const fixture = createFixture({ now: () => now, speechPolicy: policy, liveSessionFactory: () => new FakeLiveSession() });
  t.after(() => fixture.eventStore.close());
  await fixture.session.start();
  hello(fixture, "absent");
  await flushAsyncWork();
  fixture.session.handleNarrationCandidate({ description: "Narrate.", semanticKey: "n", importance: 1, createdAtMs: 0 });
  now = 750;
  const reserved = policy.poll();
  fixture.session.liveHealth = "connecting";
  fixture.session.applySpeechActions(reserved);

  assert.equal(fixture.session.activeSpeechTurn, null);
  assert.equal(policy.nextWakeAtMs(), null);
  assert.equal(fixture.browser.messages.filter((message) => message.type === "playback_clear").length, 1);
  assert.equal(fixture.browser.messages.filter((message) => message.type === "turn_complete" && message.retryable).length, 1);
});

test("failed narration dispatch has no cooldown and leaves no active turn", async (t) => {
  let now = 0;
  const policy = new SpeechPolicy({ nowBackendSessionMs: () => now });
  const live = new FakeLiveSession();
  live.speakNarration = () => { throw new Error("dispatch failed"); };
  const fixture = createFixture({ now: () => now, speechPolicy: policy, liveSessionFactory: () => live });
  t.after(() => fixture.eventStore.close());
  await fixture.session.start();
  hello(fixture, "absent");
  await flushAsyncWork();
  fixture.session.handleNarrationCandidate({ description: "Narrate.", semanticKey: "n", importance: 1, createdAtMs: 0 });
  now = 750;
  fixture.session.applySpeechActions(policy.poll());

  assert.equal(fixture.session.activeSpeechTurn, null);
  assert.equal(policy.nextWakeAtMs(), null);
  live.speakNarration = FakeLiveSession.prototype.speakNarration;
  fixture.session.handleLiveMessage({ type: "health", state: "ready" });
  now = 751;
  fixture.session.handleNarrationCandidate({ description: "Narrate again.", semanticKey: "n", importance: 1, createdAtMs: 751 });
  now = 1_501;
  fixture.session.applySpeechActions(policy.poll());
  assert.equal(live.narrations.length, 1);
});

test("sync provider factory failures stay degraded without an unhandled rejection", async (t) => {
  const fixture = createFixture({ liveSessionFactory() { throw new Error("factory secret"); } });
  t.after(() => fixture.eventStore.close());
  await fixture.session.start();
  hello(fixture, "absent");
  await flushAsyncWork();

  assert.equal(fixture.session.liveHealth, "degraded");
  assert.equal(fixture.browser.messages.some((message) => JSON.stringify(message).includes("factory secret")), false);
});

test("rejected Live startup is never fabricated ready and questions fail retryably once", async (t) => {
  const live = new FakeLiveSession();
  live.autoReady = false;
  live.start = async () => { throw new Error("start failed"); };
  const fixture = createFixture({ liveSessionFactory: () => live });
  t.after(() => fixture.eventStore.close());
  await fixture.session.start();
  hello(fixture, "absent");
  await flushAsyncWork();
  const turnId = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
  fixture.session.beginAnswerTurn({ turnId, source: "typed", text: "hello" });

  assert.equal(fixture.session.liveHealth, "degraded");
  assert.deepEqual(live.typedQuestions, []);
  assert.equal(fixture.browser.messages.filter((message) => message.type === "turn_complete" && message.turnId === turnId && message.retryable).length, 1);
});

test("rejected STT startup remains degraded until an authoritative ready callback", async (t) => {
  let callbacks;
  const transcriber = new FakeTranscriber();
  transcriber.start = async () => { throw new Error("stt start failed"); };
  const fixture = createFixture({
    liveSessionFactory: () => new FakeLiveSession(),
    transcriberFactory(options) { callbacks = options; return transcriber; },
  });
  t.after(() => fixture.eventStore.close());
  await fixture.session.start();
  hello(fixture, "captured");
  await flushAsyncWork();

  assert.equal(fixture.browser.messages.filter((message) => message.type === "provider_health" && message.provider === "tab_stt").at(-1).state, "degraded");
  callbacks.onHealth("ready");
  assert.equal(fixture.browser.messages.filter((message) => message.type === "provider_health" && message.provider === "tab_stt").at(-1).state, "ready");
});

test("pending Live startup does not accept typed or microphone traffic", async (t) => {
  const startup = deferred();
  const live = new FakeLiveSession();
  live.autoReady = false;
  live.start = () => startup.promise;
  const fixture = createFixture({ liveSessionFactory: () => live });
  t.after(() => fixture.eventStore.close());
  await fixture.session.start();
  hello(fixture, "absent");
  const typed = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
  const mic = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
  fixture.session.beginAnswerTurn({ turnId: typed, source: "typed", text: "hello" });
  fixture.session.beginAnswerTurn({ turnId: mic, source: "microphone" });

  assert.deepEqual(live.typedQuestions, []);
  assert.deepEqual(live.microphoneWrites, []);
  assert.equal(fixture.browser.messages.filter((message) => message.type === "turn_complete" && message.retryable).length, 2);
  startup.resolve();
});

test("a completed newer user turn still invalidates late atomic speech eligibility", async (t) => {
  let callbacks;
  const analysis = deferred();
  const policy = new FakeSpeechPolicy();
  const live = new FakeLiveSession();
  const fixture = createFixture({
    analyzeFrame: () => analysis.promise,
    speechPolicy: policy,
    liveSessionFactory(options) { callbacks = options; return live; },
  });
  t.after(() => fixture.eventStore.close());
  await fixture.session.start();
  hello(fixture, "absent");
  await flushAsyncWork();
  fixture.session.sendVideo(Buffer.from("frame"), "image/jpeg", 1);
  fixture.session.requestNarration(false);
  const turnId = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee";
  fixture.session.beginAnswerTurn({ turnId, source: "typed", text: "question" });
  callbacks.onTurnComplete({ turnId, mode: "answer" });
  analysis.resolve(approvedAnalysis());
  await flushAsyncWork();

  assert.equal(fixture.eventStore.listBySession(fixture.session.sessionId).length, 1);
  assert.deepEqual(policy.offers, []);
});

test("accounts serialized model audio bytes before crossing the 256 KiB budget", async (t) => {
  let callbacks;
  const live = new FakeLiveSession();
  const fixture = createFixture({ liveSessionFactory(options) { callbacks = options; return live; } });
  t.after(() => fixture.eventStore.close());
  await fixture.session.start();
  hello(fixture, "absent");
  await flushAsyncWork();
  const turnId = "ffffffff-ffff-4fff-8fff-ffffffffffff";
  fixture.session.beginAnswerTurn({ turnId, source: "typed", text: "question" });
  fixture.browser.bufferedAmount = 256 * 1024 - 1_024;
  callbacks.onAudio({ turnId, mode: "answer", data: "A".repeat(2_000), mimeType: "audio/pcm;rate=24000" });

  assert.equal(fixture.browser.messages.some((message) => message.type === "model_audio" && message.turnId === turnId), false);
  assert.equal(fixture.browser.messages.filter((message) => message.type === "playback_clear" && message.turnId === turnId).length, 1);
  assert.equal(fixture.browser.messages.filter((message) => message.type === "turn_complete" && message.turnId === turnId && message.retryable).length, 1);
});

test("allows a serialized model audio message exactly at the 256 KiB budget", async (t) => {
  let callbacks;
  const live = new FakeLiveSession();
  const fixture = createFixture({ liveSessionFactory(options) { callbacks = options; return live; } });
  t.after(() => fixture.eventStore.close());
  await fixture.session.start();
  hello(fixture, "absent");
  const turnId = "12121212-1212-4212-8212-121212121212";
  fixture.session.beginAnswerTurn({ turnId, source: "typed", text: "question" });
  const event = { turnId, mode: "answer", data: "AAAA", mimeType: "audio/pcm;rate=24000" };
  const message = { type: "model_audio", ...event };
  fixture.browser.bufferedAmount = (256 * 1024) - Buffer.byteLength(JSON.stringify(message));
  callbacks.onAudio(event);

  assert.equal(fixture.browser.messages.filter((item) => item.type === "model_audio" && item.turnId === turnId).length, 1);
  assert.deepEqual(live.discarded, []);
});

test("closes a connection that exceeds the per-session frame rate", async (t) => {
  const fixture = createFixture();
  t.after(() => fixture.eventStore.close());
  await fixture.session.start();

  for (const data of ["AQID", "BAUG", "BwgJ"]) {
    fixture.browser.emit(
      "message",
      Buffer.from(
        JSON.stringify({
          type: "video_frame",
          timestampSeconds: 1,
          mimeType: "image/jpeg",
          data,
        })
      ),
      false
    );
  }

  assert.equal(fixture.browser.closed[0]?.code, 1008);
});

test("keeps atomic visual analysis independent from an unavailable text answer", async (t) => {
  let narrationSignal;
  const fixture = createFixture({
    analyzeFrame({ signal }) {
      narrationSignal = signal;
      return rejectWhenAborted(signal);
    },
    answerQuestion({ signal }) {
      return rejectWhenAborted(signal);
    },
  });
  t.after(() => fixture.eventStore.close());
  fixture.session.sendVideo(Buffer.from("first frame"), "image/jpeg", 12.5);

  fixture.session.requestNarration(false);
  fixture.session.answerTextQuestion("What is visible?");

  assert.equal(narrationSignal?.aborted, false);
  assert.equal(
    fixture.browser.messages.some((message) => message.type === "turn_complete" && message.mode === "answer" && message.retryable === true),
    true
  );
  assert.equal(
    fixture.browser.messages.some((message) => message.type === "analysis_error"),
    false
  );
  fixture.session.close();
});

test("does not report an atomic provider failure after an atomic cancellation", async (t) => {
  const signals = [];
  const fixture = createFixture({
    analyzeFrame({ signal }) {
      signals.push(signal);
      return rejectWhenAborted(signal);
    },
  });
  t.after(() => fixture.eventStore.close());
  fixture.session.sendVideo(Buffer.from("frame"), "image/jpeg", 2);

  fixture.session.requestNarration(false);
  fixture.session.requestNarration(false);
  await flushAsyncWork();

  assert.equal(signals[0]?.aborted, true);
  assert.equal(fixture.browser.messages.some((message) => message.type === "analysis_error"), false);
  fixture.session.close();
});

test("aborts the active request when the client session closes", async (t) => {
  let requestSignal;
  const fixture = createFixture({
    analyzeFrame({ signal }) {
      requestSignal = signal;
      return rejectWhenAborted(signal);
    },
  });
  t.after(() => fixture.eventStore.close());
  fixture.session.sendVideo(Buffer.from("frame"), "image/jpeg", 3);
  fixture.session.requestNarration(false);

  fixture.session.close();

  assert.equal(requestSignal?.aborted, true);
});

test("ignores an atomic provider result that resolves after session teardown", async (t) => {
  const analysis = deferred();
  const speechPolicy = new FakeSpeechPolicy();
  const fixture = createFixture({
    speechPolicy,
    analyzeFrame() {
      // Deliberately ignores AbortSignal to model a late provider callback.
      return analysis.promise;
    },
  });
  t.after(() => fixture.eventStore.close());
  fixture.session.sendVideo(Buffer.from("late frame"), "image/jpeg", 7);
  fixture.session.requestNarration(false);
  const messagesBeforeClose = fixture.browser.messages.length;
  await fixture.session.close();

  analysis.resolve(approvedAnalysis());
  await flushAsyncWork();

  assert.equal(fixture.eventStore.listBySession(fixture.session.sessionId).length, 0);
  assert.equal(fixture.session.lastGroundedDescription, "");
  assert.deepEqual(fixture.session.groundedSemanticState, {
    semanticKey: null,
    originAcceptedAtMs: null,
    observedFrameSequence: 0,
  });
  assert.equal(speechPolicy.offers.length, 0);
  assert.equal(fixture.browser.messages.length, messagesBeforeClose);
});

test("reports a genuine provider error and accepts a later turn", async (t) => {
  let attempts = 0;
  const fixture = createFixture({
    async analyzeFrame() {
      attempts += 1;
      if (attempts === 1) throw new Error("provider unavailable");
      return suppressedAnalysis();
    },
  });
  t.after(() => fixture.eventStore.close());
  fixture.session.sendVideo(Buffer.from("frame"), "image/jpeg", 4);

  fixture.session.requestNarration(false);
  await flushAsyncWork();
  fixture.session.requestNarration(false);
  await flushAsyncWork();

  assert.equal(attempts, 2);
  assert.equal(
    fixture.browser.messages.some(
      (message) =>
        message.type === "analysis_error" &&
        message.text === "Visual analysis is temporarily unavailable."
    ),
    true
  );
  fixture.session.close();
});

test("records an event at the timestamp of the analyzed frame snapshot", async (t) => {
  const analysis = deferred();
  const fixture = createFixture({
    analyzeFrame() {
      return analysis.promise;
    },
  });
  t.after(() => fixture.eventStore.close());
  fixture.session.sendVideo(Buffer.from("frame at 12.5"), "image/jpeg", 12.5);
  fixture.session.requestNarration(false);

  fixture.session.sendVideo(Buffer.from("frame at 99"), "image/jpeg", 99);
  analysis.resolve({
    shouldNarrate: true,
    description: "A score card is visible.",
    semanticKey: "score:2-1",
    importance: 0.7,
    isNew: true,
    coveredByTabSpeech: false,
    event: {
      eventType: "score_visible",
      entities: ["score card"],
      description: "A score card is visible.",
      importance: 0.7,
      confidence: 0.9,
    },
  });
  await flushAsyncWork();

  const [event] = fixture.eventStore.listBySession(fixture.session.sessionId);
  assert.equal(event.timestampSeconds, 12.5);
  fixture.session.close();
});

test("uses a session-relative acceptance clock instead of an extension frame timestamp", async (t) => {
  let now = 5_000;
  let receivedInput;
  const speechPolicy = new FakeSpeechPolicy();
  const fixture = createFixture({
    now: () => now,
    recentTabTranscript: () => "Commentary: Team A scores. ".repeat(120),
    speechPolicy,
    async analyzeFrame(input) {
      receivedInput = input;
      return approvedAnalysis();
    },
  });
  t.after(() => fixture.eventStore.close());
  now = 9_125;
  fixture.session.sendVideo(Buffer.from("scoreboard"), "image/jpeg", 12_345.678);
  now = 17_000;
  fixture.session.requestNarration(false);
  await flushAsyncWork();

  assert.equal(receivedInput.recentTabTranscript.length, 2_000);
  assert.equal(receivedInput.recentTabTranscript.includes("Commentary:"), true);
  assert.deepEqual(speechPolicy.offers, [{
    description: "The scoreboard now shows Team A leading 2-1.",
    semanticKey: "score:team_a:2-1",
    importance: 0.9,
    createdAtMs: 4_125,
  }]);
  const [event] = fixture.eventStore.listBySession(fixture.session.sessionId);
  assert.equal(event.timestampSeconds, 12_345.678);
  assert.equal(
    fixture.browser.messages.some((message) => message.type === "narration_update"),
    false,
  );
  fixture.session.close();
});

test("advances visual state for a valid suppressed analysis without queueing speech", async (t) => {
  const speechPolicy = new FakeSpeechPolicy();
  const fixture = createFixture({
    speechPolicy,
    async analyzeFrame() {
      return suppressedAnalysis({ semanticKey: "score:team_a:2-1" });
    },
  });
  t.after(() => fixture.eventStore.close());
  fixture.session.sendVideo(Buffer.from("scoreboard"), "image/jpeg", 1);
  fixture.session.requestNarration(false);
  await flushAsyncWork();

  assert.equal(fixture.session.lastGroundedDescription, "score:team_a:2-1");
  assert.equal(speechPolicy.offers.length, 0);
  fixture.session.close();
});

test("offers only fresh uncovered important semantic narration candidates", async (t) => {
  const speechPolicy = new FakeSpeechPolicy();
  const analyses = [
    approvedAnalysis({ shouldNarrate: false, description: "", semanticKey: null }),
    approvedAnalysis({ isNew: false }),
    approvedAnalysis({ coveredByTabSpeech: true }),
    approvedAnalysis({ importance: 0.59 }),
    approvedAnalysis({ description: "", semanticKey: null }),
    approvedAnalysis(),
  ];
  const fixture = createFixture({
    speechPolicy,
    async analyzeFrame() {
      return analyses.shift();
    },
  });
  t.after(() => fixture.eventStore.close());
  fixture.session.sendVideo(Buffer.from("scoreboard"), "image/jpeg", 1);

  for (let index = 0; index < 6; index += 1) {
    fixture.session.requestNarration(false);
    await flushAsyncWork();
  }

  assert.equal(speechPolicy.offers.length, 1);
  assert.equal(speechPolicy.offers[0].semanticKey, "score:team_a:2-1");
  fixture.session.close();
});

test("does not refresh a repeated sports candidate TTL during commentary", async (t) => {
  let now = 0;
  const speechPolicy = new SpeechPolicy({ nowBackendSessionMs: () => now });
  speechPolicy.setTabAudioState("healthy");
  speechPolicy.setLiveState("ready");
  speechPolicy.setCloudTabSpeech(true);
  const fixture = createFixture({
    now: () => now,
    speechPolicy,
    async analyzeFrame() {
      return approvedAnalysis();
    },
  });
  t.after(() => fixture.eventStore.close());

  fixture.session.sendVideo(Buffer.from("scoreboard one"), "image/jpeg", 3);
  fixture.session.requestNarration(false);
  await flushAsyncWork();
  assert.equal(speechPolicy.nextWakeAtMs(), 5_000);
  now = 6_001;
  fixture.session.sendVideo(Buffer.from("scoreboard two"), "image/jpeg", 99);
  fixture.session.requestNarration(false);
  await flushAsyncWork();
  speechPolicy.setCloudTabSpeech(false);
  now = 6_751;

  assert.deepEqual(speechPolicy.poll(), []);
  fixture.session.close();
});

test("a stale older semantic result cannot refresh a newer score TTL", async (t) => {
  let now = 0;
  const staleA = deferred();
  const results = [
    staleA.promise,
    Promise.resolve(semanticAnalysis("score:B", "Score B")),
    Promise.resolve(semanticAnalysis("score:B", "Score B unchanged")),
  ];
  const speechPolicy = new SpeechPolicy({ nowBackendSessionMs: () => now });
  speechPolicy.setTabAudioState("healthy");
  speechPolicy.setLiveState("ready");
  speechPolicy.setCloudTabSpeech(true);
  const fixture = createFixture({
    now: () => now,
    speechPolicy,
    analyzeFrame() {
      return results.shift();
    },
  });
  t.after(() => fixture.eventStore.close());

  fixture.session.sendVideo(Buffer.from("older A"), "image/jpeg", 1);
  fixture.session.requestNarration(false);
  now = 10;
  fixture.session.sendVideo(Buffer.from("newer B"), "image/jpeg", 2);
  fixture.session.requestNarration(false);
  await flushAsyncWork();
  assert.equal(speechPolicy.nextWakeAtMs(), 5_010);

  staleA.resolve(semanticAnalysis("screen:A", "Older A"));
  await flushAsyncWork();
  now = 6_001;
  fixture.session.sendVideo(Buffer.from("unchanged B"), "image/jpeg", 99);
  fixture.session.requestNarration(false);
  await flushAsyncWork();
  speechPolicy.setCloudTabSpeech(false);
  now = 6_751;

  assert.deepEqual(speechPolicy.poll(), []);
  fixture.session.close();
});

test("a chronological transition away and back resets the semantic origin", async (t) => {
  let now = 0;
  const speechPolicy = new FakeSpeechPolicy();
  const results = [
    semanticAnalysis("score:B", "Score B"),
    suppressedAnalysis({ semanticKey: "screen:menu" }),
    semanticAnalysis("score:B", "Score B returns"),
  ];
  const fixture = createFixture({
    now: () => now,
    speechPolicy,
    async analyzeFrame() {
      return results.shift();
    },
  });
  t.after(() => fixture.eventStore.close());

  for (const [time, frame] of [[10, "B"], [100, "menu"], [200, "B again"]]) {
    now = time;
    fixture.session.sendVideo(Buffer.from(frame), "image/jpeg", time);
    fixture.session.requestNarration(false);
    await flushAsyncWork();
  }

  assert.deepEqual(
    speechPolicy.offers.map(({ semanticKey, createdAtMs }) => ({
      semanticKey,
      createdAtMs,
    })),
    [
      { semanticKey: "score:B", createdAtMs: 10 },
      { semanticKey: "score:B", createdAtMs: 200 },
    ],
  );
  fixture.session.close();
});

test("a newer null state cannot be resurrected by an older late key", async (t) => {
  let now = 0;
  const staleA = deferred();
  const speechPolicy = new FakeSpeechPolicy();
  const results = [
    Promise.resolve(semanticAnalysis("screen:A", "Initial A")),
    staleA.promise,
    Promise.resolve(suppressedAnalysis({ semanticKey: null })),
    Promise.resolve(semanticAnalysis("screen:A", "A genuinely returns")),
  ];
  const fixture = createFixture({
    now: () => now,
    speechPolicy,
    analyzeFrame() {
      return results.shift();
    },
  });
  t.after(() => fixture.eventStore.close());

  now = 10;
  fixture.session.sendVideo(Buffer.from("initial A"), "image/jpeg", 1);
  fixture.session.requestNarration(false);
  await flushAsyncWork();
  now = 20;
  fixture.session.sendVideo(Buffer.from("older pending A"), "image/jpeg", 2);
  fixture.session.requestNarration(false);
  now = 30;
  fixture.session.sendVideo(Buffer.from("newer null"), "image/jpeg", 3);
  fixture.session.requestNarration(false);
  await flushAsyncWork();

  staleA.resolve(semanticAnalysis("screen:A", "Older late A"));
  await flushAsyncWork();
  now = 1_000;
  fixture.session.sendVideo(Buffer.from("new A"), "image/jpeg", 4);
  fixture.session.requestNarration(false);
  await flushAsyncWork();

  assert.deepEqual(
    speechPolicy.offers.map(({ createdAtMs }) => createdAtMs),
    [10, 1_000],
  );
  fixture.session.close();
});

test("records and publishes a fallback event before speech policy starts", async (t) => {
  const speechPolicy = new FakeSpeechPolicy();
  const fixture = createFixture({
    speechPolicy,
    async analyzeFrame() {
      return approvedAnalysis({ event: null });
    },
  });
  t.after(() => fixture.eventStore.close());
  fixture.session.sendVideo(Buffer.from("opening scoreboard"), "image/jpeg", 7.5);
  fixture.session.requestNarration(true);
  await flushAsyncWork();

  assert.equal(speechPolicy.offers.length, 1);
  const events = fixture.eventStore.listBySession(fixture.session.sessionId);
  assert.equal(events.length, 1);
  assert.equal(events[0].eventType, "scene_observed");
  assert.equal(events[0].timestampSeconds, 7.5);
  assert.equal(
    fixture.browser.messages.filter((message) => message.type === "event").length,
    1,
  );
  fixture.session.close();
});

test("does not record a fallback event for a self-description", async (t) => {
  const speechPolicy = new FakeSpeechPolicy();
  const fixture = createFixture({
    speechPolicy,
    async analyzeFrame() {
      return approvedAnalysis({
        description: "The StreamSense Now Describing panel shows a score.",
        event: null,
      });
    },
  });
  t.after(() => fixture.eventStore.close());
  fixture.session.sendVideo(Buffer.from("streamsense panel"), "image/jpeg", 8);
  fixture.session.requestNarration(false);
  await flushAsyncWork();

  assert.equal(fixture.eventStore.listBySession(fixture.session.sessionId).length, 0);
  assert.equal(speechPolicy.offers.length, 1);
  fixture.session.close();
});

test("records a late atomic result but never offers it after a newer user turn", async (t) => {
  const analysis = deferred();
  const speechPolicy = new FakeSpeechPolicy();
  const fixture = createFixture({
    speechPolicy,
    analyzeFrame() {
      return analysis.promise;
    },
  });
  t.after(() => fixture.eventStore.close());
  fixture.session.sendVideo(Buffer.from("scoreboard"), "image/jpeg", 12.5);
  fixture.session.requestNarration(false);
  fixture.session.answerTextQuestion("What changed?");
  analysis.resolve(approvedAnalysis());
  await flushAsyncWork();

  assert.equal(fixture.eventStore.listBySession(fixture.session.sessionId).length, 1);
  assert.equal(fixture.session.lastGroundedDescription, approvedAnalysis().description);
  assert.equal(speechPolicy.offers.length, 0);
  fixture.session.close();
});

function createFixture({
  analyzeFrame = async () => suppressedAnalysis(),
  answerQuestion = async () => "The frame is visible.",
  model = "test-model",
  liveModel = "test-live-model",
  modelTurnTimeoutMs = 15_000,
  now,
  recentTabTranscript,
  speechPolicy,
  liveSessionFactory,
  transcriberFactory,
  timers,
} = {}) {
  const browser = new FakeBrowser();
  const eventStore = new EventStore();
  const session = new ClientSession(browser, eventStore, {
    apiKey: "test-key",
    model,
    liveModel,
    analyzeFrame,
    answerQuestion,
    modelTurnTimeoutMs,
    now,
    recentTabTranscript,
    speechPolicy,
    liveSessionFactory: liveSessionFactory && ((options) => {
      const live = liveSessionFactory(options);
      if (live instanceof FakeLiveSession) {
        live.callbacks = options;
        if (live.autoReady) options.onHealth({ state: "ready" });
      }
      return live;
    }),
    transcriberFactory: transcriberFactory && ((options) => {
      const transcriber = transcriberFactory(options);
      if (transcriber instanceof FakeTranscriber) transcriber.callbacks = options;
      return transcriber;
    }),
    timers,
  });
  return { browser, eventStore, session };
}

class FakeLiveSession {
  constructor() {
    this.autoReady = true;
    this.microphoneWrites = [];
    this.tabWrites = [];
    this.typedQuestions = [];
    this.narrations = [];
    this.discarded = [];
    this.videoWrites = [];
  }

  async start() {}
  startUserActivity() {}
  endUserActivity() {}
  sendMicrophonePcm(pcm) { this.microphoneWrites.push(Buffer.from(pcm)); }
  askTyped(turnId, text) { this.typedQuestions.push({ turnId, text }); }
  speakNarration(turnId, text) { this.narrations.push({ turnId, text }); }
  discardOutput(turnId) {
    this.discarded.push(turnId);
    this.onDiscard?.(turnId);
  }
  sendVideo(frame) { this.videoWrites.push(frame); }
  async close() {}
}

class FakeSdkLiveConnection {
  constructor() {
    this.realtimeInputs = [];
  }

  sendRealtimeInput(payload) {
    this.realtimeInputs.push(payload);
  }

  close() {}
}

class DrainSpeechStream extends EventEmitter {
  constructor() {
    super();
    this.writes = [];
    this.writeResults = [];
    this.destroyCalls = 0;
    this.endCalls = 0;
  }

  write(message) {
    this.writes.push(message);
    return this.writeResults.shift() ?? true;
  }

  destroy() { this.destroyCalls += 1; }
  end() { this.endCalls += 1; }
}

class RotationTimers {
  constructor() {
    this.now = 0;
    this.nextId = 1;
    this.jobs = new Map();
  }

  setTimeout = (callback, delay) => {
    const id = this.nextId++;
    this.jobs.set(id, { callback, at: this.now + delay });
    return id;
  };

  clearTimeout = (id) => this.jobs.delete(id);

  advance(milliseconds) {
    const target = this.now + milliseconds;
    for (;;) {
      const next = [...this.jobs.entries()]
        .filter(([, job]) => job.at <= target)
        .sort(([, left], [, right]) => left.at - right.at)[0];
      if (!next) break;
      const [id, job] = next;
      this.jobs.delete(id);
      this.now = job.at;
      job.callback();
    }
    this.now = target;
  }

  get pending() { return this.jobs.size; }
}

class DrainSpeechClient {
  static instances = [];

  constructor() {
    this.streams = [];
    this.closeCalls = 0;
    DrainSpeechClient.instances.push(this);
  }

  _streamingRecognize() {
    const stream = new DrainSpeechStream();
    this.streams.push(stream);
    return stream;
  }

  async close() { this.closeCalls += 1; }
}

class FakeTranscriber {
  constructor() {
    this.writes = [];
    this.microphoneWrites = [];
    this.discontinuities = 0;
    this.closed = false;
  }
  async markDiscontinuity() { this.discontinuities += 1; }

  async start() { this.callbacks?.onHealth("ready"); }
  write(pcm, timestampMs) {
    if (this.closed) return "degraded";
    this.writes.push({ pcm: Buffer.from(pcm), timestampMs });
    return "accepted";
  }
  async close() { this.closed = true; }
}

function audioPacket(source, sequence, pcm) {
  return timedAudioPacket(source, sequence, 0, pcm);
}

function timedAudioPacket(source, sequence, timestampMs, pcm) {
  const raw = Buffer.alloc(10 + pcm.length);
  raw[0] = 1;
  raw[1] = source;
  raw.writeUInt32LE(sequence, 2);
  raw.writeUInt32LE(timestampMs, 6);
  pcm.copy(raw, 10);
  return raw;
}

function hello(fixture, tabAudioState) {
  fixture.browser.emit("message", Buffer.from(JSON.stringify({
    type: "session_hello", protocolVersion: 2, tabAudioState, microphoneState: "ready",
  })), false);
}

function createFakeTimers(now) {
  const entries = new Set();
  return {
    setTimeout(callback, delay) {
      const entry = { callback, dueAt: now() + delay };
      entries.add(entry);
      return entry;
    },
    clearTimeout(entry) { entries.delete(entry); },
    runDue() {
      for (const entry of [...entries]) {
        if (entry.dueAt <= now()) {
          entries.delete(entry);
          entry.callback();
        }
      }
    },
  };
}

function suppressedAnalysis(overrides = {}) {
  return {
    shouldNarrate: false,
    description: "",
    semanticKey: null,
    importance: 0,
    isNew: false,
    coveredByTabSpeech: false,
    event: null,
    ...overrides,
  };
}

function approvedAnalysis(overrides = {}) {
  return {
    shouldNarrate: true,
    description: "The scoreboard now shows Team A leading 2-1.",
    semanticKey: "score:team_a:2-1",
    importance: 0.9,
    isNew: true,
    coveredByTabSpeech: false,
    event: {
      eventType: "score_changed",
      entities: ["Team A"],
      description: "The scoreboard now shows Team A leading 2-1.",
      importance: 0.9,
      confidence: 0.95,
    },
    ...overrides,
  };
}

function semanticAnalysis(semanticKey, description) {
  return approvedAnalysis({
    description,
    semanticKey,
    event: null,
  });
}

class FakeSpeechPolicy {
  constructor() {
    this.offers = [];
  }

  offerNarration(candidate) {
    this.offers.push(candidate);
    return [];
  }
}

class FakeBrowser extends EventEmitter {
  constructor() {
    super();
    this.readyState = WebSocket.OPEN;
    this.messages = [];
    this.closed = [];
  }

  send(raw) {
    this.messages.push(JSON.parse(raw));
  }

  close(code = 1000, reason = "") {
    if (this.readyState === WebSocket.CLOSED) return;
    this.readyState = WebSocket.CLOSED;
    this.closed.push({ code, reason });
    this.emit("close", code, Buffer.from(reason));
  }
}

function rejectWhenAborted(signal) {
  return new Promise((_resolve, reject) => {
    signal.addEventListener(
      "abort",
      () => reject(signal.reason ?? new DOMException("Aborted", "AbortError")),
      { once: true }
    );
  });
}

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

function flushAsyncWork() {
  return new Promise((resolve) => setImmediate(resolve));
}

function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}
