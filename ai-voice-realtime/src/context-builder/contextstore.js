import {
  generateDocumentEmbedding,
  generateQueryEmbedding,
} from "./embedding.js";
import { getContextDataFromMongo, saveContextDataToMongo } from "./mongo.js";

/**
 * Saves context data for a given event and session metadata. This function generates an embedding for the event description if needed.
 * @param {ContextSchema} ctxData context data to insert
 */
export async function saveContextData(ctxData) {
  if (!ctxData.sessionId) {
    console.error("Missing sessionId in event:", ctxData);
    return;
  }

  if (!ctxData.embedding || ctxData.embedding.length !== 768) {
    // generate embedding
    const embedding = await generateDocumentEmbedding(ctxData.description);
    ctxData.embedding = embedding;
  }
  await saveContextDataToMongo(ctxData);
}

/**
 * Retrieves context data for a given session based on embedding similarity.
 * @param {string} sessionId
 * @param {string} searchString
 * @param {number} limit
 * @returns
 */
export async function getContextData(sessionId, searchString, limit = 10) {
  const searchEmbedding = await generateQueryEmbedding(searchString);
  const contextData = await getContextDataFromMongo(
    sessionId,
    searchEmbedding,
    limit,
  );

  return contextData;
}
