import assert from "node:assert/strict";
import http from "node:http";
import test from "node:test";

import express from "express";

import {
  createDemoHistory,
  createDemoSemanticResults,
  seedDemoHistory,
} from "../src/history/demoHistory.js";
import { createHistoryRouter } from "../src/history/historyRouter.js";
import { HistoryService } from "../src/history/historyService.js";
import { MemoryHistoryRepository } from "../src/history/memoryHistoryRepository.js";
import {
  DemoSemanticHistoryService,
  UnavailableSemanticHistoryService,
} from "../src/history/semanticHistoryService.js";

test("history API lists, details, and chronologically paginates demo sessions", async (t) => {
  const fixture = await createApiFixture();
  t.after(() => fixture.close());

  const firstResponse = await fetch(`${fixture.url}/api/sessions?limit=2`);
  const first = await firstResponse.json();
  assert.equal(firstResponse.status, 200);
  assert.equal(firstResponse.headers.get("cache-control"), "no-store");
  assert.equal(first.meta.dataOrigin, "demo");
  assert.equal(first.sessions.length, 2);
  assert.ok(first.nextCursor);
  assert.equal("dataOrigin" in first.sessions[0], false);

  const second = await getJson(
    `${fixture.url}/api/sessions?limit=2&cursor=${encodeURIComponent(first.nextCursor)}`,
  );
  assert.equal(second.body.sessions.length, 1);
  assert.equal(second.body.nextCursor, null);

  const sessionId = first.sessions[0].sessionId;
  const detail = await getJson(`${fixture.url}/api/sessions/${sessionId}`);
  assert.equal(detail.status, 200);
  assert.equal(detail.body.session.sessionId, sessionId);
  assert.ok(detail.body.session.summary.length > 20);

  const eventsFirst = await getJson(
    `${fixture.url}/api/sessions/${sessionId}/events?limit=4`,
  );
  const eventsSecond = await getJson(
    `${fixture.url}/api/sessions/${sessionId}/events?limit=4&cursor=${encodeURIComponent(eventsFirst.body.nextCursor)}`,
  );
  const timestamps = [...eventsFirst.body.events, ...eventsSecond.body.events]
    .map((event) => event.timestampSeconds);
  assert.deepEqual(timestamps, timestamps.toSorted((left, right) => left - right));
  assert.equal(eventsFirst.body.events.every((event) => event.sessionId === sessionId), true);
});

test("history API validates IDs, limits, filters, cursors, and missing sessions", async (t) => {
  const fixture = await createApiFixture();
  t.after(() => fixture.close());
  const demo = createDemoHistory();

  const invalidId = await getJson(`${fixture.url}/api/sessions/not-a-uuid`);
  assert.equal(invalidId.status, 400);
  assert.equal(invalidId.body.error.code, "INVALID_REQUEST");

  const missing = await getJson(
    `${fixture.url}/api/sessions/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa`,
  );
  assert.equal(missing.status, 404);
  assert.equal(missing.body.error.code, "SESSION_NOT_FOUND");

  const invalidLimit = await getJson(`${fixture.url}/api/sessions?limit=0`);
  assert.equal(invalidLimit.status, 400);

  const invalidCursor = await getJson(`${fixture.url}/api/sessions?cursor=broken`);
  assert.equal(invalidCursor.status, 400);
  assert.equal(invalidCursor.body.error.code, "INVALID_CURSOR");

  const goals = await getJson(
    `${fixture.url}/api/sessions/${demo.sessions[0].sessionId}/events?eventType=goal`,
  );
  assert.equal(goals.status, 200);
  assert.equal(goals.body.events.length, 2);
  assert.equal(goals.body.events.every((event) => event.eventType === "goal"), true);

  const exactEvent = demo.events.find(
    (event) => event.sessionId === demo.sessions[0].sessionId,
  );
  const exact = await getJson(
    `${fixture.url}/api/sessions/${demo.sessions[0].sessionId}/events?eventId=${exactEvent.id}`,
  );
  assert.deepEqual(exact.body.events.map((event) => event.id), [exactEvent.id]);
});

