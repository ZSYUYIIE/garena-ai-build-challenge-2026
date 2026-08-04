import assert from "node:assert/strict";
import test from "node:test";

import { WebSocket } from "ws";

import { MAX_WEBSOCKET_PAYLOAD_BYTES } from "../src/protocol/browserMessages.js";
import { createStreamSenseServer } from "../src/server/createStreamSenseServer.js";
import { ClientSession } from "../src/session/clientSession.js";

const TRUSTED_ORIGIN =
  "chrome-extension://abcdefghijklmnopabcdefghijklmnop";
const TRUSTED_EXTENSION_ID = "abcdefghijklmnopabcdefghijklmnop";
const OTHER_EXTENSION_ID = "bcdefghijklmnopabcdefghijklmnopa";

test("rejects missing and untrusted WebSocket origins", async (t) => {
  const { runtime, url } = await startRealRuntime();
  t.after(() => runtime.close());

  assert.equal(await rejectedUpgradeStatus(url), 403);
  assert.equal(
    await rejectedUpgradeStatus(url, "https://untrusted.example"),
    403
  );
});

test("pins real upgrades to the configured extension ID", async (t) => {
  const { runtime, url } = await startRealRuntime();
  t.after(() => runtime.close());

  assert.equal(
    await rejectedUpgradeStatus(url, `chrome-extension://${OTHER_EXTENSION_ID}`),
    403,
  );
  const browser = await connect(url);
  t.after(() => browser.close());
  assert.equal(browser.readyState, WebSocket.OPEN);
});

test("requires hello before extension commands on a real client session", async (t) => {
  const { runtime, url } = await startRealRuntime();
  t.after(() => runtime.close());
  const browser = await connect(url);
  const closed = waitForClose(browser);
  browser.send('{"type":"capture_source","source":"screen"}');
  assert.equal((await closed).code, 1008);
});

test("closes an oversized client message without stopping the server", async (t) => {
  const { runtime, url } = await startRealRuntime();
  t.after(() => runtime.close());
  const firstBrowser = await connect(url);

  const firstClose = waitForClose(firstBrowser);
  firstBrowser.send(Buffer.alloc(MAX_WEBSOCKET_PAYLOAD_BYTES + 1));
  assert.equal((await firstClose).code, 1009);

  const secondBrowser = await connect(url);
  t.after(() => secondBrowser.close());
  assert.equal(secondBrowser.readyState, WebSocket.OPEN);
});

test("isolates invalid JSON to one real client session", async (t) => {
  const { runtime, url } = await startRealRuntime();
  t.after(() => runtime.close());
  const firstBrowser = await connect(url);

  const firstClose = waitForClose(firstBrowser);
  firstBrowser.send("null");
  assert.equal((await firstClose).code, 1008);

  const secondBrowser = await connect(url);
  t.after(() => secondBrowser.close());
  assert.equal(secondBrowser.readyState, WebSocket.OPEN);
});

test("rejects binary input on a real client session", async (t) => {
  const { runtime, url } = await startRealRuntime();
  t.after(() => runtime.close());
  const browser = await connect(url);

  const closed = waitForClose(browser);
  browser.send(Buffer.from([1, 2, 3]));

  assert.equal((await closed).code, 1008);
});

test("accepts versioned microphone binary only after hello and an open activity", async (t) => {
  const microphoneWrites = [];
  const { runtime, url } = await startRealRuntime({
    sessionOptions: fakeProviderOptions({ microphoneWrites }),
  });
  t.after(() => runtime.close());
  const browser = await connect(url);
  t.after(() => browser.close());
  const connected = waitForMessageType(browser, "connected");
  const providerReady = waitForMessageType(browser, "provider_health");
  browser.send(JSON.stringify({
    type: "session_hello",
    protocolVersion: 2,
    tabAudioState: "absent",
    microphoneState: "ready",
  }));
  await Promise.all([connected, providerReady]);
  const turnId = "11111111-1111-4111-8111-111111111111";
  const turnStarted = waitForMessageType(browser, "turn_started");
  browser.send(JSON.stringify({ type: "user_activity_start", turnId }));
  browser.send(audioPacket({ source: 1, pcm: Buffer.from([1, 0, 2, 0]) }));
  browser.send(JSON.stringify({ type: "user_activity_end", turnId }));
  await turnStarted;

  assert.deepEqual(microphoneWrites, [Buffer.from([1, 0, 2, 0])]);
  assert.equal(browser.readyState, WebSocket.OPEN);
});

