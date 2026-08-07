import express from "express";
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { WebSocket, WebSocketServer } from "ws";

import { EventStore } from "../events/eventStore.js";
import { HistoryArchiveQueue } from "../history/historyArchiveQueue.js";
import { createHistoryRouter } from "../history/historyRouter.js";
import { HistoryService } from "../history/historyService.js";
import { MemoryHistoryRepository } from "../history/memoryHistoryRepository.js";
import { MAX_WEBSOCKET_PAYLOAD_BYTES } from "../protocol/browserMessages.js";
import {
  isAllowedExtensionOrigin,
  rejectUpgrade,
} from "../protocol/websocketPolicy.js";
import { ClientSession } from "../session/clientSession.js";

const moduleDirectory = path.dirname(fileURLToPath(import.meta.url));
const projectDirectory = path.resolve(moduleDirectory, "../..");

export function createStreamSenseServer({
  apiKey = "",
  model = "gemini-3.6-flash",
  liveModel = "gemini-3.1-flash-live-preview",
  speechProjectId = "",
  speechLocation = "us",
  extensionId = "",
  allowAnyExtensionOrigin = false,
  databasePath = ":memory:",
  eventStore = new EventStore({ databasePath }),
  historyRepository,
  historyService,
  historyArchive,
  onHistoryError = () => {},
  semanticHistoryService,
  sessionFactory,
  sessionOptions = {},
  staticDirectory = path.join(projectDirectory, "static"),
  dashboardDirectory = path.resolve(projectDirectory, "../session-dashboard/dist"),
} = {}) {
  const activeHistoryRepository =
    historyRepository ?? historyService?.repository ?? new MemoryHistoryRepository();
  const activeHistoryService = historyService ?? new HistoryService({
    repository: activeHistoryRepository,
    semanticHistoryService,
  });
  const activeHistoryArchive = historyArchive ?? new HistoryArchiveQueue({
    historyService: activeHistoryService,
    onError: onHistoryError,
  });
  const createSession =
    sessionFactory ??
    ((browser, sessionEventStore) =>
      new ClientSession(browser, sessionEventStore, {
        apiKey,
        model,
        liveModel,
        speechProjectId,
        speechLocation,
        historyArchive: activeHistoryArchive,
        ...sessionOptions,
      }));

  const app = express();
  const httpServer = http.createServer(app);
  const browserWss = new WebSocketServer({
    noServer: true,
    maxPayload: MAX_WEBSOCKET_PAYLOAD_BYTES,
  });
  const sessions = new Set();
  const sessionClosures = new WeakMap();
  let closing = false;

  app.use("/api", createHistoryRouter({ historyService: activeHistoryService }));
  const dashboardIndex = path.join(dashboardDirectory, "index.html");
  if (fs.existsSync(dashboardIndex)) {
    app.get(/^\/dashboard$/, (_request, response) => {
      response.redirect(308, "/dashboard/");
    });
    app.use("/dashboard", express.static(dashboardDirectory));
    app.get("/dashboard/*", (_request, response) => {
      response.sendFile(dashboardIndex);
    });
  }
  app.use("/static", express.static(staticDirectory));
  app.get("/", (_request, response) => {
    response.sendFile(path.join(staticDirectory, "index.html"));
  });
  app.get("/favicon.ico", (_request, response) => {
    response.status(204).end();
  });

  httpServer.on("upgrade", (request, socket, head) => {
    let pathname;
    try {
      pathname = new URL(request.url ?? "", "http://localhost").pathname;
    } catch {
      rejectUpgrade(socket, 400, "Invalid WebSocket request URL.");
      return;
    }

    if (pathname !== "/ws") {
      rejectUpgrade(socket, 404, "WebSocket endpoint not found.");
      return;
    }
    if (!isAllowedExtensionOrigin(request.headers.origin, {
      extensionId,
      allowAnyExtensionOrigin,
    })) {
      rejectUpgrade(socket, 403, "Chrome extension origin required.");
      return;
    }

    browserWss.handleUpgrade(request, socket, head, (browser) => {
      browserWss.emit("connection", browser, request);
    });
  });

  browserWss.on("connection", (browser) => {
    browser.on("error", () => {
      // `ws` reports protocol failures, including maxPayload, on the socket.
      // The library still sends the appropriate close frame to the client.
    });
    const session = createSession(browser, eventStore);
    sessions.add(session);
    const closeSession = () => {
      let sessionClose = sessionClosures.get(session);
      if (!sessionClose) {
        sessionClose = Promise.resolve()
          .then(() => session.close())
          .finally(() => {
            sessions.delete(session);
          });
        sessionClosures.set(session, sessionClose);
      }
      return sessionClose;
    };
    browser.once("close", () => {
      void closeSession();
    });
    Promise.resolve(session.start()).catch((error) => {
      if (browser.readyState === WebSocket.OPEN) browser.send(JSON.stringify({ type: "error", text: "Session startup failed." }));
      void closeSession();
    });
  });

  async function listen({ host = "127.0.0.1", port = 8000 } = {}) {
    if (closing) throw new Error("Cannot listen after server shutdown.");

    return new Promise((resolve, reject) => {
      const onError = (error) => {
        httpServer.off("listening", onListening);
        reject(error);
      };
      const onListening = () => {
        httpServer.off("error", onError);
        const address = httpServer.address();
        if (!address || typeof address === "string") {
          reject(new Error("StreamSense server has no TCP address."));
          return;
        }
        resolve(address);
      };
      httpServer.once("error", onError);
      httpServer.once("listening", onListening);
      httpServer.listen(port, host);
    });
  }

  let closePromise = null;
  function close() {
    if (closePromise) return closePromise;
    closing = true;
    const sessionsToClose = [...sessions];
    closePromise = (async () => {
      await Promise.allSettled(sessionsToClose.map((session) => {
        const existing = sessionClosures.get(session);
        if (existing) return existing;
        const sessionClose = Promise.resolve()
          .then(() => session.close())
          .finally(() => {
            sessions.delete(session);
          });
        sessionClosures.set(session, sessionClose);
        return sessionClose;
      }));
      for (const browser of browserWss.clients) {
        if (browser.readyState !== WebSocket.CLOSED) browser.terminate();
      }
      await Promise.allSettled([closeWebSocketServer(browserWss), closeHttpServer(httpServer)]);
      const historyDrained = activeHistoryArchive.drain
        ? await Promise.resolve(activeHistoryArchive.drain({ timeoutMs: 2_000 })).catch(() => false)
        : true;
      // Do not close a repository underneath a still-running off-path archive.
      if (historyDrained) {
        await Promise.resolve(activeHistoryService.close?.()).catch(() => {});
      }
      eventStore.close();
    })();
    return closePromise;
  }

  return {
    app,
    httpServer,
    browserWss,
    eventStore,
    historyRepository: activeHistoryRepository,
    historyService: activeHistoryService,
    historyArchive: activeHistoryArchive,
    listen,
    close,
  };
}

function closeWebSocketServer(browserWss) {
  return new Promise((resolve, reject) => {
    browserWss.close((error) => (error ? reject(error) : resolve()));
  });
}

function closeHttpServer(httpServer) {
  if (!httpServer.listening) return Promise.resolve();
  return new Promise((resolve, reject) => {
    httpServer.close((error) => (error ? reject(error) : resolve()));
  });
}
