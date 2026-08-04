import assert from "node:assert/strict";
import test from "node:test";

import { WebSocket } from "ws";

import { MAX_WEBSOCKET_PAYLOAD_BYTES } from "../src/protocol/browserMessages.js";
import { createStreamSenseServer } from "../src/server/createStreamSenseServer.js";

const TRUSTED_ORIGIN =
  "chrome-extension://abcdefghijklmnopabcdefghijklmnop";

test("rejects missing and untrusted WebSocket origins", async (t) => {
  const { runtime, url } = await startTestRuntime();
  t.after(() => runtime.close());

  assert.equal(await rejectedUpgradeStatus(url), 403);
  assert.equal(
    await rejectedUpgradeStatus(url, "https://untrusted.example"),
    403
  );
});

test("connects an extension-origin client to a browser session", async (t) => {
  const { runtime, url } = await startTestRuntime();
  t.after(() => runtime.close());
  const browser = await connect(url);
  t.after(() => browser.close());

  const reply = new Promise((resolve, reject) => {
    browser.once("message", (raw) => resolve(JSON.parse(raw.toString())));
    browser.once("error", reject);
  });
  browser.send('{"type":"capture_source","source":"screen"}');

  assert.deepEqual(await reply, { type: "test_ack" });
});

test("closes an oversized client message without stopping the server", async (t) => {
  const { runtime, url } = await startTestRuntime();
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

  assert.equal((await closed).code, 1003);
});

async function startTestRuntime() {
  const runtime = createStreamSenseServer({
    databasePath: ":memory:",
    sessionFactory(browser) {
      let onMessage;
      return {
        start() {
          onMessage = () => {
            if (browser.readyState === WebSocket.OPEN) {
              browser.send(JSON.stringify({ type: "test_ack" }));
            }
          };
          browser.on("message", onMessage);
        },
        close() {
          if (onMessage) browser.off("message", onMessage);
          if (browser.readyState === WebSocket.OPEN) browser.close();
        },
      };
    },
  });
  const address = await runtime.listen({ host: "127.0.0.1", port: 0 });
  return {
    runtime,
    url: `ws://127.0.0.1:${address.port}/ws`,
  };
}

async function startRealRuntime() {
  const runtime = createStreamSenseServer({
    apiKey: "test-key",
    model: "test-model",
    databasePath: ":memory:",
  });
  const address = await runtime.listen({ host: "127.0.0.1", port: 0 });
  return {
    runtime,
    url: `ws://127.0.0.1:${address.port}/ws`,
  };
}

function connect(url) {
  return new Promise((resolve, reject) => {
    const browser = new WebSocket(url, { origin: TRUSTED_ORIGIN });
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