test("rejects wrong hello versions and every malformed binary header or payload", async (t) => {
  const { runtime, url } = await startRealRuntime({
    sessionOptions: fakeProviderOptions(),
  });
  t.after(() => runtime.close());

  const wrongHello = await connect(url);
  wrongHello.send(JSON.stringify({
    type: "session_hello",
    protocolVersion: 1,
    tabAudioState: "absent",
    microphoneState: "ready",
  }));
  assert.equal((await waitForClose(wrongHello)).code, 1008);

  const invalidPackets = [
    audioPacket({ version: 2 }),
    audioPacket({ source: 9 }),
    audioPacket({ pcm: Buffer.from([1]) }),
    audioPacket({ pcm: Buffer.alloc(1_282) }),
    audioPacket({ source: 2, pcm: Buffer.alloc(3_202) }),
  ];
  for (const packet of invalidPackets) {
    const browser = await connect(url);
    const connected = waitForMessageType(browser, "connected");
    browser.send(JSON.stringify({
      type: "session_hello",
      protocolVersion: 2,
      tabAudioState: "absent",
      microphoneState: "ready",
    }));
    await connected;
    const closed = waitForClose(browser);
    browser.send(packet);
    assert.equal((await closed).code, 1008);
  }
});

test("isolates a malicious binary client from a second active session", async (t) => {
  const { runtime, url } = await startRealRuntime({
    sessionOptions: fakeProviderOptions(),
  });
  t.after(() => runtime.close());
  const malicious = await connect(url);
  const healthy = await connect(url);
  t.after(() => healthy.close());
  for (const browser of [malicious, healthy]) {
    const connected = waitForMessageType(browser, "connected");
    browser.send(JSON.stringify({
      type: "session_hello",
      protocolVersion: 2,
      tabAudioState: "absent",
      microphoneState: "ready",
    }));
    await connected;
  }

  const maliciousClosed = waitForClose(malicious);
  malicious.send(audioPacket({ source: 7 }));
  assert.equal((await maliciousClosed).code, 1008);

  const turnId = "22222222-2222-4222-8222-222222222222";
  const startedPromise = waitForMessageType(healthy, "turn_started");
  healthy.send(JSON.stringify({ type: "typed_question", turnId, text: "Still alive?" }));
  const started = await startedPromise;
  assert.equal(started.turnId, turnId);
  assert.equal(healthy.readyState, WebSocket.OPEN);
});

