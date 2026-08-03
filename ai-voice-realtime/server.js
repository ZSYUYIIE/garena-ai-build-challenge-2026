import "dotenv/config";

import express from "express";
import { createHash, randomUUID } from "node:crypto";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { WebSocket, WebSocketServer } from "ws";

import { EventStore } from "./src/events/eventStore.js";
import {
  eventCandidateSchema,
  formatTimestamp,
  normalizeTimestampSeconds,
  summarizeValidationError,
} from "./src/events/eventSchema.js";
import {
  buildNarrationEventCandidate,
  shouldSuppressVisualDescription,
} from "./src/gemini/transcript.js";
import {
  analyzeVisionFrame,
  answerVisionQuestion,
} from "./src/gemini/vision.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const GOOGLE_API_KEY = process.env.GOOGLE_API_KEY || "";
const GEMINI_VISION_MODEL =
  process.env.GEMINI_VISION_MODEL || "gemini-2.5-flash";

const PORT = Number(process.env.PORT || 8000);
const HOST = process.env.HOST || "127.0.0.1";
const EVENT_DB_PATH =
  process.env.EVENT_DB_PATH || path.join(__dirname, "data", "streamsense.db");

const CAMERA_NARRATION_TICK_SECONDS = 4.0;
const SCREEN_NARRATION_TICK_SECONDS = 3.0;
const MODEL_TURN_TIMEOUT_MS = 15_000;

const Mode = Object.freeze({
  NARRATING: "narrating",
  ANSWERING: "answering",
});

const NarrationLevel = Object.freeze({
  MINIMAL: "minimal",
  STANDARD: "standard",
  DETAILED: "detailed",
  QUESTION_ONLY: "question_only",
});
const VALID_NARRATION_LEVELS = new Set(Object.values(NarrationLevel));

const app = express();
const server = http.createServer(app);
const browserWss = new WebSocketServer({ server, path: "/ws" });
const eventStore = new EventStore({ databasePath: EVENT_DB_PATH });

app.use("/static", express.static(path.join(__dirname, "static")));

app.get("/", (_req, res) => {
  res.sendFile(path.join(__dirname, "static", "index.html"));
});

app.get("/favicon.ico", (_req, res) => {
  res.status(204).end();
});

browserWss.on("connection", (browser) => {
  const session = new ClientSession(browser, eventStore);
  session.start().catch((error) => {
    session.sendBrowser({ type: "error", text: error.message });
    session.close();
  });
});

server.listen(PORT, HOST, () => {
  console.log(`Server running on http://${HOST}:${PORT}`);
});

server.on("error", (error) => {
  console.error(`Failed to start server on http://${HOST}:${PORT}: ${error.message}`);
  process.exitCode = 1;
});

class ClientSession {
  constructor(browser, sessionEventStore) {
    this.browser = browser;
    this.eventStore = sessionEventStore;
    this.sessionId = randomUUID();
    this.sessionStartedAt = Date.now();
    this.mode = Mode.NARRATING;
    this.closed = false;
    this.firstVideoFrame = false;
    this.videoFrames = 0;
    this.lastNarratedFrameNumber = 0;
    this.latestTimestampSeconds = 0;
    this.latestFrame = null;
    this.captureSource = "camera";
    this.narrationLevel = NarrationLevel.STANDARD;
    this.narrationTimer = null;
    this.modelTurnTimer = null;
    this.modelTurnInProgress = false;
    this.activeResponseMode = null;
    this.currentTurnTranscript = "";
    this.currentTurnHasEvent = false;
    this.currentTurnIsInitial = false;
    this.modelTurnId = 0;
    this.lastGroundedDescription = "";
    this.waitingForFirstFrameResolvers = [];
  }

