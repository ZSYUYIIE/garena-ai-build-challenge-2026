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
  const child = spawnServer();
  t.after(() => child.kill("SIGTERM"));

  const startup = await readStartup(child);
  const match = /Server running on http:\/\/127\.0\.0\.1:(\d+)/.exec(
    startup.stdout,
  );

  assert.ok(match, startup.stdout);
  assert.ok(Number(match[1]) > 0, startup.stdout);
});

test("auto Mongo mode starts with sanitized non-durable Memory after connection failure", async (t) => {
  const child = spawnServer({
    MONGODB_URI:
      "mongodb://127.0.0.1:1/?serverSelectionTimeoutMS=100",
    STREAMSENSE_HISTORY_MODE: "auto",
  });
  t.after(() => child.kill("SIGTERM"));

  const startup = await readStartup(child);
  assert.match(startup.stdout, /Memory history provider: memory \(non-durable\)/i);
  assert.match(startup.stderr, /MongoDB connection unavailable/i);
  assert.match(startup.stderr, /Network Access\/IP allowlisting|timed out or was refused/i);
  assert.doesNotMatch(
    `${startup.stdout}\n${startup.stderr}`,
    /mongodb:\/\//i,
  );
});

test("explicit Mongo mode exits early with an actionable sanitized error", async () => {
  const child = spawnServer({
    MONGODB_URI:
      "mongodb://127.0.0.1:1/?serverSelectionTimeoutMS=100",
    STREAMSENSE_HISTORY_MODE: "mongodb",
  });
  const result = await readExit(child);

  assert.equal(result.code, 1);
  assert.match(result.stderr, /MongoDB connection failed/i);
  assert.match(result.stderr, /Network Access\/IP allowlisting|timed out or was refused/i);
  assert.doesNotMatch(
    `${result.stdout}\n${result.stderr}`,
    /mongodb:\/\/|MongoServerSelectionError|\bat .+\(.+\.js:/i,
  );
});

test("server shutdown awaits session cleanup before closing the event store", async (t) => {
  const cleanup = deferred();
  const events = [];
  const eventStore = { close() { events.push("event_store_closed"); } };
  const runtime = createStreamSenseServer({
    extensionId: "abcdefghijklmnopabcdefghijklmnop",
    eventStore,
    closeContextStore() {
      events.push("context_store_closed");
    },
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
  assert.deepEqual(events, [
    "session_close_started",
    "context_store_closed",
    "event_store_closed",
  ]);
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

function spawnServer(environment = {}) {
  return spawn(process.execPath, ["server.js"], {
    cwd: projectDirectory,
    env: {
      ...process.env,
      GOOGLE_API_KEY: "test-key",
      GEMINI_VISION_MODEL: "test-model",
      EVENT_DB_PATH: ":memory:",
      MONGODB_URI: "",
      MONGODB_DB_NAME: "",
      HOST: "127.0.0.1",
      PORT: "0",
      ...environment,
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
}

function readStartup(child) {
  return new Promise((resolve, reject) => {
    let stdout = "";
    let stderr = "";
    const timeout = setTimeout(() => {
      reject(new Error(`Server startup timed out. stderr: ${stderr}`));
    }, 5_000);

    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
      const line = stdout.split("\n").find((entry) => entry.includes("Server running"));
      if (line) {
        clearTimeout(timeout);
        resolve({ stdout, stderr });
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

function readExit(child) {
  return new Promise((resolve, reject) => {
    let stdout = "";
    let stderr = "";
    const timeout = setTimeout(() => {
      child.kill("SIGTERM");
      reject(new Error(`Server exit timed out. stdout: ${stdout}; stderr: ${stderr}`));
    }, 5_000);
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.once("error", reject);
    child.once("exit", (code, signal) => {
      clearTimeout(timeout);
      resolve({ code, signal, stdout, stderr });
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
