import dotenv from "dotenv";
import { Collection, MongoClient } from "mongodb";

dotenv.config();

/** @type {MongoClient | undefined} */
let mongoClient;
/** @type {Promise<void> | undefined} */
let vectorIndexInitPromise;

export async function getMongoClient() {
  if (!mongoClient) {
    const mongoUri = process.env.MONGODB_URI || "mongodb://localhost:27017";
    mongoClient = new MongoClient(mongoUri);

    await mongoClient.connect();
    console.log("Connected to MongoDB at:", mongoUri);
  }

  if (!vectorIndexInitPromise) {
    vectorIndexInitPromise = initVectorIndex(
      mongoClient.db(process.env.MONGODB_NAME || "streamsense"),
    );
  }

  await vectorIndexInitPromise;
  return mongoClient;
}

export async function getMongodb() {
  const client = await getMongoClient();
  return client.db(process.env.MONGODB_NAME || "streamsense");
}

async function initVectorIndex(db) {
  await db.createCollection("events").catch((error) => {
    if (error.codeName !== "NamespaceExists") {
      console.error("Failed to create MongoDB collection 'events':", error);
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
 * Save context data to MongoDB
 *
 * @param {ContextSchema} ctxData
 */
export async function saveContextDataToMongo(ctxData) {
  const collection = (await getMongodb()).collection("events");
  await collection.insertOne(ctxData);
}

/**
 * Retrieve context data from MongoDB based on embedding similarity
 *
 * @param {string} sessionId
 * @param {number[]} queryEmbedding
 * @param {number} limitK
 * @returns {Promise<ContextSchema[]>}
 */
export async function getContextDataFromMongo(
  sessionId,
  queryEmbedding,
  limitK = 10,
) {
  const collection = (await getMongodb()).collection("events");

  const pipeline = [
    {
      $vectorSearch: {
        index: "context_embedding_index",
        path: "embedding",
        queryVector: queryEmbedding,
        filter: { sessionId: { $eq: sessionId } },
        numCandidates: 10 * limitK,
        limit: limitK,
      },
    },
    {
      $addFields: { score: { $meta: "vectorSearchScore" } },
    },
    {
      $project: {
        sessionId: 1,
        timestampSeconds: 1,
        eventType: 1,
        entities: 1,
        description: 1,
        importance: 1,
        confidence: 1,
        score: 1,
      },
    },
  ];

  const result = await collection.aggregate(pipeline).toArray();
  return result;
}
