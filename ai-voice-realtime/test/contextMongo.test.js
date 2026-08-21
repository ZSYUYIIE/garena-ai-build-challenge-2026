import assert from "node:assert/strict";
import test from "node:test";

import {
  buildContextVectorSearchPipeline,
  CONTEXT_VECTOR_INDEX_DEFINITION,
  CONTEXT_VECTOR_INDEX_NAME,
  ensureContextVectorIndex,
} from "../src/context-builder/mongo.js";

test("vector search prefilters archived events before applying its limit", () => {
  const pipeline = buildContextVectorSearchPipeline({
    sessionId: null,
    queryEmbedding: [0.1, 0.2],
    limitK: 3,
  });

  assert.deepEqual(pipeline[0].$vectorSearch.filter, {
    historyArchived: { $eq: true },
  });
  assert.equal(pipeline[0].$vectorSearch.limit, 3);
  assert.deepEqual(pipeline[2].$match, {
    score: { $gte: 0.8 },
  });
});

test("session-scoped vector search combines archive and session prefilters", () => {
  const pipeline = buildContextVectorSearchPipeline({
    sessionId: "11111111-1111-4111-8111-111111111111",
    queryEmbedding: [0.1, 0.2],
    limitK: 5,
  });

  assert.deepEqual(pipeline[0].$vectorSearch.filter, {
    historyArchived: { $eq: true },
    sessionId: { $eq: "11111111-1111-4111-8111-111111111111" },
  });
});

test("the vector index defines every prefilter field", () => {
  assert.equal(CONTEXT_VECTOR_INDEX_NAME, "context_embedding_index");
  assert.deepEqual(
    CONTEXT_VECTOR_INDEX_DEFINITION.fields.filter(
      (field) => field.type === "filter",
    ),
    [
      { type: "filter", path: "sessionId" },
      { type: "filter", path: "historyArchived" },
    ],
  );
});

test("index initialization creates the complete vector definition when absent", async () => {
  const collection = fakeCollection();

  await ensureContextVectorIndex(collection);

  assert.deepEqual(collection.calls, [
    ["list", CONTEXT_VECTOR_INDEX_NAME],
    [
      "create",
      {
        name: CONTEXT_VECTOR_INDEX_NAME,
        type: "vectorSearch",
        definition: CONTEXT_VECTOR_INDEX_DEFINITION,
      },
    ],
  ]);
});

test("index initialization leaves an equivalent definition unchanged", async () => {
  const collection = fakeCollection({
    existing: {
      name: CONTEXT_VECTOR_INDEX_NAME,
      type: "vectorSearch",
      latestDefinition: {
        fields: [
          { type: "filter", path: "historyArchived" },
          {
            type: "vector",
            path: "embedding",
            numDimensions: 768,
            similarity: "cosine",
          },
          { type: "filter", path: "sessionId" },
          { type: "filter", path: "futureFilter" },
        ],
      },
    },
  });

  await ensureContextVectorIndex(collection);

  assert.deepEqual(collection.calls, [["list", CONTEXT_VECTOR_INDEX_NAME]]);
});

test("index initialization updates every material definition drift", async (t) => {
  const drifted = [
    { name: "type", type: "search", definition: CONTEXT_VECTOR_INDEX_DEFINITION },
    {
      name: "path",
      type: "vectorSearch",
      definition: definitionWith({ vector: { path: "other" } }),
    },
    {
      name: "dimensions",
      type: "vectorSearch",
      definition: definitionWith({ vector: { numDimensions: 512 } }),
    },
    {
      name: "similarity",
      type: "vectorSearch",
      definition: definitionWith({ vector: { similarity: "dotProduct" } }),
    },
    {
      name: "session filter",
      type: "vectorSearch",
      definition: definitionWith({ omitFilter: "sessionId" }),
    },
    {
      name: "archive filter",
      type: "vectorSearch",
      definition: definitionWith({ omitFilter: "historyArchived" }),
    },
  ];

  for (const drift of drifted) {
    await t.test(drift.name, async () => {
      const collection = fakeCollection({
        existing: {
          name: CONTEXT_VECTOR_INDEX_NAME,
          type: drift.type,
          latestDefinition: drift.definition,
        },
      });

      await ensureContextVectorIndex(collection);

      assert.deepEqual(collection.calls.at(-1), [
        "update",
        CONTEXT_VECTOR_INDEX_NAME,
        CONTEXT_VECTOR_INDEX_DEFINITION,
      ]);
      assert.equal(
        collection.calls.filter(([operation]) => operation === "update").length,
        1,
      );
    });
  }
});

test("search-index DDL errors are sanitized and non-fatal", async (t) => {
  for (const operation of ["list", "create", "update"]) {
    await t.test(operation, async () => {
      const secret = "mongodb+srv://user:password@example.invalid/streamsense";
      const error = Object.assign(new Error(`unsupported ${secret}`), {
        name: "MongoServerError",
        code: 123,
        codeName: "CommandNotSupported",
      });
      const collection = fakeCollection({
        existing:
          operation === "update"
            ? {
                name: CONTEXT_VECTOR_INDEX_NAME,
                type: "search",
                latestDefinition: CONTEXT_VECTOR_INDEX_DEFINITION,
              }
            : undefined,
        errorOperation: operation,
        error,
      });
      const messages = [];
      const logger = { error: (...parts) => messages.push(parts.join(" ")) };

      await assert.doesNotReject(ensureContextVectorIndex(collection, logger));

      assert.equal(messages.length, 1);
      assert.match(messages[0], /context_embedding_index/);
      assert.match(messages[0], /MongoServerError/);
      assert.match(messages[0], /123/);
      assert.match(messages[0], /CommandNotSupported/);
      assert.doesNotMatch(messages[0], /password|mongodb\+srv/i);
    });
  }
});

function definitionWith({ vector = {}, omitFilter } = {}) {
  return {
    fields: CONTEXT_VECTOR_INDEX_DEFINITION.fields
      .filter((field) => field.path !== omitFilter)
      .map((field) =>
        field.type === "vector" ? { ...field, ...vector } : { ...field },
      ),
  };
}

function fakeCollection({ existing, errorOperation, error } = {}) {
  const calls = [];
  return {
    calls,
    listSearchIndexes(name) {
      calls.push(["list", name]);
      if (errorOperation === "list") throw error;
      return {
        async toArray() {
          return existing ? [existing] : [];
        },
      };
    },
    async createSearchIndex(options) {
      calls.push(["create", options]);
      if (errorOperation === "create") throw error;
    },
    async updateSearchIndex(name, definition) {
      calls.push(["update", name, definition]);
      if (errorOperation === "update") throw error;
    },
  };
}
