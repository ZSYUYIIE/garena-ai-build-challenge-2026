import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { seedDemoHistory } from "../src/history/demoHistory.js";
import { MemoryHistoryRepository } from "../src/history/memoryHistoryRepository.js";
import { createStreamSenseServer } from "../src/server/createStreamSenseServer.js";

test("the main server exposes history APIs and the built dashboard SPA", async (t) => {
  const temporaryDirectory = fs.mkdtempSync(
    path.join(os.tmpdir(), "streamsense-dashboard-"),
  );
  fs.writeFileSync(
    path.join(temporaryDirectory, "index.html"),
    "<!doctype html><title>StreamSense History</title>",
  );
  const repository = new MemoryHistoryRepository();
  await seedDemoHistory(repository);
  const eventStore = { close() {} };
  const runtime = createStreamSenseServer({
    eventStore,
    historyRepository: repository,
    dashboardDirectory: temporaryDirectory,
    sessionFactory() {
      throw new Error("dashboard HTTP requests must not start a realtime session");
    },
  });
  t.after(async () => {
    await runtime.close();
    fs.rmSync(temporaryDirectory, { recursive: true, force: true });
  });
  const address = await runtime.listen({ host: "127.0.0.1", port: 0 });
  const baseUrl = `http://127.0.0.1:${address.port}`;

  const sessionsResponse = await fetch(`${baseUrl}/api/sessions`);
  const sessions = await sessionsResponse.json();
  assert.equal(sessionsResponse.status, 200);
  assert.equal(sessions.sessions.length, 3);

  const redirect = await fetch(`${baseUrl}/dashboard`, { redirect: "manual" });
  assert.equal(redirect.status, 308);
  assert.equal(redirect.headers.get("location"), "/dashboard/");

  const dashboardRoot = await fetch(`${baseUrl}/dashboard/`);
  assert.equal(dashboardRoot.status, 200);
  assert.match(await dashboardRoot.text(), /StreamSense History/);

  const route = await fetch(`${baseUrl}/dashboard/sessions/example`);
  assert.equal(route.status, 200);
  assert.match(await route.text(), /StreamSense History/);
});

test("default server history is empty and archive failures reach sanitized telemetry", async (t) => {
  const errors = [];
  const runtime = createStreamSenseServer({
    eventStore: { close() {} },
    onHistoryError(error) { errors.push(error); },
    sessionFactory() {
      throw new Error("HTTP history requests must not start realtime providers");
    },
  });
  t.after(() => runtime.close());
  const address = await runtime.listen({ host: "127.0.0.1", port: 0 });
  const response = await fetch(`http://127.0.0.1:${address.port}/api/sessions`);
  assert.equal(response.status, 200);
  assert.deepEqual((await response.json()).sessions, []);

  runtime.historyArchive.archiveEvent({ invalid: true });
  assert.equal(await runtime.historyArchive.drain({ timeoutMs: 500 }), true);
  assert.deepEqual(errors.map((error) => error.operation), ["archive_event"]);
});
