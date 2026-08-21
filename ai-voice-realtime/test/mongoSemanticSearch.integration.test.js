import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";

import {
  closeMongoClient,
  CONTEXT_VECTOR_INDEX_DEFINITION,
  CONTEXT_VECTOR_INDEX_NAME,
  getContextDataFromMongo,
  getMongodb,
} from "../src/context-builder/mongo.js";
import { generateQueryEmbedding } from "../src/context-builder/embedding.js";
import { HistoryService } from "../src/history/historyService.js";
import { MongoHistoryRepository } from "../src/history/mongoHistoryRepository.js";
import { MongoSemanticHistoryService } from "../src/history/mongoSemanticHistoryService.js";

const shouldRun =
  process.env.STREAMSENSE_RUN_ATLAS_SEARCH_TEST === "true" &&
  Boolean(process.env.MONGODB_URI) &&
  Boolean(process.env.GOOGLE_API_KEY);
const atlasReadyTimeoutMs = Math.max(
  1_000,
  Number(process.env.STREAMSENSE_ATLAS_INDEX_TIMEOUT_MS) || 300_000,
);
const semanticReadyTimeoutMs = 120_000;

test("Atlas readiness waits for the latest vector-index definition", () => {
  const latestDefinition = CONTEXT_VECTOR_INDEX_DEFINITION;

  assert.equal(
    isVectorIndexReady({
      queryable: true,
      status: "BUILDING",
      latestDefinition,
    }),
    false,
  );
  assert.equal(
    isVectorIndexReady({
      queryable: true,
      status: "READY",
      latestDefinition,
    }),
    true,
  );
});

test(
  "Atlas stores one shared event document and retrieves it through semantic search",
  {
    skip: !shouldRun,
    timeout:
      2 * atlasReadyTimeoutMs + semanticReadyTimeoutMs + 60_000,
  },
  async () => {
    let database;
    const sessionId = randomUUID();
    const eventId = randomUUID();
    const partialIds = Array.from({ length: 5 }, () => randomUUID());
    const query = "Which close-range attempt did the goalkeeper save?";
    try {
      database = await getMongodb();
      const repository = new MongoHistoryRepository({
        sessionsCollection: database.collection("sessions"),
        eventsCollection: database.collection("events"),
      });
      await repository.ensureIndexes();

      const history = new HistoryService({ repository });
      await history.startSession({
        sessionId,
        startedAt: "2026-08-17T08:00:00.000Z",
        title: "Semantic search acceptance",
        domain: "sports",
        sourceLabel: "Acceptance test",
        dataOrigin: "realtime",
      });
      const archived = await history.archiveEvent({
        id: eventId,
        sessionId,
        timestampSeconds: 42,
        eventType: "shot_saved",
        entities: ["Team A", "Player 9"],
        topicLabels: ["Turning point"],
        description:
          "The goalkeeper saves Player 9's close-range shot at the right post.",
        importance: 0.91,
        confidence: 0.94,
      });
      const queryEmbedding = await generateQueryEmbedding(query);
      const targetEmbedding = vectorAtCosine(queryEmbedding, 0.95);
      assert.ok(Math.abs(cosine(queryEmbedding, targetEmbedding) - 0.95) < 1e-6);
      await database.collection("events").updateOne(
        { id: eventId },
        {
          $set: {
            embedding: targetEmbedding,
            semanticIndexed: true,
            semanticUpdatedAt: new Date().toISOString(),
          },
        },
      );
      await database.collection("events").insertMany(
        partialIds.map((id, index) => ({
          id,
          sessionId,
          timestampSeconds: 100 + index,
          timestamp: `01:${String(40 + index).padStart(2, "0")}`,
          eventType: "semantic_partial",
          entities: ["Partial context"],
          topicLabels: ["Acceptance decoy"],
          description: `Semantic-only partial document ${index + 1}`,
          importance: 0.5,
          confidence: 0.9,
          embedding: queryEmbedding,
          historyArchived: false,
          semanticIndexed: true,
        })),
      );

      await waitForVectorIndex(database.collection("events"));
      const directMatches = await getContextDataFromMongo(
        sessionId,
        queryEmbedding,
        1,
      );
      assert.deepEqual(directMatches.map((match) => match.id), [eventId]);
      assert.equal(
        directMatches.some((match) => partialIds.includes(match.id)),
        false,
      );

      // Reopen the durable store before retrieval to model a backend restart.
      await closeMongoClient();
      database = undefined;
      database = await getMongodb();
      const reopenedRepository = new MongoHistoryRepository({
        sessionsCollection: database.collection("sessions"),
        eventsCollection: database.collection("events"),
      });
      await reopenedRepository.ensureIndexes();
      const semantic = new MongoSemanticHistoryService({
        repository: reopenedRepository,
      });
      const reopenedHistory = new HistoryService({
        repository: reopenedRepository,
        semanticHistoryService: semantic,
      });
      await waitForVectorIndex(database.collection("events"));
      const response = await waitForSemanticResult(
        reopenedHistory,
        eventId,
        query,
      );
      assert.equal(response.retrievalMode, "semantic");
      assert.equal(response.results[0]?.eventId, eventId);
      assert.equal(response.results[0]?.sessionId, sessionId);

      const reopenedSession = await reopenedHistory.getSession(sessionId);
      assert.equal(reopenedSession?.session.sessionId, sessionId);
      const eventPage = await reopenedHistory.listSessionEvents(sessionId);
      assert.equal(eventPage.events[0]?.id, eventId);
      const graph = await reopenedHistory.getContextGraph({
        sessionId,
        limit: 80,
      });
      assert.equal(
        graph.nodes.some((node) => node.id === `session:${sessionId}`),
        true,
      );
      assert.equal(
        graph.nodes.some((node) => node.id === `event:${eventId}`),
        true,
      );
      assert.ok(graph.edges.length > 0);

      const sharedDocument = await database.collection("events").findOne({
        id: eventId,
      });
      assert.equal(sharedDocument.historyArchived, true);
      assert.equal(sharedDocument.semanticIndexed, true);
      assert.equal(sharedDocument.embedding.length, 768);
    } finally {
      try {
        let cleanupDatabase = database;
        if (!cleanupDatabase) {
          try {
            cleanupDatabase = await getMongodb();
          } catch {
            // Preserve the original acceptance-test failure if recovery is down.
          }
        }
        if (cleanupDatabase) {
          await Promise.all([
            cleanupDatabase
              .collection("events")
              .deleteMany({ id: { $in: [eventId, ...partialIds] } }),
            cleanupDatabase.collection("sessions").deleteMany({ sessionId }),
          ]);
        }
      } finally {
        await closeMongoClient();
      }
    }
  },
);

