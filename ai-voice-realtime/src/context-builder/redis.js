import dotenv from "dotenv";
import { Redis } from "node-redis";

dotenv.config();

function getRedisClient() {
  const redisUri = process.env.REDIS_URI || "redis://localhost:6379";
  return new Redis(redisUri);
}

/**
 * @type {Redis}
 */
export const redisClient = getRedisClient();

redisClient.on("connect", () => {
  console.log("Connected to Redis");
});
redisClient.on("error", (err) => {
  console.error("Redis Connection Error:", err);
});
