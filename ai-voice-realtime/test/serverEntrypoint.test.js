import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { WebSocket } from "ws";

import { createStreamSenseServer } from "../src/server/createStreamSenseServer.js";

const projectDirectory = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  ".."
);

test("server entrypoint reports its actual ephemeral port", async (t) => {
  const child = spawn(process.execPath, ["server.js"], {
    cwd: projectDirectory,
    env: {
      ...process.env,
      GOOGLE_API_KEY: "test-key",
      GEMINI_VISION_MODEL: "test-model",
      EVENT_DB_PATH: ":memory:",
      HOST: "127.0.0.1",
      PORT: "0",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  t.after(() => child.kill("SIGTERM"));

  const line = await readStartupLine(child);
  const match = /Server running on http:\/\/127\.0\.0\.1:(\d+)/.exec(line);

  assert.ok(match, line);
  assert.ok(Number(match[1]) > 0, line);
});

test("server shutdown awaits session cleanup before closing the event store", async (t) => {
  const cleanup = deferred();
  const events = [];
  const eventStore = { close() { events.push("event_store_closed"); } };
  const runtime = createStreamSenseServer({
    extensionId: "abcdefghijklmnopabcdefghijklmnop",
    eventStore,
    sessionFactory() {
      return {
        start() {},
        close() {
          events.push("session_close_started");
          return cleanup.promise;
        },
      };
    },
  });
  const address = await runtime.listen({ host: "127.0.0.1", port: 0 });
  const browser = await connect(`ws://127.0.0.1:${address.port}/ws`);
  t.after(() => browser.close());

  const closing = runtime.close();
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(events, ["session_close_started"]);
  cleanup.resolve();
  await closing;
  assert.deepEqual(events, ["session_close_started", "event_store_closed"]);
});

test("server retains a browser-closed session until delayed cleanup settles", async () => {
  const cleanup = deferred();
  const events = [];
  const eventStore = { close() { events.push("event_store_closed"); } };
  const runtime = createStreamSenseServer({
    extensionId: "abcdefghijklmnopabcdefghijklmnop",
    eventStore,
    sessionFactory(browser) {
      let closePromise;
      const session = {
        start() { browser.once("close", () => { void session.close(); }); },
        close() {
          closePromise ??= (async () => {
            events.push("session_close_started");
            await cleanup.promise;
            events.push("session_close_finished");
          })();
          return closePromise;
        },
      };
      return session;
    },
  });
  const address = await runtime.listen({ host: "127.0.0.1", port: 0 });
  const browser = await connect(`ws://127.0.0.1:${address.port}/ws`);
  const browserClosed = onceClosed(browser);
  browser.close();
  await browserClosed;
  const closing = runtime.close();
  const closedBeforeCleanup = await Promise.race([
    closing.then(() => true),
    new Promise((resolve) => setTimeout(() => resolve(false), 25)),
  ]);

  assert.equal(closedBeforeCleanup, false);
  assert.deepEqual(events, ["session_close_started"]);
  cleanup.resolve();
  await closing;
  assert.deepEqual(events, ["session_close_started", "session_close_finished", "event_store_closed"]);
});

function readStartupLine(child) {
  return new Promise((resolve, reject) => {
    let stdout = "";
    let stderr = "";
    const timeout = setTimeout(() => {
      reject(new Error(`Server startup timed out. stderr: ${stderr}`));
    }, 2_000);

    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
      const line = stdout.split("\n").find((entry) => entry.includes("Server running"));
      if (line) {
        clearTimeout(timeout);
        resolve(line);
      }
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    child.once("exit", (code, signal) => {
      clearTimeout(timeout);
      reject(
        new Error(
          `Server exited before startup (code ${code}, signal ${signal}). ${stderr}`
        )
      );
    });
  });
}

function connect(url) {
  return new Promise((resolve, reject) => {
    const browser = new WebSocket(url, {
      origin: "chrome-extension://abcdefghijklmnopabcdefghijklmnop",
    });
    browser.once("open", () => resolve(browser));
    browser.once("error", reject);
  });
}

function onceClosed(browser) {
  return new Promise((resolve) => browser.once("close", resolve));
}

function deferred() {
  let resolve;
  const promise = new Promise((resolvePromise) => { resolve = resolvePromise; });
  return { promise, resolve };
}
