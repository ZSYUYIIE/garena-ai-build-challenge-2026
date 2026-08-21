import path from "node:path";
import { fileURLToPath } from "node:url";
import { config as loadEnvironment } from "dotenv";

import { UnavailableAccountRepository } from "./src/accounts/accountRepository.js";
import { MongoAccountRepository } from "./src/accounts/mongoAccountRepository.js";
import {
  closeContextDataStore,
  getContextData,
  saveContextData,
} from "./src/context-builder/contextstore.js";
import { getMongodb } from "./src/context-builder/mongo.js";
import { createStreamSenseServer } from "./src/server/createStreamSenseServer.js";
import { MemoryHistoryRepository } from "./src/history/memoryHistoryRepository.js";
import { MongoHistoryRepository } from "./src/history/mongoHistoryRepository.js";
import { MongoSemanticHistoryService } from "./src/history/mongoSemanticHistoryService.js";
import { UnavailableSemanticHistoryService } from "./src/history/semanticHistoryService.js";
import {
  resolveMongoInfrastructure,
  safeBackendStartupMessage,
} from "./src/server/mongoStartup.js";

const moduleDirectory = path.dirname(fileURLToPath(import.meta.url));
loadEnvironment({
  path: [
    path.join(moduleDirectory, ".env.local"),
    path.join(moduleDirectory, ".env"),
  ],
});
const host = process.env.HOST || "127.0.0.1";
const port = Number(process.env.PORT || 8000);
let shutdownStarted = false;
let runtime;
async function shutdown() {
  if (shutdownStarted) return;
  shutdownStarted = true;
  try {
    if (runtime) {
      await runtime.close();
    } else {
      await closeContextDataStore();
    }
  } catch (error) {
    console.error(
      `Failed to stop StreamSense cleanly: ${safeBackendStartupMessage(error)}`,
    );
    process.exitCode = 1;
  }
}

process.once("SIGINT", shutdown);
process.once("SIGTERM", shutdown);

async function main() {
  const historyMode = process.env.STREAMSENSE_HISTORY_MODE || "auto";
  if (!["auto", "mongodb", "memory"].includes(historyMode)) {
    throw new TypeError(
      "STREAMSENSE_HISTORY_MODE must be 'auto', 'mongodb', or 'memory'.",
    );
  }

  const mongoInfrastructure = await resolveMongoInfrastructure({
    historyMode,
    mongoUri: process.env.MONGODB_URI,
    connect: connectMongoInfrastructure,
    close: closeContextDataStore,
    warn: (message) => console.warn(message),
  });
  const mongoAvailable = Boolean(mongoInfrastructure);
  const accountRepository = mongoInfrastructure?.accountRepository
    ?? new UnavailableAccountRepository();
  const historyRepository = mongoInfrastructure?.historyRepository
    ?? new MemoryHistoryRepository();
  const semanticHistoryService = mongoInfrastructure?.semanticHistoryService
    ?? new UnavailableSemanticHistoryService();
  console.log(
    `Memory history provider: ${mongoAvailable ? "MongoDB (durable)" : "memory (non-durable)"}.`,
  );

  runtime = createStreamSenseServer({
    apiKey: process.env.GOOGLE_API_KEY || "",
    model: process.env.GEMINI_VISION_MODEL || "gemini-3.6-flash",
    liveModel: process.env.GEMINI_LIVE_MODEL || "gemini-3.1-flash-live-preview",
    exaApiKey: process.env.EXA_API_KEY || "",
    speechProjectId: process.env.GOOGLE_CLOUD_PROJECT || "",
    speechLocation: process.env.GOOGLE_CLOUD_SPEECH_LOCATION || "us",
    extensionId: process.env.STREAMSENSE_EXTENSION_ID || "",
    allowAnyExtensionOrigin: process.env.STREAMSENSE_ALLOW_ANY_EXTENSION_ORIGIN === "true",
    databasePath:
      process.env.EVENT_DB_PATH ||
      path.join(moduleDirectory, "data", "streamsense.db"),
    dashboardDevelopmentUrl: process.env.STREAMSENSE_DASHBOARD_DEV_URL || "",
    saveContextData: mongoAvailable ? saveContextData : undefined,
    getPromptContext: mongoAvailable ? getContextData : undefined,
    closeContextStore: mongoAvailable ? closeContextDataStore : undefined,
    accountRepository,
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

  const address = await runtime.listen({ host, port });
  console.log(`Server running on http://${host}:${address.port}`);
}

async function connectMongoInfrastructure() {
  const database = await getMongodb();
  const accountRepository = new MongoAccountRepository({
    collection: database.collection("dashboard_accounts"),
  });
  await accountRepository.ensureIndexes();
  const historyRepository = new MongoHistoryRepository({
    sessionsCollection: database.collection("sessions"),
    eventsCollection: database.collection("events"),
  });
  await historyRepository.ensureIndexes();
  return {
    accountRepository,
    historyRepository,
    semanticHistoryService: new MongoSemanticHistoryService({
      repository: historyRepository,
    }),
  };
}

main().catch(async (error) => {
  await Promise.resolve(runtime?.close()).catch(() => {});
  await closeContextDataStore().catch(() => {});
  console.error(safeBackendStartupMessage(error));
  process.exitCode = 1;
});
