import assert from "node:assert/strict";
import test from "node:test";

import { MemoryAccountRepository } from "../src/accounts/memoryAccountRepository.js";
import { MongoAccountRepository } from "../src/accounts/mongoAccountRepository.js";

const accountId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const draft = {
  displayName: "Maya Chen",
  email: "Maya@Example.com",
  contentPreference: "sports",
  narrationPreference: "detailed",
};

test("memory account repository validates, normalizes, and updates profiles", async () => {
  const times = [
    new Date("2026-08-08T01:00:00.000Z"),
    new Date("2026-08-08T01:05:00.000Z"),
  ];
  const repository = new MemoryAccountRepository({
    now: () => times.shift(),
    createId: () => accountId,
  });

  const created = await repository.createAccount(draft);
  assert.deepEqual(created, {
    version: 1,
    accountId,
    displayName: "Maya Chen",
    email: "maya@example.com",
    contentPreference: "sports",
    narrationPreference: "detailed",
    createdAt: "2026-08-08T01:00:00.000Z",
    updatedAt: "2026-08-08T01:00:00.000Z",
  });
  assert.deepEqual(await repository.getAccount(accountId), created);

  const updated = await repository.updateAccount(accountId, {
    ...draft,
    displayName: "Maya C",
    email: "maya@example.com",
  });
  assert.equal(updated.displayName, "Maya C");
  assert.equal(updated.createdAt, created.createdAt);
  assert.equal(updated.updatedAt, "2026-08-08T01:05:00.000Z");
  assert.equal(await repository.updateAccount(
    "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
    draft,
  ), null);
});

test("MongoDB repository creates indexes and persists only server account fields", async () => {
  const collection = new FakeMongoCollection();
  const repository = new MongoAccountRepository({
    collection,
    now: () => new Date("2026-08-08T01:00:00.000Z"),
    createId: () => accountId,
  });
  await repository.ensureIndexes();
  const created = await repository.createAccount(draft);

  assert.deepEqual(collection.indexes, [
    [{ accountId: 1 }, { unique: true, name: "account_id_unique" }],
    [{ normalizedEmail: 1 }, { unique: true, name: "normalized_email_unique" }],
  ]);
  assert.equal(collection.document.accountId, accountId);
  assert.equal(collection.document.normalizedEmail, "maya@example.com");
  assert.equal(collection.document.createdAt instanceof Date, true);
  assert.equal("normalizedEmail" in created, false);
  assert.equal("_id" in created, false);
  assert.equal(created.email, "maya@example.com");
});

test("MongoDB repository maps unique email failures without leaking driver details", async () => {
  const collection = new FakeMongoCollection();
  collection.insertError = Object.assign(new Error("E11000 raw Mongo detail"), { code: 11000 });
  const repository = new MongoAccountRepository({ collection });

  await assert.rejects(
    repository.createAccount(draft),
    (error) => error.code === "ACCOUNT_EMAIL_EXISTS"
      && error.message === "An account already uses this email address.",
  );
});

class FakeMongoCollection {
  indexes = [];
  document = null;
  insertError = null;

  createIndex(keys, options) {
    this.indexes.push([keys, options]);
    return options.name;
  }

  insertOne(document) {
    if (this.insertError) throw this.insertError;
    this.document = { _id: "mongo-private-id", ...structuredClone(document) };
    return { acknowledged: true };
  }

  findOne(query) {
    return this.document?.accountId === query.accountId
      ? structuredClone(this.document)
      : null;
  }

  findOneAndUpdate(query, update) {
    if (this.document?.accountId !== query.accountId) return null;
    this.document = { ...this.document, ...structuredClone(update.$set) };
    return structuredClone(this.document);
  }
}
