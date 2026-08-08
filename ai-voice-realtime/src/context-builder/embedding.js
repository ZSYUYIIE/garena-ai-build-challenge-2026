import { GoogleGenAI } from "@google/genai";
import dotenv from "dotenv";

dotenv.config();

const ai = new GoogleGenAI({ apiKey: process.env.GOOGLE_API_KEY });

/**
 * Generate a 768-dimensional vector embedding for a given text.
 *
 * @param {string} text - The text for which to generate an embedding to store for RAG.
 * @returns {Promise<number[]>} A promise that resolves to an array of 768 floats representing the embedding.
 */
export async function generateDocumentEmbedding(text) {
  return generateEmbedding(text, "RETRIEVAL_DOCUMENT");
}

/**
 * Generates embeddings to query the context store for relevant context data based on a given query.
 *
 * @param {string} query - The query text for which to generate an embedding.
 * @returns {Promise<number[]>} A promise that resolves to an array of 768 floats representing the embedding for the query.
 */
export async function generateQueryEmbedding(query) {
  return generateEmbedding(query, "RETRIEVAL_QUERY");
}

/**
 * Generates embeddings for a given text based on the specified task type.
 *
 * @param {string} text - The text for which to generate an embedding.
 * @param {string} taskType - The type of task for which to generate the embedding.
 * @returns {Promise<number[]>} A promise that resolves to an array of 768 floats representing the embedding.
 */
async function generateEmbedding(text, taskType = "RETRIEVAL_DOCUMENT") {
  const response = await ai.models.embedContent({
    model: "gemini-embedding-001",
    contents: text,
    config: {
      outputDimensionality: 768,
      taskType: taskType,
    },
  });

  return response.embeddings[0].values;
}
