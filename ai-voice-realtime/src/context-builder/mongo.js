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

const SIMILARITY_SCORE_THRESHOLD = 0.0;

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

  const INDEX_NAME = "context_embedding_index";
  const INDEX_TYPE = "vectorSearch";
  const INDEX_DEFINITION = {
    fields: [
      {
        type: "vector",
        path: "embedding",
        numDimensions: 768,
        similarity: "cosine",
      },
      { type: "filter", path: "sessionId" },
    ],
  };

  try {
    await collection.createSearchIndex({
      name: INDEX_NAME,
      type: INDEX_TYPE,
      definition: INDEX_DEFINITION,
    });
  } catch (error) {
    if (error.codeName === "IndexAlreadyExists") {
      console.log(
        "MongoDB vector index for context embeddings already exists.",
      );
    } else {
      console.error("Failed to create MongoDB vector index:", error);
    }
  }
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
  const safeLimit = Math.max(1, Math.min(Number(limitK) || 10, 50));
  const vectorSearch = {
    index: "context_embedding_index",
    path: "embedding",
    queryVector: queryEmbedding,
    numCandidates: Math.max(100, 10 * safeLimit),
    limit: safeLimit,
  };
  if (sessionId) {
    vectorSearch.filter = { sessionId: { $eq: sessionId } };
  }

  const pipeline = [
    { $vectorSearch: vectorSearch },
    { $addFields: { score: { $meta: "vectorSearchScore" } } },
    {
      $match: {
        historyArchived: true,
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

  return collection.aggregate(pipeline).toArray();
}
