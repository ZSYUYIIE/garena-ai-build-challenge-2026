import { createHash, randomUUID } from "node:crypto";
import { WebSocket } from "ws";

import {
  eventCandidateSchema,
  formatTimestamp,
  normalizeTimestampSeconds,
  summarizeValidationError,
} from "../events/eventSchema.js";
import {
  analyzeVisionFrame,
  answerVisionQuestion,
} from "../gemini/vision.js";
import {
  buildNarrationEventCandidate,
  shouldSuppressVisualDescription,
} from "../gemini/transcript.js";
import { parseBrowserMessage } from "../protocol/browserMessages.js";
import { SessionRateLimiter } from "../protocol/sessionRateLimiter.js";

const CAMERA_NARRATION_TICK_SECONDS = 4;
const SCREEN_NARRATION_TICK_SECONDS = 3;

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

export class ClientSession {
  constructor(
    browser,
    eventStore,
    {
      apiKey,
      model,
      analyzeFrame = analyzeVisionFrame,
      answerQuestion = answerVisionQuestion,
      modelTurnTimeoutMs = 15_000,
      now = Date.now,
      rateLimiter = new SessionRateLimiter(),
    } = {}
  ) {
    this.browser = browser;
    this.eventStore = eventStore;
    this.apiKey = apiKey ?? "";
    this.model = model ?? "gemini-3.6-flash";
    this.analyzeFrame = analyzeFrame;
    this.answerQuestion = answerQuestion;
    this.modelTurnTimeoutMs = modelTurnTimeoutMs;
    this.now = now;
    this.rateLimiter = rateLimiter;
    this.sessionId = randomUUID();
    this.sessionStartedAt = this.now();
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
    this.activeTurn = null;
    this.modelTurnInProgress = false;
    this.currentTurnTranscript = "";
    this.currentTurnHasEvent = false;
    this.lastGroundedDescription = "";
    this.modelTurnId = 0;
    this.waitingForFirstFrameResolvers = [];
  }

  async start() {
    if (!this.apiKey) {
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
    this.sendBrowser({ type: "connected", model: this.model });
    this.sendBrowser({
      type: "status_text",
      text: `Waiting for the first ${this.captureSource} frame...`,
    });
    this.sendBrowser({ type: "status", mode: this.mode });
    void this.startNarrationLoop();
  }

  attachBrowserHandlers() {
    this.browser.on("message", (raw, isBinary) => {
      if (isBinary) {
        this.close(1003, "Binary extension commands are unsupported.");
        return;
      }

      let message;
      try {
        message = parseBrowserMessage(raw.toString());
      } catch {
        this.close(1008, "Invalid extension command.");
        return;
      }

      const rate = this.rateLimiter.accept(message.type, this.now());
      if (!rate.allowed) {
        this.close(1008, `Rate limit exceeded; retry in ${rate.retryAfterMs} ms.`);
        return;
      }
      this.handleBrowserJson(message);
    });

    this.browser.on("close", () => this.close());
    this.browser.on("error", () => this.close());
  }

  handleBrowserJson(message) {
    if (message.type === "capture_source") {
      this.captureSource = message.source;
      this.sendBrowser({
        type: "telemetry",
        text: `${message.source} narration every ${this.narrationTickSeconds}s`,
      });
      return;
    }

    if (message.type === "video_frame") {
      this.sendVideo(
        Buffer.from(message.data, "base64"),
        message.mimeType,
        message.timestampSeconds
      );
      return;
    }

    if (message.type === "session_config") {
      this.narrationLevel = message.narrationLevel;
      this.sendBrowser({
        type: "telemetry",
        text: `narration level: ${message.narrationLevel}`,
      });
      return;
    }

    this.answerTextQuestion(message.text);
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
        this.narrationTickSeconds * 1_000
      );
    };

