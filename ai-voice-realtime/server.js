import "dotenv/config";

import path from "node:path";
import { fileURLToPath } from "node:url";

import { createStreamSenseServer } from "./src/server/createStreamSenseServer.js";

const moduleDirectory = path.dirname(fileURLToPath(import.meta.url));
const host = process.env.HOST || "127.0.0.1";
const port = Number(process.env.PORT || 8000);
const runtime = createStreamSenseServer({
  apiKey: process.env.GOOGLE_API_KEY || "",
  model: process.env.GEMINI_VISION_MODEL || "gemini-3.6-flash",
  liveModel: process.env.GEMINI_LIVE_MODEL || "gemini-3.1-flash-live-preview",
  speechProjectId: process.env.GOOGLE_CLOUD_PROJECT || "",
  speechLocation: process.env.GOOGLE_CLOUD_SPEECH_LOCATION || "us",
  extensionId: process.env.STREAMSENSE_EXTENSION_ID || "",
  allowAnyExtensionOrigin: process.env.STREAMSENSE_ALLOW_ANY_EXTENSION_ORIGIN === "true",
  databasePath:
    process.env.EVENT_DB_PATH ||
    path.join(moduleDirectory, "data", "streamsense.db"),
});

try {
  const address = await runtime.listen({ host, port });
  console.log(`Server running on http://${host}:${address.port}`);
} catch (error) {
  console.error(
    `Failed to start server on http://${host}:${port}: ${toErrorMessage(error)}`
  );
  process.exitCode = 1;
}

let shutdownStarted = false;
async function shutdown() {
  if (shutdownStarted) return;
  shutdownStarted = true;
  try {
    await runtime.close();
  } catch (error) {
    console.error(`Failed to stop StreamSense cleanly: ${toErrorMessage(error)}`);
    process.exitCode = 1;
  }
}

process.once("SIGINT", shutdown);
process.once("SIGTERM", shutdown);

function toErrorMessage(error) {
  return error instanceof Error ? error.message : String(error);
}
