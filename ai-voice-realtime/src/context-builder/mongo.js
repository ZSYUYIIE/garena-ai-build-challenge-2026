import dotenv from "dotenv";
import { MongoClient } from "mongodb";

dotenv.config();

/** @type {MongoClient | undefined} */
let mongoClient;

export async function getMongoClient() {
  if (!mongoClient) {
    const mongoUri =
      process.env.MONGODB_URI || "mongodb://localhost:27017/streamsense";
    mongoClient = new MongoClient(mongoUri);
    await mongoClient.connect();
    console.log("Connected to MongoDB");
  }
  return mongoClient;
}