async function waitForSemanticResult(history, eventId, query) {
  const deadline = Date.now() + semanticReadyTimeoutMs;
  let lastErrorCode = "not_ready";

  while (Date.now() < deadline) {
    try {
      const response = await history.searchSimilarEvents({
        query,
        limit: 5,
      });
      if (response.results.some((result) => result.eventId === eventId)) {
        return response;
      }
    } catch (error) {
      lastErrorCode = String(error?.codeName ?? error?.code ?? "not_ready");
    }
    await new Promise((resolve) => setTimeout(resolve, 2_000));
  }

  throw new Error(
    `Atlas semantic index did not become queryable in time (${lastErrorCode}).`,
  );
}

async function waitForVectorIndex(collection) {
  const deadline = Date.now() + atlasReadyTimeoutMs;
  let lastState = "not_ready";

  while (Date.now() < deadline) {
    const [index] = await collection
      .listSearchIndexes(CONTEXT_VECTOR_INDEX_NAME)
      .toArray();
    lastState = String(index?.status ?? "missing");
    if (lastState === "FAILED") {
      throw new Error(`Atlas vector index entered FAILED state.`);
    }
    if (isVectorIndexReady(index)) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 2_000));
  }

  throw new Error(
    `Atlas vector index did not become queryable in time (${lastState}).`,
  );
}

function isVectorIndexReady(index) {
  const definition = index?.latestDefinition ?? index?.definition;
  return (
    index?.queryable === true &&
    String(index?.status) === "READY" &&
    hasCompleteDefinition(definition)
  );
}

function hasCompleteDefinition(definition) {
  if (!definition || !Array.isArray(definition.fields)) return false;
  const required = CONTEXT_VECTOR_INDEX_DEFINITION.fields;
  return required.every((expected) =>
    definition.fields.some((actual) =>
      Object.entries(expected).every(([key, value]) => actual?.[key] === value),
    ),
  );
}

function vectorAtCosine(queryVector, similarity) {
  const magnitude = Math.sqrt(
    queryVector.reduce((sum, value) => sum + value * value, 0),
  );
  const unitQuery = queryVector.map((value) => value / magnitude);
  const basisIndex = Math.abs(unitQuery[0]) < 0.9 ? 0 : 1;
  const basis = new Array(unitQuery.length).fill(0);
  basis[basisIndex] = 1;
  const projection = unitQuery[basisIndex];
  const orthogonal = basis.map(
    (value, index) => value - projection * unitQuery[index],
  );
  const orthogonalMagnitude = Math.sqrt(
    orthogonal.reduce((sum, value) => sum + value * value, 0),
  );
  const scale = Math.sqrt(1 - similarity * similarity);
  return unitQuery.map(
    (value, index) =>
      similarity * value + scale * (orthogonal[index] / orthogonalMagnitude),
  );
}

function cosine(left, right) {
  const dot = left.reduce((sum, value, index) => sum + value * right[index], 0);
  const leftMagnitude = Math.sqrt(
    left.reduce((sum, value) => sum + value * value, 0),
  );
  const rightMagnitude = Math.sqrt(
    right.reduce((sum, value) => sum + value * value, 0),
  );
  return dot / (leftMagnitude * rightMagnitude);
}
