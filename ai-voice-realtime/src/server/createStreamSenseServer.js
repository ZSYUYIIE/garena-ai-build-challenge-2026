import express from "express";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { WebSocket, WebSocketServer } from "ws";

import { EventStore } from "../events/eventStore.js";
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
  databasePath = ":memory:",
  eventStore = new EventStore({ databasePath }),
  sessionFactory,
  sessionOptions = {},
  staticDirectory = path.join(projectDirectory, "static"),
} = {}) {
  const createSession =
    sessionFactory ??
    ((browser, sessionEventStore) =>
      new ClientSession(browser, sessionEventStore, {
        apiKey,
        model,
        ...sessionOptions,
      }));

  const app = express();
  const httpServer = http.createServer(app);
  const browserWss = new WebSocketServer({
    noServer: true,
    maxPayload: MAX_WEBSOCKET_PAYLOAD_BYTES,
  });
  const sessions = new Set();
  let closing = false;

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
    if (!isAllowedExtensionOrigin(request.headers.origin)) {
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
    browser.once("close", () => sessions.delete(session));
    Promise.resolve(session.start()).catch((error) => {
      if (browser.readyState === WebSocket.OPEN) {
        browser.send(
          JSON.stringify({ type: "error", text: toErrorMessage(error) })
        );
      }
      session.close();
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

  async function close() {
    if (closing) return;
    closing = true;

    for (const session of sessions) session.close();
    for (const browser of browserWss.clients) {
      if (browser.readyState !== WebSocket.CLOSED) browser.terminate();
    }

    await Promise.all([
      closeWebSocketServer(browserWss),
      closeHttpServer(httpServer),
    ]);
    eventStore.close();
  }

  return {
    app,
    httpServer,
    browserWss,
    eventStore,
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

function toErrorMessage(error) {
  return error instanceof Error ? error.message : String(error);
}