  async start() {
    if (!GOOGLE_API_KEY) {
      this.sendBrowser({
        type: "error",
        text: "Missing GOOGLE_API_KEY. Add it to .env or export it in your shell.",
      });
      this.closeSoon();
      return;
    }

    this.sendBrowser({
      type: "status_text",
      text: "Preparing grounded frame analysis...",
    });

    this.attachBrowserHandlers();
    this.sendBrowser({ type: "connected", model: GEMINI_VISION_MODEL });

    this.sendBrowser({
      type: "status_text",
      text: `Waiting for the first ${this.captureSource} frame...`,
    });
    this.sendBrowser({ type: "status", mode: this.mode });
    this.startNarrationLoop();
  }

  attachBrowserHandlers() {
    this.browser.on("message", (raw, isBinary) => {
      if (isBinary) {
        this.sendVideo(Buffer.from(raw), "image/jpeg");
        return;
      }

      let message;
      try {
        message = JSON.parse(raw.toString());
      } catch {
        this.sendBrowser({ type: "error", text: "Invalid browser message JSON." });
        return;
      }
      this.handleBrowserJson(message);
    });

    this.browser.on("close", () => this.close());
    this.browser.on("error", () => this.close());
  }

  handleBrowserJson(message) {
    const kind = message.type;

    if (kind === "capture_source") {
      const source = message.source;
      if (source === "camera" || source === "screen") {
        this.captureSource = source;
        this.sendBrowser({
          type: "telemetry",
          text: `${source} narration every ${this.narrationTickSeconds}s`,
        });
      }
      return;
    }

    if (kind === "video_frame") {
      const fallbackTimestamp = this.elapsedTimestampSeconds;
      this.sendVideo(
        Buffer.from(message.data || "", "base64"),
        message.mimeType || "image/jpeg",
        normalizeTimestampSeconds(message.timestampSeconds, fallbackTimestamp)
      );
      return;
    }

    if (kind === "session_config") {
      const narrationLevel = message.narrationLevel;
      if (VALID_NARRATION_LEVELS.has(narrationLevel)) {
        this.narrationLevel = narrationLevel;
        this.sendBrowser({
          type: "telemetry",
          text: `narration level: ${narrationLevel}`,
        });
      }
      return;
    }

    if (kind === "typed_question") {
      this.answerTextQuestion(message.text || "");
    }
  }

  async startNarrationLoop() {
    await this.waitForFirstVideoFrame();
    if (this.closed) return;

    this.sendBrowser({ type: "status_text", text: "Observing the active tab." });
    this.requestNarration(true);

    const tick = () => {
      if (this.closed) return;
      if (
        this.mode === Mode.NARRATING &&
        !this.modelTurnInProgress &&
        this.videoFrames > this.lastNarratedFrameNumber
      ) {
        this.sendBrowser({ type: "telemetry", text: "narration prompt sent" });
        this.requestNarration(false);
      }
      this.narrationTimer = setTimeout(
        tick,
        this.narrationTickSeconds * 1000
      );
    };

    this.narrationTimer = setTimeout(tick, this.narrationTickSeconds * 1000);
  }

  get narrationTickSeconds() {
    const baseInterval = this.captureSource === "screen"
      ? SCREEN_NARRATION_TICK_SECONDS
      : CAMERA_NARRATION_TICK_SECONDS;

    if (this.narrationLevel === NarrationLevel.MINIMAL) {
      return baseInterval * 2;
    }
    if (this.narrationLevel === NarrationLevel.DETAILED) {
      return Math.max(2, baseInterval - 1);
    }
    return baseInterval;
  }

  requestNarration(initial) {
    this.lastNarratedFrameNumber = this.videoFrames;
    const turnId = this.beginModelTurn(Mode.NARRATING, { initial });
    void this.runAtomicNarration(turnId, initial);
  }

