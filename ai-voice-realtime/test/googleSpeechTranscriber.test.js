import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import test from "node:test";

import { GoogleSpeechTranscriber } from "../src/stt/googleSpeechTranscriber.js";
import { TabTranscriptBuffer } from "../src/transcript/tabTranscriptBuffer.js";

class FakeTimers {
  #now = 0;
  #nextId = 1;
  #jobs = new Map();

  setTimeout = (callback, delay) => {
    const id = this.#nextId++;
    this.#jobs.set(id, { callback, at: this.#now + delay });
    return id;
  };

  clearTimeout = (id) => this.#jobs.delete(id);

  advance(ms) {
    const target = this.#now + ms;
    while (true) {
      const next = [...this.#jobs.entries()]
        .filter(([, job]) => job.at <= target)
        .sort(([, left], [, right]) => left.at - right.at)[0];
      if (!next) break;
      const [id, job] = next;
      this.#jobs.delete(id);
      this.#now = job.at;
      job.callback();
    }
    this.#now = target;
  }

  get pending() {
    return this.#jobs.size;
  }
}

class FakeStream extends EventEmitter {
  writes = [];
  endCalls = 0;
  destroyCalls = 0;
  writeResults = [];
  throwOnWrite = false;

  write(message) {
    if (this.throwOnWrite) throw new Error("synchronous stream write failure");
    this.writes.push(message);
    return this.writeResults.shift() ?? true;
  }

  end(callback) {
    this.endCalls += 1;
    callback?.();
  }

  destroy() {
    this.destroyCalls += 1;
  }
}

class FakeSpeechClient {
  static instances = [];
  static streamSetup = null;

  constructor(options) {
    this.options = options;
    this.streams = [];
    this.closeCalls = 0;
    FakeSpeechClient.instances.push(this);
  }

  _streamingRecognize() {
    const stream = new FakeStream();
    this.streams.push(stream);
    FakeSpeechClient.streamSetup?.(stream, this.streams.length - 1);
    return stream;
  }

