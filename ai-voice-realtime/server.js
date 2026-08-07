import "dotenv/config";

import path from "node:path";
import { fileURLToPath } from "node:url";

import { createStreamSenseServer } from "./src/server/createStreamSenseServer.js";
import {
  createDemoSemanticResults,
  seedDemoHistory,
} from "./src/history/demoHistory.js";
import { MemoryHistoryRepository } from "./src/history/memoryHistoryRepository.js";
import {
  DemoSemanticHistoryService,
  UnavailableSemanticHistoryService,
} from "./src/history/semanticHistoryService.js";

const moduleDirectory = path.dirname(fileURLToPath(import.meta.url));
const host = process.env.HOST || "127.0.0.1";
const port = Number(process.env.PORT || 8000);
const historyMode = process.env.STREAMSENSE_HISTORY_MODE || "memory";
if (!["memory", "demo"].includes(historyMode)) {
  throw new Error("STREAMSENSE_HISTORY_MODE must be 'memory' or 'demo'.");
}
if (historyMode === "demo" && process.env.NODE_ENV === "production") {
  throw new Error("Dashboard demo history cannot run in production mode.");
}
const historyRepository = new MemoryHistoryRepository();
let semanticHistoryService = new UnavailableSemanticHistoryService();
if (historyMode === "demo") {
  const demo = await seedDemoHistory(historyRepository);
  semanticHistoryService = new DemoSemanticHistoryService({
    results: createDemoSemanticResults(demo),
    domainsBySession: new Map(
      demo.sessions.map((session) => [session.sessionId, session.domain]),
    ),
  });
}
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
  historyRepository,
  semanticHistoryService,
  onHistoryError: ({ operation }) => {
    const safeOperation = ["start_session", "archive_event", "finish_session"]
      .includes(operation)
      ? operation
      : "unknown_operation";
    console.warn(`History archive degraded during ${safeOperation}.`);
  },
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