  async runAtomicNarration(turnId, initial) {
    const frame = this.latestFrame;
    if (!frame) {
      this.finishModelTurn({ interrupted: true });
      return;
    }

    try {
      const analysis = await analyzeVisionFrame({
        apiKey: GOOGLE_API_KEY,
        model: GEMINI_VISION_MODEL,
        frame,
        initial,
        narrationLevel: this.narrationLevel,
        previousDescription: this.lastGroundedDescription,
        timestampSeconds: this.latestTimestampSeconds,
      });
      if (!this.isCurrentTurn(turnId)) return;

      if (analysis.event) {
        this.recordVisionEvent(analysis.event);
      }
      if (
        analysis.shouldNarrate &&
        analysis.description &&
        !shouldSuppressVisualDescription(analysis.description)
      ) {
        this.currentTurnTranscript = analysis.description;
        this.lastGroundedDescription = analysis.description;
      }
      this.finishModelTurn();
    } catch (error) {
      if (!this.isCurrentTurn(turnId)) return;
      this.sendBrowser({ type: "analysis_error", text: error.message });
      this.finishModelTurn({ interrupted: true });
    }
  }

  answerTextQuestion(question) {
    const cleanQuestion = question.trim();
    if (!cleanQuestion) return;

    if (this.modelTurnInProgress) {
      this.finishModelTurn({ interrupted: true });
    }
    this.mode = Mode.ANSWERING;
    this.sendBrowser({ type: "status", mode: this.mode });
    this.sendBrowser({ type: "user_transcript", text: cleanQuestion });
    const turnId = this.beginModelTurn(Mode.ANSWERING);
    void this.runAtomicAnswer(turnId, cleanQuestion);
  }

  async runAtomicAnswer(turnId, question) {
    const frame = this.latestFrame;
    if (!frame) {
      this.currentTurnTranscript = "No video frame is available yet.";
      this.finishModelTurn();
      return;
    }

    try {
      const answer = await answerVisionQuestion({
        apiKey: GOOGLE_API_KEY,
        model: GEMINI_VISION_MODEL,
        frame,
        question,
        recentEvents: this.eventStore.listBySession(this.sessionId, { limit: 12 }),
      });
      if (!this.isCurrentTurn(turnId)) return;
      this.currentTurnTranscript = answer;
      this.finishModelTurn();
    } catch (error) {
      if (!this.isCurrentTurn(turnId)) return;
      this.sendBrowser({ type: "analysis_error", text: error.message });
      this.finishModelTurn({ interrupted: true });
    }
  }

  beginModelTurn(responseMode, { initial = false } = {}) {
    if (this.modelTurnTimer) clearTimeout(this.modelTurnTimer);
    this.modelTurnInProgress = true;
    this.activeResponseMode = responseMode;
    this.currentTurnTranscript = "";
    this.currentTurnHasEvent = false;
    this.currentTurnIsInitial = initial;
    this.modelTurnId += 1;
    const turnId = this.modelTurnId;
    this.sendBrowser({ type: "turn_started", mode: responseMode });
    this.modelTurnTimer = setTimeout(() => {
      this.sendBrowser({
        type: "telemetry",
        text: "model turn timed out; narration loop resumed",
      });
      this.finishModelTurn({ interrupted: true });
    }, MODEL_TURN_TIMEOUT_MS);
    return turnId;
  }

  isCurrentTurn(turnId) {
    return this.modelTurnInProgress && this.modelTurnId === turnId;
  }

  finishModelTurn({ interrupted = false } = {}) {
    if (!this.modelTurnInProgress) return;

    if (this.modelTurnTimer) clearTimeout(this.modelTurnTimer);
    this.modelTurnTimer = null;

    const responseMode = this.activeResponseMode || this.mode;
    const transcript = this.currentTurnTranscript.trim();
    const suppressed =
      responseMode === Mode.NARRATING &&
      shouldSuppressVisualDescription(transcript);
    const publishResponse = !interrupted && !suppressed && transcript;
    const shouldCreateFallbackEvent =
      publishResponse &&
      responseMode === Mode.NARRATING &&
      !this.currentTurnHasEvent;

    if (publishResponse) {
      this.sendBrowser({
        type: responseMode === Mode.ANSWERING ? "answer_update" : "narration_update",
        text: transcript,
      });
    } else if (suppressed) {
      this.sendBrowser({
        type: "status_text",
        text: "Ignored an ungrounded or StreamSense self-description.",
      });
    }

    if (shouldCreateFallbackEvent) {
      this.recordNarrationEvent(transcript, this.currentTurnIsInitial);
    }

    this.sendBrowser({
      type: "turn_complete",
      mode: responseMode,
      text: publishResponse ? transcript : "",
      interrupted,
      suppressed,
    });

    this.modelTurnInProgress = false;
    this.activeResponseMode = null;
    this.currentTurnTranscript = "";
    this.currentTurnHasEvent = false;
    this.currentTurnIsInitial = false;

    if (responseMode === Mode.ANSWERING) {
      this.mode = Mode.NARRATING;
      this.sendBrowser({ type: "status", mode: this.mode });
    }
  }

