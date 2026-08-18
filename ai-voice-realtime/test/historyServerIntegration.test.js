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

  const healthResponse = await fetch(`${baseUrl}/api/health`);
  assert.equal(healthResponse.status, 200);
  assert.deepEqual(await healthResponse.json(), {
    service: "streamsense",
    status: "ok",
  });

  const sessionsResponse = await fetch(`${baseUrl}/api/sessions`);
  const sessions = await sessionsResponse.json();
  assert.equal(sessionsResponse.status, 200);
  assert.equal(sessions.sessions.length, 5);

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

test("development backend redirects dashboard handoffs to the Vite dashboard", async (t) => {
  const missingDashboardDirectory = path.join(
    os.tmpdir(),
    `streamsense-missing-dashboard-${Date.now()}`,
  );
  const runtime = createStreamSenseServer({
    eventStore: { close() {} },
    dashboardDirectory: missingDashboardDirectory,
    dashboardDevelopmentUrl: "http://127.0.0.1:5174/dashboard/",
    sessionFactory() {
      throw new Error("dashboard HTTP redirects must not start realtime providers");
    },
  });
  t.after(() => runtime.close());
  const address = await runtime.listen({ host: "127.0.0.1", port: 0 });
  const baseUrl = `http://127.0.0.1:${address.port}`;

  const root = await fetch(`${baseUrl}/dashboard`, { redirect: "manual" });
  assert.equal(root.status, 307);
  assert.equal(
    root.headers.get("location"),
    "http://127.0.0.1:5174/dashboard/",
  );

  const session = await fetch(
    `${baseUrl}/dashboard/sessions/11111111-1111-4111-8111-111111111111?source=extension&eventId=22222222-2222-4222-8222-222222222222&view=relationships`,
    { redirect: "manual" },
  );
  assert.equal(session.status, 307);
  assert.equal(
    session.headers.get("location"),
    "http://127.0.0.1:5174/dashboard/sessions/11111111-1111-4111-8111-111111111111?source=extension&eventId=22222222-2222-4222-8222-222222222222&view=relationships",
  );
});

test("development dashboard redirect rejects unsafe targets", () => {
  for (const dashboardDevelopmentUrl of [
    "https://example.com/dashboard/",
    "http://127.0.0.1:5174/",
    "javascript:alert(1)",
  ]) {
    assert.throws(
      () => createStreamSenseServer({
        eventStore: { close() {} },
        dashboardDevelopmentUrl,
      }),
      /DASHBOARD_DEV_URL/i,
    );
  }
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