test("semantic and context graph API contracts degrade independently of history", async (t) => {
  const fixture = await createApiFixture();
  t.after(() => fixture.close());
  const demo = createDemoHistory();

  const search = await postJson(`${fixture.url}/api/search`, {
    query: "similar attacking opportunities",
    limit: 2,
  });
  assert.equal(search.status, 200);
  assert.equal(search.body.retrievalMode, "semantic");
  assert.equal(search.body.results.length, 2);
  assert.equal(search.body.results.every((result) => result.similarity <= 1), true);

  const differentSearch = await postJson(`${fixture.url}/api/search`, {
    query: "goalkeeper save",
    limit: 10,
  });
  assert.notDeepEqual(
    search.body.results.map((result) => result.eventId),
    differentSearch.body.results.map((result) => result.eventId),
  );
  const sessionSearch = await postJson(`${fixture.url}/api/search`, {
    query: "attack",
    sessionId: demo.sessions[0].sessionId,
    domain: demo.sessions[0].domain.toUpperCase(),
  });
  assert.equal(
    sessionSearch.body.results.every(
      (result) => result.sessionId === demo.sessions[0].sessionId,
    ),
    true,
  );

  const graph = await getJson(
    `${fixture.url}/api/context-graph?sessionId=${demo.sessions[0].sessionId}&limit=50`,
  );
  const ids = new Set(graph.body.nodes.map((node) => node.id));
  assert.equal(graph.status, 200);
  assert.ok(graph.body.nodes.length <= 50);
  assert.equal(
    graph.body.edges.every((edge) => ids.has(edge.source) && ids.has(edge.target)),
    true,
  );

  const unavailable = await createApiFixture({
    semanticHistoryService: new UnavailableSemanticHistoryService(),
  });
  t.after(() => unavailable.close());
  const unavailableSearch = await postJson(`${unavailable.url}/api/search`, {
    query: "similar attacking opportunities",
  });
  assert.equal(unavailableSearch.status, 200);
  assert.equal(unavailableSearch.body.retrievalMode, "unavailable");
  assert.deepEqual(unavailableSearch.body.results, []);
  const stillHealthy = await getJson(`${unavailable.url}/api/sessions`);
  assert.equal(stillHealthy.status, 200);
  assert.equal(stillHealthy.body.sessions.length, 3);

  const failing = await createApiFixture({
    semanticHistoryService: {
      searchSimilarEvents() { throw new Error("provider unavailable"); },
    },
  });
  t.after(() => failing.close());
  const failedSearch = await postJson(`${failing.url}/api/search`, {
    query: "similar attacking opportunities",
  });
  assert.equal(failedSearch.status, 200);
  assert.equal(failedSearch.body.retrievalMode, "unavailable");
  assert.match(failedSearch.body.warning, /temporarily unavailable/i);
  assert.equal((await getJson(`${failing.url}/api/sessions`)).status, 200);
});

test("history search rejects invalid JSON, unsupported media, and oversized bodies", async (t) => {
  const fixture = await createApiFixture();
  t.after(() => fixture.close());

  const unsupported = await fetch(`${fixture.url}/api/search`, {
    method: "POST",
    headers: { "content-type": "text/plain" },
    body: "query=goal",
  });
  assert.equal(unsupported.status, 415);
  assert.equal((await unsupported.json()).error.code, "UNSUPPORTED_MEDIA_TYPE");

  const invalid = await fetch(`${fixture.url}/api/search`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: "{not-json",
  });
  assert.equal(invalid.status, 400);
  assert.equal((await invalid.json()).error.code, "INVALID_JSON");

  const oversized = await fetch(`${fixture.url}/api/search`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ query: "x".repeat(17_000) }),
  });
  assert.equal(oversized.status, 413);
  assert.equal((await oversized.json()).error.code, "REQUEST_TOO_LARGE");
});

test("dashboard APIs require no Cloud STT or provider startup", async (t) => {
  const fixture = await createApiFixture();
  t.after(() => fixture.close());
  const responses = await Promise.all([
    fetch(`${fixture.url}/api/sessions`),
    fetch(`${fixture.url}/api/context-graph?limit=20`),
    fetch(`${fixture.url}/api/search`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ query: "comeback" }),
    }),
  ]);
  assert.deepEqual(responses.map((response) => response.status), [200, 200, 200]);
});

async function createApiFixture({ semanticHistoryService } = {}) {
  const repository = new MemoryHistoryRepository();
  const demo = await seedDemoHistory(repository);
  const semantic = semanticHistoryService ?? new DemoSemanticHistoryService({
    results: createDemoSemanticResults(demo),
    domainsBySession: new Map(
      demo.sessions.map((session) => [session.sessionId, session.domain]),
    ),
  });
  const historyService = new HistoryService({
    repository,
    semanticHistoryService: semantic,
  });
  const app = express();
  app.use("/api", createHistoryRouter({ historyService }));
  const server = http.createServer(app);
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  return {
    url: `http://127.0.0.1:${address.port}`,
    close: () => new Promise((resolve, reject) => {
      server.close((error) => error ? reject(error) : resolve());
    }),
  };
}

async function getJson(url) {
  const response = await fetch(url);
  return { status: response.status, body: await response.json() };
}

async function postJson(url, body) {
  const response = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  return { status: response.status, body: await response.json() };
}
