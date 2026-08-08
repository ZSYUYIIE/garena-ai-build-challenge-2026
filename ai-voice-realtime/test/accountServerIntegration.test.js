import assert from "node:assert/strict";
import test from "node:test";

import { MemoryAccountRepository } from "../src/accounts/memoryAccountRepository.js";
import { createStreamSenseServer } from "../src/server/createStreamSenseServer.js";

const draft = {
  displayName: "Maya Chen",
  email: "maya@example.com",
  contentPreference: "sports",
  narrationPreference: "standard",
};

test("account API creates, reads, and updates a persisted profile", async (t) => {
  const runtime = createStreamSenseServer({
    accountRepository: new MemoryAccountRepository(),
    eventStore: { close() {} },
    sessionFactory() {
      throw new Error("account HTTP requests must not start realtime providers");
    },
  });
  t.after(() => runtime.close());
  const address = await runtime.listen({ host: "127.0.0.1", port: 0 });
  const baseUrl = `http://127.0.0.1:${address.port}`;

  const create = await sendJson(`${baseUrl}/api/accounts`, "POST", draft);
  assert.equal(create.status, 201);
  assert.match(create.body.account.accountId, /^[0-9a-f-]{36}$/);
  assert.equal(create.body.account.email, "maya@example.com");
  assert.equal(create.headers.get("cache-control"), "no-store");

  const accountId = create.body.account.accountId;
  const read = await getJson(`${baseUrl}/api/accounts/${accountId}`);
  assert.equal(read.status, 200);
  assert.deepEqual(read.body, create.body);

  const update = await sendJson(`${baseUrl}/api/accounts/${accountId}`, "PUT", {
    ...draft,
    displayName: "Maya C",
  });
  assert.equal(update.status, 200);
  assert.equal(update.body.account.displayName, "Maya C");
  assert.equal(update.body.account.createdAt, create.body.account.createdAt);
});

test("account API validates payloads, identity, duplicate email, and availability", async (t) => {
  const runtime = createStreamSenseServer({
    accountRepository: new MemoryAccountRepository(),
    eventStore: { close() {} },
  });
  t.after(() => runtime.close());
  const address = await runtime.listen({ host: "127.0.0.1", port: 0 });
  const baseUrl = `http://127.0.0.1:${address.port}`;

  assert.equal((await getJson(`${baseUrl}/api/accounts/not-a-uuid`)).status, 400);
  assert.equal((await sendJson(`${baseUrl}/api/accounts`, "POST", {
    ...draft,
    email: "invalid",
  })).status, 400);
  assert.equal((await sendJson(`${baseUrl}/api/accounts`, "POST", draft)).status, 201);
  const duplicate = await sendJson(`${baseUrl}/api/accounts`, "POST", draft);
  assert.equal(duplicate.status, 409);
  assert.equal(duplicate.body.error.code, "ACCOUNT_EMAIL_EXISTS");

  const unavailable = createStreamSenseServer({ eventStore: { close() {} } });
  t.after(() => unavailable.close());
  const unavailableAddress = await unavailable.listen({ host: "127.0.0.1", port: 0 });
  const response = await sendJson(
    `http://127.0.0.1:${unavailableAddress.port}/api/accounts`,
    "POST",
    draft,
  );
  assert.equal(response.status, 503);
  assert.equal(response.body.error.code, "ACCOUNT_STORAGE_UNAVAILABLE");
  assert.equal(
    response.body.error.message,
    "StreamSense account storage is temporarily unavailable.",
  );
  assert.doesNotMatch(response.body.error.message, /MongoDB/i);
});

async function getJson(url) {
  const response = await fetch(url);
  return {
    status: response.status,
    headers: response.headers,
    body: await response.json(),
  };
}

async function sendJson(url, method, body) {
  const response = await fetch(url, {
    method,
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  return {
    status: response.status,
    headers: response.headers,
    body: await response.json(),
  };
}