test("browser close clears memory-only context and rejects late provider callbacks", async (t) => {
  let backendSession;
  let sttCallbacks;
  let liveCloseCalls = 0;
  let sttCloseCalls = 0;
  const { runtime, url } = await startRealRuntime({
    sessionFactory(browser, eventStore) {
      backendSession = new ClientSession(browser, eventStore, {
        liveSessionFactory(options) {
          return {
            async start() { options.onHealth({ state: "ready" }); },
            async close() { liveCloseCalls += 1; },
          };
        },
        transcriberFactory(options) {
          sttCallbacks = options;
          return {
            async start() { options.onHealth("ready"); },
            async close() { sttCloseCalls += 1; },
          };
        },
        speechProjectId: "project-1",
      });
      return backendSession;
    },
  });
  t.after(() => runtime.close());
  const browser = await connect(url);
  const connected = waitForMessageType(browser, "connected");
  browser.send(JSON.stringify({
    type: "session_hello",
    protocolVersion: 2,
    tabAudioState: "captured",
    microphoneState: "ready",
  }));
  await connected;
  sttCallbacks.onFinal({
    startMs: 0,
    endMs: 100,
    text: "ephemeral tab context",
    languageCode: "en-US",
  });
  assert.equal(backendSession.tabTranscriptBuffer.size, 1);

  const closed = waitForClose(browser);
  browser.close();
  await closed;
  await waitUntil(() => liveCloseCalls === 1 && sttCloseCalls === 1);
  sttCallbacks.onFinal({
    startMs: 101,
    endMs: 200,
    text: "late stale context",
    languageCode: "en-US",
  });

  assert.equal(liveCloseCalls, 1);
  assert.equal(sttCloseCalls, 1);
  assert.equal(backendSession.tabTranscriptBuffer.size, 0);
  assert.equal(backendSession.live, null);
  assert.equal(backendSession.transcriber, null);
  assert.equal(backendSession.pendingLiveFrame, null);
});

async function startRealRuntime(options = {}) {
  const runtime = createStreamSenseServer({
    apiKey: "test-key",
    model: "test-model",
    extensionId: TRUSTED_EXTENSION_ID,
    databasePath: ":memory:",
    ...options,
  });
  const address = await runtime.listen({ host: "127.0.0.1", port: 0 });
  return {
    runtime,
    url: `ws://127.0.0.1:${address.port}/ws`,
  };
}

function fakeProviderOptions({ microphoneWrites = [] } = {}) {
  return {
    liveSessionFactory(options) {
      return {
        async start() { options.onHealth({ state: "ready" }); },
        startUserActivity() {},
        endUserActivity() {},
        sendMicrophonePcm(pcm) { microphoneWrites.push(Buffer.from(pcm)); },
        askTyped() {},
        discardOutput() {},
        async close() {},
      };
    },
  };
}

function audioPacket({ version = 1, source = 1, sequence = 0, timestampMs = 0, pcm = Buffer.from([1, 0]) } = {}) {
  const packet = Buffer.alloc(10 + pcm.length);
  packet[0] = version;
  packet[1] = source;
  packet.writeUInt32LE(sequence, 2);
  packet.writeUInt32LE(timestampMs, 6);
  pcm.copy(packet, 10);
  return packet;
}

function waitForMessageType(browser, expectedType) {
  return new Promise((resolve, reject) => {
    const onMessage = (raw) => {
      const message = JSON.parse(raw.toString());
      if (message.type !== expectedType) return;
      browser.off("error", onError);
      browser.off("message", onMessage);
      resolve(message);
    };
    const onError = (error) => {
      browser.off("message", onMessage);
      reject(error);
    };
    browser.on("message", onMessage);
    browser.once("error", onError);
  });
}

function connect(url, origin = TRUSTED_ORIGIN) {
  return new Promise((resolve, reject) => {
    const browser = new WebSocket(url, { origin });
    browser.once("open", () => resolve(browser));
    browser.once("error", reject);
  });
}

function rejectedUpgradeStatus(url, origin) {
  return new Promise((resolve, reject) => {
    const options = origin ? { origin } : undefined;
    const browser = new WebSocket(url, options);
    browser.once("unexpected-response", (_request, response) => {
      const statusCode = response.statusCode;
      response.resume();
      resolve(statusCode);
    });
    browser.once("open", () => {
      browser.close();
      reject(new Error("WebSocket upgrade unexpectedly succeeded."));
    });
    browser.once("error", () => undefined);
  });
}

function waitForClose(browser) {
  return new Promise((resolve) => {
    browser.once("close", (code, reason) => {
      resolve({ code, reason: reason.toString() });
    });
  });
}

async function waitUntil(predicate) {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    if (predicate()) return;
    await new Promise((resolve) => setImmediate(resolve));
  }
  assert.fail("Timed out waiting for the backend session lifecycle.");
}
