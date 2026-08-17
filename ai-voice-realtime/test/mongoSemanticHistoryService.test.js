import assert from "node:assert/strict";
import test from "node:test";

import { MongoSemanticHistoryService } from "../src/history/mongoSemanticHistoryService.js";

const footballSessionId = "11111111-1111-4111-8111-111111111111";
const esportsSessionId = "22222222-2222-4222-8222-222222222222";
const footballEventId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const esportsEventId = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";


test("Mongo semantic history maps durable vector matches into dashboard results", async () => {
  const calls = [];
  const repository = {
    async getSession(sessionId) {
      return {
        sessionId,
        title: sessionId === footballSessionId ? "England vs France" : "Arena final",
        domain: sessionId === footballSessionId ? "football" : "esports",
      };
    },
  };
  const service = new MongoSemanticHistoryService({
    repository,
    async embedQuery(query) {
      calls.push(["embed", query]);
      return [0.25, 0.5];
    },
    async searchEvents(options) {
      calls.push(["search", options]);
      return [
        {
          id: esportsEventId,
          sessionId: esportsSessionId,
          timestampSeconds: 9,
          eventType: "teamfight",
          description: "A decisive teamfight begins near the objective.",
          entities: ["Blue team"],
          topicLabels: ["Momentum shift"],
          score: 0.95,
        },
        {
          id: footballEventId,
          sessionId: footballSessionId,
          timestampSeconds: 42,
          eventType: "counterattack",
          description: "England breaks quickly through midfield.",
          entities: ["England"],
          topicLabels: ["Counterattack"],
          score: 0.87,
        },
      ];
    },
  });

  const response = await service.searchSimilarEvents({
    query: "fast attacking transitions",
    domain: "football",
    limit: 1,
  });

  assert.deepEqual(calls[0], ["embed", "fast attacking transitions"]);
  assert.deepEqual(calls[1], [
    "search",
    {
      sessionId: null,
      queryEmbedding: [0.25, 0.5],
      limit: 5,
    },
  ]);
  assert.deepEqual(response, {
    dataOrigin: "realtime",
    retrievalMode: "semantic",
    results: [
      {
        sessionId: footballSessionId,
        sessionTitle: "England vs France",
        eventId: footballEventId,
        timestampSeconds: 42,
        timestamp: "00:42",
        eventType: "counterattack",
        description: "England breaks quickly through midfield.",
        entities: ["England"],
        topics: ["Counterattack"],
        similarity: 0.87,
      },
    ],
  });
});


test("Mongo semantic history keeps search session-scoped and ignores orphan vectors", async () => {
  const repository = {
    async getSession(sessionId) {
      return sessionId === footballSessionId
        ? {
            sessionId,
            title: "England vs France",
            domain: "football",
          }
        : null;
    },
  };
  let received;
  const service = new MongoSemanticHistoryService({
    repository,
    embedQuery: async () => [1],
    async searchEvents(options) {
      received = options;
      return [
        {
          id: esportsEventId,
          sessionId: esportsSessionId,
          timestampSeconds: 1,
          eventType: "unknown",
          description: "Orphaned context-only vector.",
          entities: [],
          score: 2,
        },
      ];
    },
  });

  const response = await service.searchSimilarEvents({
    query: "what happened",
    sessionId: footballSessionId,
    limit: 10,
  });

  assert.equal(received.sessionId, footballSessionId);
  assert.deepEqual(response, {
    dataOrigin: "empty",
    retrievalMode: "semantic",
    results: [],
  });
});