    this.narrationTimer = setTimeout(
      tick,
      this.narrationTickSeconds * 1_000
    );
  }

  get narrationTickSeconds() {
    const baseInterval =
      this.captureSource === "screen"
        ? SCREEN_NARRATION_TICK_SECONDS
        : CAMERA_NARRATION_TICK_SECONDS;
    if (this.narrationLevel === NarrationLevel.MINIMAL) return baseInterval * 2;
    if (this.narrationLevel === NarrationLevel.DETAILED) {
      return Math.max(2, baseInterval - 1);
    }
    return baseInterval;
  }

  requestNarration(initial) {
    this.lastNarratedFrameNumber = this.videoFrames;
    const snapshot = this.captureFrameSnapshot();
    const turn = this.beginModelTurn(Mode.NARRATING, {
      initial,
      timestampSeconds: snapshot?.timestampSeconds ?? this.latestTimestampSeconds,
    });
    void this.runAtomicNarration(turn, initial, snapshot);
  }

  async runAtomicNarration(turn, initial, snapshot) {
    if (!snapshot) {
      this.finishModelTurn(turn.id, { interrupted: true });
      return;
    }

    try {
      const analysis = await this.analyzeFrame({
        apiKey: this.apiKey,
        model: this.model,
        frame: snapshot.frame,
        initial,
        narrationLevel: this.narrationLevel,
        previousDescription: this.lastGroundedDescription,
        timestampSeconds: snapshot.timestampSeconds,
        signal: turn.controller.signal,
      });
      if (!this.isCurrentTurn(turn.id)) return;

      if (analysis.event) {
        this.recordVisionEvent(analysis.event, snapshot.timestampSeconds);
      }
      if (
        analysis.shouldNarrate &&
        analysis.description &&
        !shouldSuppressVisualDescription(analysis.description)
      ) {
        this.currentTurnTranscript = analysis.description;
        this.lastGroundedDescription = analysis.description;
      }
      this.finishModelTurn(turn.id);
    } catch (error) {
      this.handleModelTurnError(turn, error);
    }
  }

  answerTextQuestion(question) {
    const cleanQuestion = question.trim();
    if (!cleanQuestion) return;

    this.mode = Mode.ANSWERING;
    this.sendBrowser({ type: "status", mode: this.mode });
    this.sendBrowser({ type: "user_transcript", text: cleanQuestion });
    const snapshot = this.captureFrameSnapshot();
    const turn = this.beginModelTurn(Mode.ANSWERING, {
      timestampSeconds: snapshot?.timestampSeconds ?? this.latestTimestampSeconds,
    });
    void this.runAtomicAnswer(turn, cleanQuestion, snapshot);
  }

  async runAtomicAnswer(turn, question, snapshot) {
    if (!snapshot) {
      this.currentTurnTranscript = "No video frame is available yet.";
      this.finishModelTurn(turn.id);
      return;
    }

    try {
      const answer = await this.answerQuestion({
        apiKey: this.apiKey,
        model: this.model,
        frame: snapshot.frame,
        question,
        recentEvents: this.eventStore.listBySession(this.sessionId, { limit: 12 }),
        signal: turn.controller.signal,
      });
      if (!this.isCurrentTurn(turn.id)) return;
      this.currentTurnTranscript = answer;
      this.finishModelTurn(turn.id);
    } catch (error) {
      this.handleModelTurnError(turn, error);
    }
  }

  beginModelTurn(responseMode, { initial = false, timestampSeconds = 0 } = {}) {
    this.interruptActiveTurn("Superseded by a newer model turn.");
    const controller = new AbortController();
    const turn = {
      id: ++this.modelTurnId,
      controller,
      responseMode,
      initial,
      timestampSeconds,
      timer: null,
    };
    this.activeTurn = turn;
    this.modelTurnInProgress = true;
    this.currentTurnTranscript = "";
    this.currentTurnHasEvent = false;
    this.sendBrowser({ type: "turn_started", mode: responseMode });
    turn.timer = setTimeout(() => {
      if (!this.isCurrentTurn(turn.id)) return;
      this.sendBrowser({
        type: "telemetry",
        text: "model turn timed out; narration loop resumed",
      });
      this.interruptActiveTurn("Model turn timed out.");
    }, this.modelTurnTimeoutMs);
    return turn;
  }

  isCurrentTurn(turnId) {
    return this.modelTurnInProgress && this.activeTurn?.id === turnId;
  }

  interruptActiveTurn(reason) {
    const turn = this.activeTurn;
    if (!turn) return;
    if (!turn.controller.signal.aborted) {
      turn.controller.abort(new DOMException(reason, "AbortError"));
    }
    this.finishModelTurn(turn.id, { interrupted: true });
  }

  handleModelTurnError(turn, error) {
    if (!this.isCurrentTurn(turn.id)) return;
    if (turn.controller.signal.aborted) {
      this.finishModelTurn(turn.id, { interrupted: true });
      return;
    }
    this.sendBrowser({ type: "analysis_error", text: toErrorMessage(error) });
    this.finishModelTurn(turn.id, { interrupted: true });
  }

  finishModelTurn(turnId, { interrupted = false } = {}) {
    const turn = this.activeTurn;
    if (!turn || turn.id !== turnId) return;

    if (turn.timer) clearTimeout(turn.timer);
    const transcript = this.currentTurnTranscript.trim();
    const suppressed =
      turn.responseMode === Mode.NARRATING &&
      shouldSuppressVisualDescription(transcript);
    const publishResponse = Boolean(!interrupted && !suppressed && transcript);
    const shouldCreateFallbackEvent =
      publishResponse &&
      turn.responseMode === Mode.NARRATING &&
      !this.currentTurnHasEvent;

    if (publishResponse) {
      this.sendBrowser({
        type:
          turn.responseMode === Mode.ANSWERING
            ? "answer_update"
            : "narration_update",
        text: transcript,
      });
    } else if (suppressed) {
      this.sendBrowser({
        type: "status_text",
        text: "Ignored an ungrounded or StreamSense self-description.",
      });
    }

    if (shouldCreateFallbackEvent) {
      this.recordNarrationEvent(
        transcript,
        turn.initial,
        turn.timestampSeconds
      );
    }

    this.sendBrowser({
      type: "turn_complete",
      mode: turn.responseMode,
      text: publishResponse ? transcript : "",
      interrupted,
      suppressed,
    });

    this.activeTurn = null;
    this.modelTurnInProgress = false;
    this.currentTurnTranscript = "";
    this.currentTurnHasEvent = false;

    if (turn.responseMode === Mode.ANSWERING) {
      this.mode = Mode.NARRATING;
      this.sendBrowser({ type: "status", mode: this.mode });
    }
  }

  recordNarrationEvent(description, initial, timestampSeconds) {
    try {
      const result = this.eventStore.record({
        ...buildNarrationEventCandidate(description, { initial }),
        sessionId: this.sessionId,
        timestampSeconds,
      });
      if (result.status === "recorded") this.publishEvent(result.event);
    } catch (error) {
      this.sendBrowser({
        type: "telemetry",
        text: `narration event rejected: ${summarizeValidationError(error)}`,
      });
    }
  }

  recordVisionEvent(candidate, timestampSeconds) {
    try {
      const validatedCandidate = eventCandidateSchema.parse(candidate);
      if (shouldSuppressVisualDescription(validatedCandidate.description)) return;
      const result = this.eventStore.record({
        ...validatedCandidate,
        sessionId: this.sessionId,
        timestampSeconds,
      });
      this.currentTurnHasEvent = true;
      if (result.status === "recorded") this.publishEvent(result.event);
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
    for (const resolve of this.waitingForFirstFrameResolvers.splice(0)) resolve();

    if (this.videoFrames === 1 || this.videoFrames % 10 === 0) {
      this.sendBrowser({
        type: "telemetry",
        text:
          `video frames sent: ${this.videoFrames} at ` +
          formatTimestamp(this.latestTimestampSeconds),
      });
    }
  }

  captureFrameSnapshot() {
    if (!this.latestFrame) return null;
    return Object.freeze({
      frame: Object.freeze({ ...this.latestFrame }),
      timestampSeconds: this.latestTimestampSeconds,
    });
  }

  get elapsedTimestampSeconds() {
    return Math.max(0, (this.now() - this.sessionStartedAt) / 1_000);
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

  close(code = 1000, reason = "Session closed") {
    if (this.closed) return;
    this.closed = true;
    if (this.narrationTimer) clearTimeout(this.narrationTimer);
    this.interruptActiveTurn(reason);
    for (const resolve of this.waitingForFirstFrameResolvers.splice(0)) resolve();
    if (this.browser.readyState === WebSocket.OPEN) {
      this.browser.close(code, reason);
    }
  }
}

function toErrorMessage(error) {
  return error instanceof Error ? error.message : String(error);
}
