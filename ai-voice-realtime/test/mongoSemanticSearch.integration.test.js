import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";

import {
  closeMongoClient,
  getMongodb,
} from "../src/context-builder/mongo.js";
import { saveContextData } from "../src/context-builder/contextstore.js";
import { HistoryService } from "../src/history/historyService.js";
import { MongoHistoryRepository } from "../src/history/mongoHistoryRepository.js";
import { MongoSemanticHistoryService } from "../src/history/mongoSemanticHistoryService.js";

const shouldRun =
  process.env.STREAMSENSE_RUN_ATLAS_SEARCH_TEST === "true" &&
  Boolean(process.env.MONGODB_URI) &&
  Boolean(process.env.GOOGLE_API_KEY);

test(
  "Atlas stores one shared event document and retrieves it through semantic search",
  { skip: !shouldRun, timeout: 180_000 },
  async () => {
    let database;
    const sessionId = randomUUID();
    const eventId = randomUUID();
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
      await saveContextData(archived.event);

      // Reopen the durable store before retrieval to model a backend restart.
      await closeMongoClient();
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
      const response = await waitForSemanticResult(reopenedHistory, eventId);
      assert.equal(response.retrievalMode, "semantic");
      assert.equal(response.results[0]?.eventId, eventId);
      assert.equal(response.results[0]?.sessionId, sessionId);

      const sessionPage = await reopenedHistory.listSessions({ limit: 12 });
      assert.equal(sessionPage.sessions[0]?.sessionId, sessionId);
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
      if (database) {
        await Promise.all([
          database.collection("events").deleteMany({ id: eventId }),
          database.collection("sessions").deleteMany({ sessionId }),
        ]);
      }
      await closeMongoClient();
    }
  },
);

async function waitForSemanticResult(history, eventId) {
  const deadline = Date.now() + 120_000;
  let lastErrorCode = "not_ready";

  while (Date.now() < deadline) {
    try {
      const response = await history.searchSimilarEvents({
        query: "Which close-range attempt did the goalkeeper save?",
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
