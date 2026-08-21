import { setServers as setDnsServers } from "node:dns";
import { isIP } from "node:net";

import { Collection, MongoClient } from "mongodb";

import { upsertMongoEventFields } from "../events/mongoEventUpsert.js";

/** @type {MongoClient | undefined} */
let mongoClient;
/** @type {Promise<MongoClient> | undefined} */
let mongoClientInitPromise;
/** @type {Promise<void> | undefined} */
let vectorIndexInitPromise;

const SIMILARITY_SCORE_THRESHOLD = 0.8;

export const CONTEXT_VECTOR_INDEX_NAME = "context_embedding_index";
export const CONTEXT_VECTOR_INDEX_DEFINITION = Object.freeze({
  fields: [
    {
      type: "vector",
      path: "embedding",
      numDimensions: 768,
      similarity: "cosine",
    },
    { type: "filter", path: "sessionId" },
    { type: "filter", path: "historyArchived" },
  ],
});

export async function getMongoClient() {
  if (!mongoClient) {
    mongoClientInitPromise ??= connectMongoClient();
    try {
      mongoClient = await mongoClientInitPromise;
    } finally {
      mongoClientInitPromise = undefined;
    }
  }

  if (!vectorIndexInitPromise) {
    vectorIndexInitPromise = initVectorIndex(
      mongoClient.db(process.env.MONGODB_DB_NAME || "streamsense"),
    );
  }

  await vectorIndexInitPromise;
  return mongoClient;
}

export async function getMongodb() {
  const client = await getMongoClient();
  return client.db(process.env.MONGODB_DB_NAME || "streamsense");
}

export async function closeMongoClient() {
  const client = mongoClient;
  mongoClient = undefined;
  mongoClientInitPromise = undefined;
  vectorIndexInitPromise = undefined;
  await client?.close();
}

async function connectMongoClient() {
  const dnsServers = parseMongoDnsServers(process.env.MONGODB_DNS_SERVERS);
  if (dnsServers.length > 0) {
    setDnsServers(dnsServers);
  }

  const mongoUri = process.env.MONGODB_URI || "mongodb://localhost:27017";
  const connectionOptions = /(?:\?|&)serverSelectionTimeoutMS=/iu.test(mongoUri)
    ? {}
    : { serverSelectionTimeoutMS: 5_000 };
  const candidate = new MongoClient(mongoUri, connectionOptions);

  try {
    await candidate.connect();
    console.log("Connected to MongoDB context storage.");
    return candidate;
  } catch (error) {
    await candidate.close().catch(() => {});
    throw error;
  }
}

/**
 * Parse an optional backend-only resolver list used for MongoDB Atlas SRV
 * lookups when the host's default Node.js DNS resolver is unavailable.
 *
 * @param {string | undefined} value
 * @returns {string[]}
 */
export function parseMongoDnsServers(value) {
  const servers = String(value ?? "")
    .split(",")
    .map((server) => server.trim())
    .filter(Boolean);

  if (servers.length > 3 || servers.some((server) => isIP(server) === 0)) {
    throw new TypeError(
      "MONGODB_DNS_SERVERS must contain at most three comma-separated IP addresses.",
    );
  }

  return [...new Set(servers)];
}

async function initVectorIndex(db) {
  await db.createCollection("events").catch((error) => {
    if (error.codeName !== "NamespaceExists") {
      throw error;
    }
  });
  /** @type {Collection} */
  const collection = db.collection("events");

  await ensureContextVectorIndex(collection);
}

/**
 * Create or upgrade the Atlas Vector Search definition without making Search
 * DDL availability a prerequisite for chronological MongoDB history.
 *
 * @param {Collection | object} collection
 * @param {{error: (...parts: unknown[]) => void}} logger
 */
