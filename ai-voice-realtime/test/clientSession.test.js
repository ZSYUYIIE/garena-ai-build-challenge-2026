import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import test from "node:test";

import { WebSocket } from "ws";

import { EventStore } from "../src/events/eventStore.js";
import { ClientSession } from "../src/session/clientSession.js";

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
      return { shouldNarrate: false, description: "", event: null };
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

function createFixture({
  analyzeFrame = async () => ({
    shouldNarrate: false,
    description: "",
    event: null,
  }),
  answerQuestion = async () => "The frame is visible.",
  modelTurnTimeoutMs = 15_000,
} = {}) {
  const browser = new FakeBrowser();
  const eventStore = new EventStore();
  const session = new ClientSession(browser, eventStore, {
    apiKey: "test-key",
    model: "test-model",
    analyzeFrame,
    answerQuestion,
    modelTurnTimeoutMs,
  });
  return { browser, eventStore, session };
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