  async close() {
    this.closeCalls += 1;
  }
}

function makeTranscriber(options = {}) {
  FakeSpeechClient.instances = [];
  const finals = [];
  const interims = [];
  const speechStates = [];
  const health = [];
  const healthMessages = [];
  const timers = options.timers ?? new FakeTimers();
  FakeSpeechClient.streamSetup = options.streamSetup ?? null;
  const transcriber = new GoogleSpeechTranscriber({
    SpeechClient: FakeSpeechClient,
    projectId: "project-1",
    location: "us",
    timers,
    onFinal: (segment) => finals.push(segment),
    onInterim: (text) => interims.push(text),
    onSpeechState: (active) => speechStates.push(active),
    onHealth: (state, message) => {
      health.push(state);
      healthMessages.push(message);
    },
    ...options,
  });
  return { transcriber, finals, interims, speechStates, health, healthMessages, timers };
}

function result({
  isFinal,
  alternatives,
  languageCode = "en-US",
  seconds = 0,
  nanos = 0,
}) {
  return {
    isFinal,
    alternatives,
    languageCode,
    resultEndOffset: { seconds, nanos },
  };
}

test("sends V2 Chirp configuration before dedicated tab PCM and maps every usable result", async () => {
  const { transcriber, finals, interims, speechStates, health } = makeTranscriber();
  await transcriber.start();
  const [client] = FakeSpeechClient.instances;
  const [stream] = client.streams;

  assert.deepEqual(client.options, { apiEndpoint: "us-speech.googleapis.com" });
  assert.deepEqual(stream.writes[0], {
    recognizer: "projects/project-1/locations/us/recognizers/_",
    streamingConfig: {
      config: {
        explicitDecodingConfig: {
          encoding: "LINEAR16",
          sampleRateHertz: 16_000,
          audioChannelCount: 1,
        },
        languageCodes: ["auto"],
        model: "chirp_3",
        features: { enableAutomaticPunctuation: true },
      },
      streamingFeatures: {
        interimResults: true,
        enableVoiceActivityEvents: true,
      },
    },
  });

  const pcm = Buffer.alloc(3_200, 7);
  assert.equal(transcriber.write(pcm, 1_000), "accepted");
  assert.deepEqual(stream.writes[1], { audio: pcm });
  stream.emit("data", {
    speechEventType: "SPEECH_ACTIVITY_BEGIN",
    speechEventOffset: { seconds: 0, nanos: 250_000_000 },
    results: [
      result({ isFinal: false, alternatives: [{ transcript: "" }, { transcript: "interim text" }] }),
      result({
        isFinal: true,
        alternatives: [{ transcript: "" }, { transcript: "first final" }],
        languageCode: "fr-CA",
        seconds: 1,
        nanos: 750_000_000,
      }),
      result({
        isFinal: true,
        alternatives: [{ transcript: "second final" }],
        languageCode: "de-DE",
        seconds: 2,
      }),
    ],
  });
  stream.emit("data", { speechEventType: "SPEECH_ACTIVITY_END" });

  assert.deepEqual(interims, ["interim text"]);
  assert.deepEqual(finals, [
    { startMs: 1_250, endMs: 2_750, text: "first final", languageCode: "fr-CA" },
    { startMs: 2_750, endMs: 3_000, text: "second final", languageCode: "de-DE" },
  ]);
  assert.deepEqual(speechStates, [true, false]);
  assert.deepEqual(health, ["connecting", "ready"]);

  await transcriber.close();
  assert.equal(stream.endCalls, 1);
  assert.equal(stream.destroyCalls, 0);
  assert.equal(client.closeCalls, 1);
  assert.equal(transcriber.health, "closed");
});

test("uses first accepted backend-clock sample including bridge replay as a stream origin", async () => {
  const timers = new FakeTimers();
  const { transcriber, finals } = makeTranscriber({ timers, rotateAfterMs: 100 });
  await transcriber.start();
  const firstStream = FakeSpeechClient.instances[0].streams[0];
  const bridgePcm = Buffer.alloc(16_000, 1);
  transcriber.write(bridgePcm, 5_000);
  timers.advance(100);

  const replacement = FakeSpeechClient.instances[0].streams[1];
  assert.deepEqual(replacement.writes[1], { audio: bridgePcm });
  replacement.emit("data", {
    speechEventType: "SPEECH_ACTIVITY_BEGIN",
    speechEventOffset: { seconds: 0, nanos: 100_000_000 },
    results: [result({
      isFinal: true,
      alternatives: [{ transcript: "bridged final" }],
      seconds: 1,
      nanos: 200_000_000,
    })],
  });

  assert.deepEqual(finals, [
    { startMs: 5_100, endMs: 6_200, text: "bridged final", languageCode: "en-US" },
  ]);
  assert.equal(firstStream.endCalls, 1);
  await transcriber.close();
});

test("replays the complete bounded bridge once in original PCM order", async () => {
  const timers = new FakeTimers();
  const { transcriber } = makeTranscriber({ timers, rotateAfterMs: 100 });
  await transcriber.start();
  const chunks = [1, 2, 3, 4, 5].map((fill) => Buffer.alloc(3_200, fill));
  chunks.forEach((pcm, index) => transcriber.write(pcm, 1_000 + (index * 100)));
  timers.advance(100);

  const replacement = FakeSpeechClient.instances[0].streams[1];
  assert.deepEqual(replacement.writes.slice(1), chunks.map((audio) => ({ audio })));
  await transcriber.close();
});

test("deduplicates a final segment repeated by the 500 ms rotation bridge", async () => {
  const timers = new FakeTimers();
  const { transcriber, finals } = makeTranscriber({ timers, rotateAfterMs: 285_000 });
  await transcriber.start();
  const pcm = Buffer.alloc(16_000, 4);
  transcriber.write(pcm, 284_500);
  const first = FakeSpeechClient.instances[0].streams[0];
  first.emit("data", { results: [result({
    isFinal: true,
    alternatives: [{ transcript: "the winning goal" }],
    seconds: 0,
    nanos: 500_000_000,
  })] });

  timers.advance(285_000);
  const replacement = FakeSpeechClient.instances[0].streams[1];
  replacement.emit("data", { results: [result({
    isFinal: true,
    alternatives: [{ transcript: "the winning goal" }],
    seconds: 0,
    nanos: 500_000_000,
  })] });

  assert.deepEqual(finals, [{
    startMs: 284_500,
    endMs: 285_000,
    text: "the winning goal",
    languageCode: "en-US",
  }]);
  await transcriber.close();
});

test("deduplicates normalized overlapping bridge finals but keeps later repeated words", async () => {
  const timers = new FakeTimers();
  const { transcriber, finals } = makeTranscriber({ timers, rotateAfterMs: 285_000 });
  await transcriber.start();
  transcriber.write(Buffer.alloc(16_000, 4), 284_500);
  const first = FakeSpeechClient.instances[0].streams[0];
  first.emit("data", { results: [result({
    isFinal: true,
    alternatives: [{ transcript: "The winning goal" }],
    seconds: 0,
    nanos: 500_000_000,
  })] });

  timers.advance(285_000);
  const replacement = FakeSpeechClient.instances[0].streams[1];
  replacement.emit("data", {
    speechEventType: "SPEECH_ACTIVITY_BEGIN",
    speechEventOffset: { seconds: 0, nanos: 1_000_000 },
    results: [result({
      isFinal: true,
      alternatives: [{ transcript: "  THE   winning\n goal  " }],
      seconds: 0,
      nanos: 501_000_000,
    })],
  });
  replacement.emit("data", {
    speechEventType: "SPEECH_ACTIVITY_BEGIN",
    speechEventOffset: { seconds: 0, nanos: 500_000_000 },
    results: [result({
      isFinal: true,
      alternatives: [{ transcript: "the winning goal" }],
      seconds: 1,
      nanos: 200_000_000,
    })],
  });

  assert.deepEqual(finals, [
    {
      startMs: 284_500,
      endMs: 285_000,
      text: "The winning goal",
      languageCode: "en-US",
    },
    {
      startMs: 285_000,
      endMs: 285_700,
      text: "the winning goal",
      languageCode: "en-US",
    },
  ]);
  await transcriber.close();
});

test("does not send bridge or live PCM until a config-backpressured stream drains", async () => {
  const { transcriber } = makeTranscriber({
    streamSetup: (stream) => { stream.writeResults = [false]; },
  });
  await transcriber.start();
  const stream = FakeSpeechClient.instances[0].streams[0];
  const pcm = Buffer.alloc(3_200, 6);

  assert.equal(transcriber.write(pcm, 1_000), "backpressured");
  assert.equal(stream.writes.length, 1);
  stream.emit("drain");
  assert.deepEqual(stream.writes.slice(1), [{ audio: pcm }]);
  await transcriber.close();
});

test("buffers at most one second of tab PCM while waiting for provider drain", async () => {
  const { transcriber } = makeTranscriber({
    streamSetup: (stream) => { stream.writeResults = [false]; },
  });
  await transcriber.start();
  const stream = FakeSpeechClient.instances[0].streams[0];
  for (let index = 0; index < 10; index += 1) {
    assert.equal(transcriber.write(Buffer.alloc(3_200, index), index * 100), "backpressured");
  }
  assert.equal(transcriber.health, "ready");
  assert.equal(transcriber.write(Buffer.alloc(3_200, 10), 1_000), "degraded");
  assert.equal(transcriber.health, "degraded");
  assert.equal(stream.destroyCalls, 1);
  await transcriber.close();
});

test("preserves every pending bridge chunk across false-write drain boundaries before live audio", async () => {
  const timers = new FakeTimers();
  const { transcriber } = makeTranscriber({
    timers,
    rotateAfterMs: 100,
    streamSetup: (stream, index) => {
      if (index === 1) stream.writeResults = [true, false, false, true, true];
    },
  });
  await transcriber.start();
  const bridge = [1, 2, 3].map((fill) => Buffer.alloc(3_200, fill));
  bridge.forEach((pcm, index) => transcriber.write(pcm, 1_000 + (index * 100)));
  timers.advance(100);

  const replacement = FakeSpeechClient.instances[0].streams[1];
  const live = Buffer.alloc(3_200, 9);
  assert.equal(transcriber.write(live, 2_000), "backpressured");
  assert.deepEqual(replacement.writes.slice(1), [{ audio: bridge[0] }]);
  replacement.emit("drain");
  assert.deepEqual(replacement.writes.slice(1), [{ audio: bridge[0] }, { audio: bridge[1] }]);
  replacement.emit("drain");
  assert.deepEqual(
    replacement.writes.slice(1),
    [...bridge, live].map((audio) => ({ audio })),
  );
  await transcriber.close();
});

test("does not publish inactive while a replacement stream remains Cloud-speech active", async () => {
  const timers = new FakeTimers();
  const { transcriber, speechStates } = makeTranscriber({ timers, rotateAfterMs: 100 });
  await transcriber.start();
  const oldStream = FakeSpeechClient.instances[0].streams[0];
  transcriber.write(Buffer.alloc(3_200), 1_000);
  oldStream.emit("data", { speechEventType: "SPEECH_ACTIVITY_BEGIN" });
  timers.advance(100);

  const replacement = FakeSpeechClient.instances[0].streams[1];
  replacement.emit("data", { speechEventType: "SPEECH_ACTIVITY_BEGIN" });
  oldStream.emit("data", { speechEventType: "SPEECH_ACTIVITY_END" });
  assert.deepEqual(speechStates, [true]);
  replacement.emit("data", { speechEventType: "SPEECH_ACTIVITY_END" });
  assert.deepEqual(speechStates, [true, false]);
  await transcriber.close();
});

test("keeps transcript eviction on the backend clock despite an unrelated extension timestamp", async () => {
  let backendNow = 0;
  const buffer = new TabTranscriptBuffer({ nowBackendSessionMs: () => backendNow });
  const { transcriber, finals } = makeTranscriber();
  await transcriber.start();
  const stream = FakeSpeechClient.instances[0].streams[0];

  // A delayed hello's packet timestamp is not supplied to STT: only this
  // backend acceptance time is valid for transcript/policy/frame clocks.
  transcriber.write(Buffer.alloc(3_200), 4_000);
  stream.emit("data", { results: [result({
    isFinal: true,
    alternatives: [{ transcript: "backend clock only" }],
    seconds: 1,
  })] });
  buffer.appendFinal(finals[0]);
  backendNow = 124_999;
  assert.equal(buffer.getRecent({ lookbackMs: 120_000 }).segments.length, 1);
  backendNow = 125_001;
  assert.equal(buffer.getRecent({ lookbackMs: 120_000 }).segments.length, 0);
  await transcriber.close();
});

test("queues ordered tab PCM for drain and degrades safely on discontinuity", async () => {
  const { transcriber, health } = makeTranscriber();
  await transcriber.start();
  const stream = FakeSpeechClient.instances[0].streams[0];
  const first = Buffer.alloc(3_200, 1);
  const second = Buffer.alloc(3_200, 2);
  const third = Buffer.alloc(3_200, 3);
  stream.writeResults = [true, false];
  transcriber.write(first, 10);
  assert.equal(transcriber.write(second, 110), "backpressured");
  assert.equal(transcriber.write(third, 210), "backpressured");
  assert.equal(stream.writes.length, 3);
  stream.emit("drain");
  assert.deepEqual(stream.writes.slice(1).map(({ audio }) => audio), [first, second, third]);

  await transcriber.markDiscontinuity("browser dropped tab audio");
  assert.equal(transcriber.health, "degraded");
  assert.equal(stream.destroyCalls, 1);
  assert.deepEqual(health.at(-1), "degraded");
  await transcriber.close();
});

test("retries provider failures at 250, 500, and 1000 milliseconds then remains degraded", async () => {
  const timers = new FakeTimers();
  const { transcriber, health } = makeTranscriber({ timers });
  await transcriber.start();
  let stream = FakeSpeechClient.instances[0].streams[0];

  stream.emit("error", new Error("transient"));
  timers.advance(249);
  assert.equal(FakeSpeechClient.instances[0].streams.length, 1);
  timers.advance(1);
  stream = FakeSpeechClient.instances[0].streams[1];
  stream.emit("error", new Error("transient"));
  timers.advance(500);
  stream = FakeSpeechClient.instances[0].streams[2];
  stream.emit("error", new Error("transient"));
  timers.advance(1_000);
  stream = FakeSpeechClient.instances[0].streams[3];
  stream.emit("error", new Error("transient"));

  assert.equal(FakeSpeechClient.instances[0].streams.length, 4);
  assert.equal(transcriber.health, "degraded");
  assert.equal(timers.pending, 0);
  assert.deepEqual(health.filter((state) => state === "ready"), ["ready", "ready", "ready", "ready"]);
  await transcriber.close();
});

test("resets the retry budget after each provider-confirmed stable stream", async () => {
  const timers = new FakeTimers();
  const { transcriber } = makeTranscriber({ timers });
  await transcriber.start();
  const client = FakeSpeechClient.instances[0];

  for (let failure = 0; failure < 4; failure += 1) {
    const stream = client.streams.at(-1);
    stream.emit("metadata", {});
    stream.emit("error", new Error("isolated transient"));
    timers.advance(249);
    assert.equal(client.streams.length, failure + 1);
    timers.advance(1);
    assert.equal(client.streams.length, failure + 2);
  }

  assert.equal(transcriber.health, "ready");
  await transcriber.close();
});

test("ignores stability signals from a retiring stream when preserving the active retry budget", async () => {
  const timers = new FakeTimers();
  const { transcriber } = makeTranscriber({ timers, rotateAfterMs: 100 });
  await transcriber.start();
  const client = FakeSpeechClient.instances[0];

  client.streams[0].emit("error", new Error("consume first retry"));
  timers.advance(250);
  const retiring = client.streams[1];
  timers.advance(100);
  const active = client.streams[2];

  retiring.emit("metadata", {});
  retiring.emit("data", { results: [] });
  active.emit("error", new Error("active stream failed before stability"));
  timers.advance(499);
  assert.equal(client.streams.length, 3);
  timers.advance(1);
  assert.equal(client.streams.length, 4);

  await transcriber.close();
});

test("flushes timestamped tab PCM buffered during a reconnect and cancels recovery on close", async () => {
  const timers = new FakeTimers();
  const { transcriber } = makeTranscriber({ timers });
  await transcriber.start();
  const failed = FakeSpeechClient.instances[0].streams[0];
  const pcm = Buffer.alloc(3_200, 9);
  failed.emit("error", new Error("temporary"));
  assert.equal(transcriber.write(pcm, 7_000), "backpressured");
  timers.advance(250);

  const recovered = FakeSpeechClient.instances[0].streams[1];
  assert.deepEqual(recovered.writes[1], { audio: pcm });
  await transcriber.close();
  timers.advance(10_000);
  assert.equal(FakeSpeechClient.instances[0].streams.length, 2);
});

test("is safely degraded with a sanitized missing-project diagnostic and never opens a provider client", async () => {
  const { transcriber, health, healthMessages } = makeTranscriber({ projectId: "" });
  await transcriber.start();
  assert.equal(FakeSpeechClient.instances.length, 0);
  assert.equal(transcriber.health, "degraded");
  assert.deepEqual(health, ["degraded"]);
  assert.match(healthMessages[0], /missing GOOGLE_CLOUD_PROJECT/i);
  assert.doesNotMatch(healthMessages[0], /pcm|transcript|credential|secret/i);
  await transcriber.close();
});

test("destroys a record when its first config write throws and retries without leaking it", async () => {
  const timers = new FakeTimers();
  const { transcriber } = makeTranscriber({
    timers,
    streamSetup: (stream, index) => { if (index === 0) stream.throwOnWrite = true; },
  });
  await transcriber.start();
  const failed = FakeSpeechClient.instances[0].streams[0];

  assert.equal(failed.destroyCalls, 1);
  assert.equal(failed.endCalls, 0);
  assert.equal(transcriber.health, "degraded");
  timers.advance(250);
  assert.equal(FakeSpeechClient.instances[0].streams.length, 2);
  await transcriber.close();
  assert.equal(failed.destroyCalls, 1);
});

test("contains a synchronous provider audio-write failure and enters bounded recovery", async () => {
  const timers = new FakeTimers();
  const { transcriber } = makeTranscriber({ timers });
  await transcriber.start();
  const failed = FakeSpeechClient.instances[0].streams[0];
  failed.throwOnWrite = true;

  assert.equal(transcriber.write(Buffer.alloc(3_200), 1_000), "degraded");
  assert.equal(failed.destroyCalls, 1);
  assert.equal(transcriber.health, "degraded");
  timers.advance(250);
  assert.equal(FakeSpeechClient.instances[0].streams.length, 2);
  await transcriber.close();
});

test("owns a failed rotation replacement without destroying the old stream before recovery", async () => {
  const timers = new FakeTimers();
  const { transcriber } = makeTranscriber({
    timers,
    rotateAfterMs: 100,
    streamSetup: (stream, index) => { if (index === 1) stream.throwOnWrite = true; },
  });
  await transcriber.start();
  const client = FakeSpeechClient.instances[0];
  const oldStream = client.streams[0];
  transcriber.write(Buffer.alloc(3_200), 1_000);
  timers.advance(100);

  const failedReplacement = client.streams[1];
  assert.equal(failedReplacement.destroyCalls, 1);
  assert.equal(failedReplacement.endCalls, 0);
  assert.equal(oldStream.destroyCalls, 0);
  assert.equal(oldStream.endCalls, 0);
  assert.equal(transcriber.health, "degraded");
  timers.advance(250);
  assert.equal(client.streams.length, 3);
  assert.equal(oldStream.endCalls, 1);

  await transcriber.close();
  await transcriber.close();
  assert.equal(failedReplacement.destroyCalls, 1);
  assert.equal(client.closeCalls, 1);
});