  recordNarrationEvent(description, initial) {
    try {
      const result = this.eventStore.record({
        ...buildNarrationEventCandidate(description, { initial }),
        sessionId: this.sessionId,
        timestampSeconds: this.latestTimestampSeconds,
      });
      if (result.status === "recorded") {
        this.publishEvent(result.event);
      }
    } catch (error) {
      this.sendBrowser({
        type: "telemetry",
        text: `narration event rejected: ${summarizeValidationError(error)}`,
      });
    }
  }

  recordVisionEvent(candidate) {
    try {
      const validatedCandidate = eventCandidateSchema.parse(candidate);
      if (shouldSuppressVisualDescription(validatedCandidate.description)) return;
      const result = this.eventStore.record({
        ...validatedCandidate,
        sessionId: this.sessionId,
        timestampSeconds: this.latestTimestampSeconds,
      });
      this.currentTurnHasEvent = true;
      if (result.status === "recorded") {
        this.publishEvent(result.event);
      }
    } catch (error) {
      this.sendBrowser({
        type: "telemetry",
        text: `vision event rejected: ${summarizeValidationError(error)}`,
      });
    }
  }

  publishEvent(event) {
    const { sessionId: _sessionId, ...publicEvent } = event;
    this.sendBrowser({ type: "event", event: publicEvent });
    this.sendBrowser({
      type: "telemetry",
      text: `event recorded: ${publicEvent.eventType} at ${publicEvent.timestamp}`,
    });
  }

  sendVideo(jpegBytes, mimeType, timestampSeconds = this.elapsedTimestampSeconds) {
    if (!jpegBytes.length) return;

    const frameHash = createHash("sha256").update(jpegBytes).digest("hex");
    if (this.latestFrame?.hash === frameHash) return;

    this.videoFrames += 1;
    this.latestTimestampSeconds = normalizeTimestampSeconds(
      timestampSeconds,
      this.elapsedTimestampSeconds
    );
    this.firstVideoFrame = true;
    this.latestFrame = {
      data: Buffer.from(jpegBytes).toString("base64"),
      hash: frameHash,
      mimeType,
    };
    for (const resolve of this.waitingForFirstFrameResolvers.splice(0)) {
      resolve();
    }

    if (this.videoFrames === 1 || this.videoFrames % 10 === 0) {
      this.sendBrowser({
        type: "telemetry",
        text:
          `video frames sent: ${this.videoFrames} at ` +
          formatTimestamp(this.latestTimestampSeconds),
      });
    }
  }

  get elapsedTimestampSeconds() {
    return Math.max(0, (Date.now() - this.sessionStartedAt) / 1000);
  }

  sendBrowser(message) {
    if (this.browser.readyState === WebSocket.OPEN) {
      this.browser.send(JSON.stringify(message));
    }
  }

  waitForFirstVideoFrame() {
    if (this.firstVideoFrame) return Promise.resolve();
    return new Promise((resolve) => {
      this.waitingForFirstFrameResolvers.push(resolve);
    });
  }

  closeSoon() {
    setTimeout(() => this.close(), 250);
  }

  close() {
    if (this.closed) return;
    this.closed = true;
    if (this.narrationTimer) clearTimeout(this.narrationTimer);
    if (this.modelTurnTimer) clearTimeout(this.modelTurnTimer);
    for (const resolve of this.waitingForFirstFrameResolvers.splice(0)) {
      resolve();
    }
    if (this.browser.readyState === WebSocket.OPEN) {
      this.browser.close(1000, "Session closed");
    }
  }
}
