import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import test from "node:test";

import { WebSocket } from "ws";

import { EventStore } from "../src/events/eventStore.js";
import { ClientSession } from "../src/session/clientSession.js";
import { SpeechPolicy } from "../src/session/speechPolicy.js";

test("closes malformed and non-object JSON as a client policy violation", async () => {
  for (const raw of ["{", "null", "[]"]) {
    const fixture = createFixture();
    await fixture.session.start();

    fixture.browser.emit("message", Buffer.from(raw), false);

    assert.equal(fixture.browser.closed[0]?.code, 1008, raw);
    fixture.eventStore.close();
  }
});

test("closes binary extension commands as unsupported data", async (t) => {
  const fixture = createFixture();
  t.after(() => fixture.eventStore.close());
  await fixture.session.start();

  fixture.browser.emit("message", Buffer.from([1, 2, 3]), true);

  assert.equal(fixture.browser.closed[0]?.code, 1003);
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

test("aborts a narration request when a question replaces it", async (t) => {
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

  assert.equal(narrationSignal?.aborted, true);
  assert.equal(
    fixture.browser.messages.some(
      (message) =>
        message.type === "turn_complete" && message.interrupted === true
    ),
    true
  );
  assert.equal(
    fixture.browser.messages.some((message) => message.type === "analysis_error"),
    false
  );
  fixture.session.close();
});

test("aborts a timed-out request without reporting a Gemini failure", async (t) => {
  let requestSignal;
  const fixture = createFixture({
    modelTurnTimeoutMs: 5,
    analyzeFrame({ signal }) {
      requestSignal = signal;
      return rejectWhenAborted(signal);
    },
  });
  t.after(() => fixture.eventStore.close());
  fixture.session.sendVideo(Buffer.from("frame"), "image/jpeg", 2);

  fixture.session.requestNarration(false);
  await delay(25);

  assert.equal(requestSignal?.aborted, true);
  assert.equal(
    fixture.browser.messages.some(
      (message) =>
        message.type === "turn_complete" && message.interrupted === true
    ),
    true
  );
  assert.equal(
    fixture.browser.messages.some((message) => message.type === "analysis_error"),
    false
  );
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
        message.text === "provider unavailable"
    ),
    true
  );
  assert.equal(
    fixture.browser.messages.some(
      (message) =>
        message.type === "turn_complete" && message.interrupted === false
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
  assert.deepEqual(speechPolicy.offers, []);
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
  assert.deepEqual(speechPolicy.offers, []);
  fixture.session.close();
});

function createFixture({
  analyzeFrame = async () => suppressedAnalysis(),
  answerQuestion = async () => "The frame is visible.",
  modelTurnTimeoutMs = 15_000,
  now,
  recentTabTranscript,
  speechPolicy,
} = {}) {
  const browser = new FakeBrowser();
  const eventStore = new EventStore();
  const session = new ClientSession(browser, eventStore, {
    apiKey: "test-key",
    model: "test-model",
    analyzeFrame,
    answerQuestion,
    modelTurnTimeoutMs,
    now,
    recentTabTranscript,
    speechPolicy,
  });
  return { browser, eventStore, session };
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