export async function ensureContextVectorIndex(
  collection,
  logger = console,
) {
  try {
    const [existing] = await collection
      .listSearchIndexes(CONTEXT_VECTOR_INDEX_NAME)
      .toArray();

    if (!existing) {
      await collection.createSearchIndex({
        name: CONTEXT_VECTOR_INDEX_NAME,
        type: "vectorSearch",
        definition: CONTEXT_VECTOR_INDEX_DEFINITION,
      });
      return;
    }

    const definition = existing.latestDefinition ?? existing.definition;
    if (
      existing.type !== "vectorSearch" ||
      !hasRequiredContextVectorDefinition(definition)
    ) {
      await collection.updateSearchIndex(
        CONTEXT_VECTOR_INDEX_NAME,
        CONTEXT_VECTOR_INDEX_DEFINITION,
      );
    }
  } catch (error) {
    const errorName = boundedDiagnostic(error?.name, "Error");
    const errorCode = boundedDiagnostic(error?.code, "unknown");
    const errorCodeName = boundedDiagnostic(error?.codeName, "unknown");
    logger.error(
      `MongoDB Search index ${CONTEXT_VECTOR_INDEX_NAME} is unavailable (${errorName}; code=${errorCode}; codeName=${errorCodeName}). Chronological history remains available.`,
    );
  }
}

function hasRequiredContextVectorDefinition(definition) {
  if (!definition || !Array.isArray(definition.fields)) return false;
  const vector = definition.fields.find((field) => field?.type === "vector");
  if (
    vector?.path !== "embedding" ||
    vector?.numDimensions !== 768 ||
    vector?.similarity !== "cosine"
  ) {
    return false;
  }
  const filterPaths = new Set(
    definition.fields
      .filter((field) => field?.type === "filter")
      .map((field) => field.path),
  );
  return filterPaths.has("sessionId") && filterPaths.has("historyArchived");
}

function boundedDiagnostic(value, fallback) {
  const text = String(value ?? fallback).replace(/[^a-z0-9_.-]/giu, "");
  return text.slice(0, 80) || fallback;
}

/**
 * Save or enrich one durable event document in MongoDB.
 * History fields written by MongoHistoryRepository are deliberately preserved.
 *
 * @param {ContextSchema & {id: string}} ctxData
 */
export async function saveContextDataToMongo(ctxData) {
  if (!ctxData?.id) {
    throw new TypeError("Semantic context storage requires an event id");
  }
  const collection = (await getMongodb()).collection("events");
  await upsertMongoEventFields(collection, ctxData.id, {
    ...ctxData,
    semanticIndexed: true,
    semanticUpdatedAt: new Date().toISOString(),
  });
}

/**
 * Retrieve durable, history-archived events based on embedding similarity.
 * A null sessionId searches across sessions for the Memory dashboard.
 *
 * @param {string | null} sessionId
 * @param {number[]} queryEmbedding
 * @param {number} limitK
 * @returns {Promise<Array>}
 */
export async function getContextDataFromMongo(
  sessionId,
  queryEmbedding,
  limitK = 10,
) {
  const collection = (await getMongodb()).collection("events");
  return collection
    .aggregate(
      buildContextVectorSearchPipeline({
        sessionId,
        queryEmbedding,
        limitK,
      }),
    )
    .toArray();
}

export function buildContextVectorSearchPipeline({
  sessionId,
  queryEmbedding,
  limitK,
}) {
  const safeLimit = Math.max(1, Math.min(Number(limitK) || 10, 50));
  const filter = { historyArchived: { $eq: true } };
  if (sessionId) {
    filter.sessionId = { $eq: sessionId };
  }

  return [
    {
      $vectorSearch: {
        index: CONTEXT_VECTOR_INDEX_NAME,
        path: "embedding",
        queryVector: queryEmbedding,
        numCandidates: Math.max(100, 10 * safeLimit),
        limit: safeLimit,
        filter,
      },
    },
    { $addFields: { score: { $meta: "vectorSearchScore" } } },
    {
      $match: {
        score: { $gte: SIMILARITY_SCORE_THRESHOLD },
      },
    },
    {
      $project: {
        id: 1,
        sessionId: 1,
        timestampSeconds: 1,
        timestamp: 1,
        eventType: 1,
        entities: 1,
        topicLabels: 1,
        description: 1,
        importance: 1,
        confidence: 1,
        score: 1,
      },
    },
  ];
}
