import { createHash, randomUUID } from "node:crypto";
import { WebSocket } from "ws";

import { eventCandidateSchema, formatTimestamp, normalizeTimestampSeconds, summarizeValidationError } from "../events/eventSchema.js";
import { analyzeVisionFrame } from "../gemini/vision.js";
import { GroundedVisibleStateCache, validateEventEvidence } from "../gemini/visualState.js";
import { GeminiLiveSession } from "../gemini/liveSession.js";
import { buildNarrationEventCandidate, shouldSuppressVisualDescription } from "../gemini/transcript.js";
import { parseAudioPacket, AudioSequenceGuard } from "../protocol/audioPackets.js";
import { parseBrowserMessage, parseServerOutput, PROTOCOL_VERSION } from "../protocol/browserMessages.js";
import { SessionRateLimiter } from "../protocol/sessionRateLimiter.js";
import { SpeechPolicy } from "./speechPolicy.js";
import { GoogleSpeechTranscriber } from "../stt/googleSpeechTranscriber.js";
import { TabTranscriptBuffer } from "../transcript/tabTranscriptBuffer.js";

const OUTPUT_BUFFER_LIMIT_BYTES = 256 * 1024;
const LIVE_FRAME_INTERVAL_MS = 1_000;
const ANALYSIS_RETRY_DELAY_MS = 1_000;
const MAX_TAB_PACKET_GAP_MS = 500;
const MAX_COMPLETED_TURNS = 256;

const NarrationLevel = Object.freeze({
  MINIMAL: "minimal",
  STANDARD: "standard",
  DETAILED: "detailed",
  QUESTION_ONLY: "question_only",
});

function safeProviderState(value) {
  return ["connecting", "ready", "degraded", "closed", "telemetry"].includes(value)
    ? value
    : "degraded";
}

/** Coordinates extension protocol-v2, atomic visual analysis, Live, STT and policy. */
export class ClientSession {
  constructor(browser, eventStore, {
    apiKey = "",
    model = "gemini-3.6-flash",
    liveModel = "gemini-3.1-flash-live-preview",
    speechProjectId = "",
    speechLocation = "us",
    analyzeFrame = analyzeVisionFrame,
    now = Date.now,
    timers = globalThis,
    rateLimiter = new SessionRateLimiter(),
    audioSequenceGuard = new AudioSequenceGuard(),
    tabTranscriptBuffer,
    recentTabTranscript,
    speechPolicy,
    liveSessionFactory,
    transcriberFactory,
  } = {}) {
    this.browser = browser;
    this.eventStore = eventStore;
    this.apiKey = apiKey;
    this.model = model;
    this.liveModel = liveModel;
    this.speechProjectId = speechProjectId;
    this.speechLocation = speechLocation;
    this.analyzeFrame = analyzeFrame;
    this.now = now;
    this.timers = timers;
    this.rateLimiter = rateLimiter;
    this.audioSequenceGuard = audioSequenceGuard;
    this.sessionId = randomUUID();
    this.sessionStartedAt = now();
    this.tabTranscriptBuffer = tabTranscriptBuffer ?? new TabTranscriptBuffer({
      nowBackendSessionMs: () => this.elapsedMilliseconds,
    });
    this.recentTabTranscript = recentTabTranscript;
    this.speechPolicy = speechPolicy ?? new SpeechPolicy({
      nowBackendSessionMs: () => this.elapsedMilliseconds,
    });
    this.liveSessionFactory = liveSessionFactory ?? ((options) => new GeminiLiveSession(options));
    this.transcriberFactory = transcriberFactory ?? ((options) => new GoogleSpeechTranscriber(options));

    this.helloReceived = false;
    this.initialTabAudioState = null;
    this.tabAudioState = "absent";
    this.microphoneState = "pending";
    this.live = null;
    this.transcriber = null;
    this.liveHealth = "connecting";
    this.activeAtomicAnalysis = null;
    this.pendingAtomicNarration = null;
    this.atomicRetryTimer = null;
    this.activeSpeechTurn = null;
    this.completedTurnIds = new Set();
    this.closed = false;
    this.closePromise = null;
    this.captureSource = "camera";
    this.narrationLevel = NarrationLevel.STANDARD;
    this.latestTimestampSeconds = 0;
    this.latestFrame = null;
    this.videoFrames = 0;
    this.firstVideoFrame = false;
    this.lastFrameAcceptedAtMs = 0;
    this.lastGroundedDescription = "";
    this.visibleStateCache = new GroundedVisibleStateCache();
    this.groundedSemanticState = { semanticKey: null, originAcceptedAtMs: null, observedFrameSequence: 0 };
    this.lastTabPacketTimestampMs = null;
    this.speechPolicyTimer = null;
    this.liveFrameTimer = null;
    this.lastLiveFrameAtMs = Number.NEGATIVE_INFINITY;
    this.pendingLiveFrame = null;
    this.userTurnEpoch = 0;
    this.transcriberGeneration = 0;
    this.tabContextRecoveryPromise = null;
  }

  async start() {
    this.attachBrowserHandlers();
  }

  attachBrowserHandlers() {
    this.browser.on("message", (raw, isBinary) => {
      if (this.closed) return;
      if (isBinary) {
        if (!this.helloReceived) return this.protocolViolation("session_hello is required before binary data");
        this.handleBrowserAudio(raw);
        return;
      }
      let message;
      try { message = parseBrowserMessage(raw.toString()); } catch { return this.protocolViolation("Invalid extension command."); }
      if (!this.helloReceived && message.type !== "session_hello") {
        return this.protocolViolation("session_hello is required before commands");
      }
      const rate = this.rateLimiter.accept(message.type, this.now());
      if (!rate.allowed) return this.protocolViolation("Rate limit exceeded.");
      this.handleBrowserJson(message);
    });
    this.browser.on("close", () => { void this.close(); });
    this.browser.on("error", () => { void this.close(); });
  }

  handleBrowserJson(message) {
    switch (message.type) {
      case "session_hello":
        if (this.helloReceived) return this.protocolViolation("session_hello may only be sent once");
        return void this.acceptHello(message);
      case "capture_source":
        this.captureSource = message.source;
        this.sendBrowser({ type: "telemetry", text: `${message.source} capture selected` });
        return;
      case "session_config":
        this.narrationLevel = message.narrationLevel;
        return;
      case "video_frame":
        this.sendVideo(Buffer.from(message.data, "base64"), message.mimeType, message.timestampSeconds, { scheduleNarration: true });
        return;
      case "typed_question":
        return this.beginAnswerTurn({ turnId: message.turnId, source: "typed", text: message.text });
      case "user_activity_start":
        return this.beginAnswerTurn({ turnId: message.turnId, source: "microphone" });
      case "user_activity_end":
        if (!this.activeSpeechTurn || this.activeSpeechTurn.turnId !== message.turnId || this.activeSpeechTurn.source !== "microphone" || !this.activeSpeechTurn.openActivity) {
          return this.protocolViolation("user activity end does not match an open turn");
        }
        this.activeSpeechTurn.openActivity = false;
        this.live?.endUserActivity?.(message.turnId);
        return;
      case "tab_audio_activity":
        return this.handleTabSpeech(message.active);
      case "tab_audio_discontinuity":
        return void this.degradeTabContext();
      case "media_state":
        return this.handleMediaState(message);
      default:
        return this.protocolViolation("Unsupported protocol command");
    }
  }

  async acceptHello(message) {
    this.helloReceived = true;
    this.initialTabAudioState = message.tabAudioState;
    this.tabAudioState = message.tabAudioState;
    this.microphoneState = message.microphoneState;
    this.sendBrowser({ type: "connected", protocolVersion: PROTOCOL_VERSION, model: this.liveModel });
    this.sendBrowser({ type: "status", mode: "narration" });
    // Captured audio is unknown until the cloud stream proves it is clean.
    this.applySpeechActions(this.speechPolicy.setTabAudioState?.(
      message.tabAudioState === "absent" ? "absent" : "degraded",
    ) ?? []);
    const liveOptions = {
      apiKey: this.apiKey,
      model: this.liveModel,
      getRecentTranscript: (options) => this.tabTranscriptBuffer.getRecent(options),
      onAudio: (event) => this.handleLiveMessage({ type: "audio", ...event }),
      onInputTranscript: (event) => this.handleLiveMessage({ type: "input_transcript", ...event }),
      onOutputTranscript: (event) => this.handleLiveMessage({ type: "output_transcript", ...event }),
      onTurnComplete: (event) => this.handleLiveMessage({ type: "turn_complete", ...event }),
      onPlaybackClear: (event) => this.handleLiveMessage({ type: "playback_clear", ...event }),
      onHealth: (event) => this.handleLiveMessage({ type: "health", ...event }),
      now: this.now,
    };
    try {
      this.live = this.liveSessionFactory(liveOptions);
    } catch {
      this.live = null;
      this.handleLiveMessage({ type: "health", state: "degraded" });
    }
    if (message.tabAudioState === "captured") {
      this.createCapturedTranscriber();
    }
    const startLive = this.live
      ? Promise.resolve().then(() => this.live.start?.()).catch(() => {
        this.handleLiveMessage({ type: "health", state: "degraded" });
      })
      : Promise.resolve();
    const startTranscriber = this.transcriber
      ? Promise.resolve().then(() => this.transcriber.start?.()).catch(() => {
        this.handleSttHealth("degraded");
      })
      : Promise.resolve();
    await Promise.allSettled([startLive, startTranscriber]);
    this.scheduleSpeechPolicyWake();
  }

  createCapturedTranscriber() {
    const generation = ++this.transcriberGeneration;
    const current = () => generation === this.transcriberGeneration;
    const transcriberOptions = {
      projectId: this.speechProjectId,
      location: this.speechLocation,
      onSpeechState: (active) => {
        if (current()) this.handleTabSpeech(active, "cloud");
      },
      onFinal: (segment) => {
        if (current()) this.handleSttFinal(segment);
      },
      onHealth: (state) => {
        if (current()) this.handleSttHealth(state);
      },
    };
    try {
      this.transcriber = this.transcriberFactory(transcriberOptions);
    } catch {
      this.transcriber = null;
      this.handleSttHealth("degraded");
    }
    return this.transcriber;
  }

  startCapturedTranscriber() {
    const transcriber = this.transcriber ?? this.createCapturedTranscriber();
    if (!transcriber) return Promise.resolve();
    return Promise.resolve()
      .then(() => transcriber.start?.())
      .catch(() => {
        if (this.transcriber === transcriber) this.handleSttHealth("degraded");
      });
  }

  handleBrowserAudio(raw) {
    let packet;
    try { packet = parseAudioPacket(raw, this.audioSequenceGuard); } catch { return this.protocolViolation("Invalid audio packet"); }
    if (packet.source === "microphone") {
      if (!this.activeSpeechTurn?.openActivity || this.activeSpeechTurn.source !== "microphone") {
        return this.protocolViolation("microphone PCM is outside an open user activity");
      }
      const rate = this.rateLimiter.accept("audio_microphone", this.now());
      if (!rate.allowed) return this.protocolViolation("microphone rate limit exceeded");
      this.live?.sendMicrophonePcm?.(packet.pcm);
      return;
    }
    if (this.tabAudioState !== "captured") {
      return this.protocolViolation("tab PCM requires captured tab audio");
    }
    if (!this.transcriber) {
      void this.degradeTabContext();
      return;
    }
    if (this.lastTabPacketTimestampMs !== null && (
      packet.timestampMs < this.lastTabPacketTimestampMs
      || packet.timestampMs - this.lastTabPacketTimestampMs > MAX_TAB_PACKET_GAP_MS
    )) {
      this.lastTabPacketTimestampMs = null;
      return void this.degradeTabContext();
    }
    this.lastTabPacketTimestampMs = packet.timestampMs;
    const rate = this.rateLimiter.accept("audio_tab", this.now());
    if (!rate.allowed) return void this.degradeTabContext();
    const result = this.transcriber.write?.(packet.pcm, this.elapsedMilliseconds);
    if (result === "degraded") void this.degradeTabContext();
  }

  beginAnswerTurn({ turnId = randomUUID(), source = "typed", text = "" } = {}) {
    if (this.completedTurnIds.has(turnId) || this.activeSpeechTurn?.turnId === turnId) {
      return this.protocolViolation("turnId has already been used");
    }
    this.userTurnEpoch += 1;
    if (this.activeSpeechTurn) this.discardSpeechTurn(this.activeSpeechTurn, "barge_in");
    this.applySpeechActions(this.speechPolicy.startUserTurn?.(turnId) ?? []);
    const turn = { turnId, mode: "answer", source, openActivity: source === "microphone", completed: false };
    this.activeSpeechTurn = turn;
    this.sendBrowser({ type: "turn_started", turnId, mode: "answer" });
    if (source === "typed") this.sendBrowser({ type: "user_transcript", turnId, mode: "answer", text, finished: true });
    if (!this.live || this.liveHealth !== "ready") {
      return this.completeSpeechTurn(turn, { interrupted: true, retryable: true });
    }
    try {
      if (source === "typed") this.live.askTyped?.(turnId, text);
      else this.live.startUserActivity?.(turnId);
    } catch {
      this.completeSpeechTurn(turn, { interrupted: true, retryable: true });
    }
    this.scheduleSpeechPolicyWake();
  }

  handleTabSpeech(active, source = "local") {
    const actions = source === "cloud"
      ? this.speechPolicy.setCloudTabSpeech?.(active) ?? []
      : this.speechPolicy.setLocalTabSpeech?.(active) ?? [];
    this.applySpeechActions(actions);
    this.applySpeechActions(this.speechPolicy.poll?.() ?? []);
    this.scheduleSpeechPolicyWake();
  }

  handleMediaState(message) {
    if (message.tabAudioState === "absent" && this.initialTabAudioState !== "absent") {
      return this.protocolViolation("captured audio cannot become absent");
    }
    const previousTabAudioState = this.tabAudioState;
    this.tabAudioState = message.tabAudioState;
    this.microphoneState = message.microphoneState;
    if (message.tabAudioState !== "captured" || previousTabAudioState !== "captured") {
      this.applySpeechActions(this.speechPolicy.setTabAudioState?.(
        message.tabAudioState === "captured" ? "degraded" : message.tabAudioState,
      ) ?? []);
    }
    if (message.tabAudioState !== "captured") {
      const oldTranscriber = this.transcriber;
      this.transcriber = null;
      this.transcriberGeneration += 1;
      void Promise.resolve(oldTranscriber?.close?.()).catch(() => {});
    } else if (previousTabAudioState !== "captured" && !this.transcriber) {
      void this.startCapturedTranscriber();
    }
    this.scheduleSpeechPolicyWake();
  }

  degradeTabContext() {
    if (this.closed) return Promise.resolve();
    this.applySpeechActions(this.speechPolicy.setTabAudioState?.("degraded") ?? []);
    if (this.tabContextRecoveryPromise) return this.tabContextRecoveryPromise;
    const transcriber = this.transcriber;
    const recovery = Promise.resolve()
      .then(() => {
        if (this.closed || this.transcriber !== transcriber) return;
        return transcriber?.markDiscontinuity?.();
      })
      .catch(() => {
        // STT provider detail is intentionally not sent to the extension.
      })
      .finally(() => {
        if (this.tabContextRecoveryPromise === recovery) this.tabContextRecoveryPromise = null;
      });
    this.tabContextRecoveryPromise = recovery;
    this.scheduleSpeechPolicyWake();
    return recovery;
  }

  handleSttHealth(state) {
    const providerState = safeProviderState(state);
    if (providerState === "ready" && this.tabAudioState === "captured") {
      this.applySpeechActions(this.speechPolicy.setTabAudioState?.("healthy") ?? []);
    } else if (providerState === "connecting" && this.tabAudioState === "captured") {
      this.applySpeechActions(this.speechPolicy.setTabAudioState?.("degraded") ?? []);
    } else if (providerState === "degraded" || providerState === "closed") {
      void this.degradeTabContext();
    }
    this.sendBrowser({ type: "provider_health", provider: "tab_stt", state: providerState });
    this.applySpeechActions(this.speechPolicy.poll?.() ?? []);
    this.scheduleSpeechPolicyWake();
  }

  handleSttFinal(segment) {
    try { this.tabTranscriptBuffer.appendFinal(segment); } catch { /* provider input is ignored, never forwarded to Live */ }
  }

  handleNarrationCandidate(candidate) {
    this.applySpeechActions(this.speechPolicy.offerNarration?.(candidate) ?? []);
    this.applySpeechActions(this.speechPolicy.poll?.() ?? []);
    this.scheduleSpeechPolicyWake();
  }

  applySpeechActions(actions) {
    for (const action of actions) {
      if (action.type === "start_narration") {
        const turnId = randomUUID();
        const turn = { turnId, mode: "narration", source: "policy", openActivity: false, completed: false };
        if (!this.live || this.liveHealth !== "ready") {
          this.invalidateNarrationDispatch(turn, action, this.liveHealth === "closed" ? "closed" : "connecting");
          continue;
        }
        try {
          this.live.speakNarration?.(turnId, action.candidate.description);
          this.activeSpeechTurn = turn;
          this.sendBrowser({ type: "narration_update", turnId, mode: "narration", text: action.candidate.description, finished: false });
          this.applySpeechActions(this.speechPolicy.markNarrationStarted?.(turnId, action.reservationId) ?? []);
        } catch {
          this.liveHealth = "degraded";
          this.invalidateNarrationDispatch(turn, action, "degraded");
        }
      } else if (action.type === "cancel_narration") {
        const active = this.activeSpeechTurn?.turnId === action.turnId
          ? this.activeSpeechTurn
          : null;
        const turn = active ?? { turnId: action.turnId, mode: "narration", completed: false };
        this.discardSpeechTurn(turn, "policy_cancel", { retryable: !active });
      }
    }
    this.scheduleSpeechPolicyWake();
  }

  invalidateNarrationDispatch(turn, action, state) {
    const invalidations = this.speechPolicy.setLiveState?.(state) ?? [];
    this.applySpeechActions(invalidations);
    const settlement = this.speechPolicy.markNarrationStarted?.(
      turn.turnId,
      action.reservationId,
    ) ?? [{ type: "cancel_narration", turnId: turn.turnId }];
    this.applySpeechActions(settlement);
  }

  scheduleSpeechPolicyWake() {
    if (this.speechPolicyTimer) this.timers.clearTimeout(this.speechPolicyTimer);
    this.speechPolicyTimer = null;
    if (this.closed) return;
    const wakeAt = this.speechPolicy.nextWakeAtMs?.();
    if (!Number.isFinite(wakeAt)) return;
    const delay = Math.max(0, wakeAt - this.elapsedMilliseconds);
    this.speechPolicyTimer = this.timers.setTimeout(() => {
      this.speechPolicyTimer = null;
      this.applySpeechActions(this.speechPolicy.poll?.() ?? []);
      this.scheduleSpeechPolicyWake();
    }, delay);
  }

  handleLiveMessage(event) {
    if (this.closed) return;
    if (event.type === "health") {
      const state = safeProviderState(event.state);
      if (state === "telemetry") {
        this.sendBrowser({ type: "telemetry", text: String(event.message ?? "Live diagnostic event.") });
        return;
      }
      this.liveHealth = state;
      this.applySpeechActions(this.speechPolicy.setLiveState?.(state) ?? []);
      this.sendBrowser({ type: "provider_health", provider: "live", state });
      this.applySpeechActions(this.speechPolicy.poll?.() ?? []);
      return this.scheduleSpeechPolicyWake();
    }
    const turn = this.activeSpeechTurn;
    if (event.turnId && turn?.turnId !== event.turnId) return;
    if (event.type === "audio") {
      if (turn) this.sendBrowser({ type: "model_audio", turnId: turn.turnId, mode: turn.mode, data: event.data, mimeType: event.mimeType }, { audio: true });
      return;
    }
    if (event.type === "playback_clear") {
      if (turn) this.sendPlaybackClear(turn, event.reason ?? "interrupted");
      return;
    }
    if (event.type === "input_transcript" && turn?.mode === "answer") {
      this.sendBrowser({ type: "user_transcript", turnId: turn.turnId, mode: "answer", text: event.text, finished: event.finished === true, languageCode: event.languageCode });
      return;
    }
    if (event.type === "output_transcript" && turn) {
      this.sendBrowser({ type: turn.mode === "answer" ? "answer_update" : "narration_update", turnId: turn.turnId, mode: turn.mode, text: event.text, finished: event.finished === true, languageCode: event.languageCode });
      return;
    }
    if (event.type === "turn_complete" && turn) {
      this.completeSpeechTurn(turn, event);
    }
  }

  completeSpeechTurn(turn, { interrupted = false, retryable = false } = {}) {
    if (!turn || turn.completed) return;
    turn.completed = true;
    if (this.activeSpeechTurn === turn) this.activeSpeechTurn = null;
    this.applySpeechActions(this.speechPolicy.finishTurn?.(turn.turnId) ?? []);
    this.rememberCompletedTurn(turn.turnId);
    this.sendTurnComplete(turn, { interrupted, retryable });
    this.scheduleSpeechPolicyWake();
  }

  discardSpeechTurn(turn, reason, { retryable = false } = {}) {
    if (!turn || turn.completed) return;
    turn.completed = true;
    if (this.activeSpeechTurn === turn) this.activeSpeechTurn = null;
    this.applySpeechActions(this.speechPolicy.finishTurn?.(turn.turnId) ?? []);
    this.live?.discardOutput?.(turn.turnId);
    this.sendPlaybackClear(turn, reason);
    this.rememberCompletedTurn(turn.turnId);
    this.sendTurnComplete(turn, { interrupted: true, retryable });
  }

  sendPlaybackClear(turn, reason) {
    if (turn.playbackCleared) return;
    turn.playbackCleared = true;
    this.sendBrowser({ type: "playback_clear", turnId: turn.turnId, mode: turn.mode, reason });
  }

  sendTurnComplete(turn, { interrupted = false, retryable = false } = {}) {
    if (turn.completionSent) return;
    turn.completionSent = true;
    this.sendBrowser({
      type: "turn_complete",
      turnId: turn.turnId,
      mode: turn.mode,
      interrupted: interrupted === true,
      retryable: retryable === true,
    });
  }

  rememberCompletedTurn(turnId) {
    this.completedTurnIds.delete(turnId);
    this.completedTurnIds.add(turnId);
    while (this.completedTurnIds.size > MAX_COMPLETED_TURNS) this.completedTurnIds.delete(this.completedTurnIds.values().next().value);
  }

  // Atomic Interactions analyses are intentionally separate from Live turns.
  requestNarration(initial = false, { coalesce = false } = {}) {
    const snapshot = this.captureFrameSnapshot();
    if (!snapshot) return;
    this.cancelAtomicRetry();
    if (this.activeAtomicAnalysis && !this.activeAtomicAnalysis.controller.signal.aborted) {
      if (coalesce) {
        this.pendingAtomicNarration = { initial, snapshot, userTurnEpoch: this.userTurnEpoch };
        return;
      }
      this.activeAtomicAnalysis.controller.abort(new DOMException("Superseded visual analysis", "AbortError"));
    }
    this.startAtomicNarration(initial, snapshot, this.userTurnEpoch);
  }

  startAtomicNarration(
    initial,
    snapshot,
    userTurnEpoch,
    { retryAttempted = false } = {},
  ) {
    const record = {
      id: randomUUID(),
      controller: new AbortController(),
      userTurnEpoch,
      retryAttempted,
    };
    this.activeAtomicAnalysis = record;
    void this.runAtomicNarration(record, initial, snapshot);
  }

  async runAtomicNarration(record, initial, snapshot) {
    try {
      const analysis = await this.analyzeFrame({
        apiKey: this.apiKey,
        model: this.model,
        frame: snapshot.frame,
        initial,
        narrationLevel: this.narrationLevel,
        previousDescription: this.lastGroundedDescription,
        priorVisibleStates: this.visibleStateCache.list(this.elapsedMilliseconds),
        recentTabTranscript: this.getRecentTabTranscript(),
        timestampSeconds: snapshot.timestampSeconds,
        signal: record.controller.signal,
      });
      if (this.closed || record.controller.signal.aborted) return;
      const current = this.activeAtomicAnalysis === record;
      this.recordGroundedAnalysis(analysis, snapshot, {
        initial,
        offerCandidate: current
          && record.userTurnEpoch === this.userTurnEpoch
          && !this.activeSpeechTurn,
      });
    } catch (error) {
      if (!record.controller.signal.aborted) {
        this.sendBrowser({ type: "analysis_error", text: "Visual analysis is temporarily unavailable." });
        this.scheduleAtomicAnalysisRetry(record, initial, snapshot);
      }
    } finally {
      if (this.activeAtomicAnalysis === record) {
        this.activeAtomicAnalysis = null;
        const pending = this.pendingAtomicNarration;
        this.pendingAtomicNarration = null;
        if (!this.closed && pending) {
          this.startAtomicNarration(pending.initial, pending.snapshot, pending.userTurnEpoch);
        }
      }
      this.scheduleSpeechPolicyWake();
    }
  }

  scheduleAtomicAnalysisRetry(record, initial, snapshot) {
    if (
      record.retryAttempted
      || this.closed
      || this.pendingAtomicNarration
      || !this.frameMatchesSnapshot(snapshot)
    ) return;
    this.cancelAtomicRetry();
    this.atomicRetryTimer = this.timers.setTimeout(() => {
      this.atomicRetryTimer = null;
      if (
        this.closed
        || this.activeAtomicAnalysis
        || this.pendingAtomicNarration
        || !this.frameMatchesSnapshot(snapshot)
      ) return;
      this.startAtomicNarration(
        initial,
        snapshot,
        record.userTurnEpoch,
        { retryAttempted: true },
      );
    }, ANALYSIS_RETRY_DELAY_MS);
  }

  frameMatchesSnapshot(snapshot) {
    return Boolean(
      this.latestFrame
      && this.latestFrame.frameSequence === snapshot.frameSequence
      && this.latestFrame.hash === snapshot.frame.hash,
    );
  }

  cancelAtomicRetry() {
    if (this.atomicRetryTimer) this.timers.clearTimeout(this.atomicRetryTimer);
    this.atomicRetryTimer = null;
  }

  recordGroundedAnalysis(analysis, snapshot, { initial = false, offerCandidate = true } = {}) {
    const evidence = validateEventEvidence(
      analysis,
      this.visibleStateCache,
      this.elapsedMilliseconds,
    );
    if (!evidence.valid) {
      this.sendBrowser({
        type: "telemetry",
        text: `event evidence rejected: ${evidence.reason}`.slice(0, 240),
      });
      return;
    }
    const cacheMayAdvance = this.visibleStateCache.observe(snapshot.frameSequence);
    if (analysis.visibleState && cacheMayAdvance) {
      this.visibleStateCache.update(
        analysis.visibleState,
        snapshot.acceptedAtMs,
        snapshot.frameSequence,
      );
    }
    if (analysis.event) this.recordVisionEvent(analysis.event, snapshot.timestampSeconds);
    else if (analysis.shouldNarrate && analysis.description && !shouldSuppressVisualDescription(analysis.description)) {
      this.recordNarrationEvent(analysis.description, initial, snapshot.timestampSeconds);
    }
    this.lastGroundedDescription = analysis.description || analysis.event?.description || analysis.semanticKey || "";
    if (snapshot.frameSequence > this.groundedSemanticState.observedFrameSequence) {
      const changed = this.groundedSemanticState.semanticKey !== analysis.semanticKey;
      this.groundedSemanticState = {
        semanticKey: analysis.semanticKey,
        originAcceptedAtMs: changed ? (analysis.semanticKey ? snapshot.acceptedAtMs : null) : this.groundedSemanticState.originAcceptedAtMs,
        observedFrameSequence: snapshot.frameSequence,
      };
    }
    if (!offerCandidate || !analysis.shouldNarrate || !analysis.isNew || analysis.coveredByTabSpeech || analysis.importance < 0.6 || !analysis.description || !analysis.semanticKey) return;
    this.handleNarrationCandidate({ description: analysis.description, semanticKey: analysis.semanticKey, importance: analysis.importance, createdAtMs: this.groundedSemanticState.originAcceptedAtMs });
  }

  recordNarrationEvent(description, initial, timestampSeconds) {
    try {
      const result = this.eventStore.record({ ...buildNarrationEventCandidate(description, { initial }), sessionId: this.sessionId, timestampSeconds });
      if (result.status === "recorded") this.publishEvent(result.event);
    } catch (error) { this.sendBrowser({ type: "telemetry", text: `narration event rejected: ${summarizeValidationError(error)}` }); }
  }

  recordVisionEvent(candidate, timestampSeconds) {
    try {
      const validated = eventCandidateSchema.parse(candidate);
      if (shouldSuppressVisualDescription(validated.description)) return;
      const result = this.eventStore.record({ ...validated, sessionId: this.sessionId, timestampSeconds });
      if (result.status === "recorded") this.publishEvent(result.event);
    } catch (error) { this.sendBrowser({ type: "telemetry", text: `vision event rejected: ${summarizeValidationError(error)}` }); }
  }

  publishEvent(event) {
    const { sessionId: _sessionId, ...publicEvent } = event;
    this.sendBrowser({ type: "event", event: publicEvent });
    this.sendBrowser({ type: "telemetry", text: `event recorded: ${publicEvent.eventType} at ${publicEvent.timestamp}` });
  }

  sendVideo(jpegBytes, mimeType, timestampSeconds = this.elapsedTimestampSeconds, { force = false, scheduleNarration = false } = {}) {
    if (!jpegBytes.length || mimeType !== "image/jpeg") return;
    const hash = createHash("sha256").update(jpegBytes).digest("hex");
    if (!force && this.latestFrame?.hash === hash) return;
    this.cancelAtomicRetry();
    this.videoFrames += 1;
    this.lastFrameAcceptedAtMs = Math.max(this.lastFrameAcceptedAtMs, this.elapsedMilliseconds);
    this.latestTimestampSeconds = normalizeTimestampSeconds(timestampSeconds, this.elapsedTimestampSeconds);
    this.firstVideoFrame = true;
    this.latestFrame = { data: Buffer.from(jpegBytes).toString("base64"), hash, mimeType, acceptedAtMs: this.lastFrameAcceptedAtMs, frameSequence: this.videoFrames };
    this.enqueueLiveFrame(this.latestFrame);
    if (scheduleNarration) this.requestNarration(this.videoFrames === 1, { coalesce: true });
    if (this.videoFrames === 1 || this.videoFrames % 10 === 0) this.sendBrowser({ type: "telemetry", text: `video frames accepted: ${this.videoFrames} at ${formatTimestamp(this.latestTimestampSeconds)}` });
  }

  enqueueLiveFrame(frame) {
    this.pendingLiveFrame = frame;
    const remaining = LIVE_FRAME_INTERVAL_MS - (this.elapsedMilliseconds - this.lastLiveFrameAtMs);
    if (remaining <= 0) return this.flushLiveFrame();
    if (!this.liveFrameTimer) this.liveFrameTimer = this.timers.setTimeout(() => {
      this.liveFrameTimer = null;
      this.flushLiveFrame();
    }, remaining);
  }

  flushLiveFrame() {
    if (!this.pendingLiveFrame || !this.live) return;
    const remaining = LIVE_FRAME_INTERVAL_MS - (this.elapsedMilliseconds - this.lastLiveFrameAtMs);
    if (remaining > 0) return this.enqueueLiveFrame(this.pendingLiveFrame);
    const frame = this.pendingLiveFrame;
    this.pendingLiveFrame = null;
    this.lastLiveFrameAtMs = this.elapsedMilliseconds;
    try { void this.live.sendVideo?.({ data: frame.data, mimeType: frame.mimeType }); } catch { this.handleLiveMessage({ type: "health", state: "degraded" }); }
  }

  captureFrameSnapshot() {
    if (!this.latestFrame) return null;
    const { acceptedAtMs, frameSequence, ...frame } = this.latestFrame;
    return Object.freeze({ frame: Object.freeze(frame), timestampSeconds: this.latestTimestampSeconds, acceptedAtMs, frameSequence });
  }

  getRecentTabTranscript() {
    if (typeof this.recentTabTranscript === "function") {
      return String(this.recentTabTranscript()).slice(-2_000);
    }
    if (typeof this.recentTabTranscript === "string") return this.recentTabTranscript.slice(-2_000);
    const context = this.tabTranscriptBuffer.getRecent?.({ maxCharacters: 2_000 }) ?? { segments: [] };
    return context.segments.map((segment) => segment.text).join("\n").slice(-2_000);
  }

  get elapsedMilliseconds() { return Math.max(0, this.now() - this.sessionStartedAt); }
  get elapsedTimestampSeconds() { return this.elapsedMilliseconds / 1_000; }

  // Compatibility entry point for existing direct atomic-analysis callers; it never answers text.
  answerTextQuestion(question) {
    this.beginAnswerTurn({ turnId: randomUUID(), source: "typed", text: String(question ?? "").trim() });
  }

  sendBrowser(message, { audio = false } = {}) {
    if (this.browser.readyState !== WebSocket.OPEN) return false;
    const serialized = JSON.stringify(parseServerOutput(message));
    const messageBytes = Buffer.byteLength(serialized, "utf8");
    if ((this.browser.bufferedAmount ?? 0) + messageBytes > OUTPUT_BUFFER_LIMIT_BYTES) {
      if (audio) {
        if (this.activeSpeechTurn) {
          this.discardSpeechTurn(
            this.activeSpeechTurn,
            "output_backpressure",
            { retryable: true },
          );
        }
      } else {
        this.browser.close(1013, "Output backpressure");
      }
      return false;
    }
    try { this.browser.send(serialized); return true; } catch { this.browser.close(1011, "Output delivery failed"); return false; }
  }

  protocolViolation(reason) {
    this.browser.close(1008, reason);
  }

  async closeProviders(live = this.live, transcriber = this.transcriber) {
    const closeProvider = (provider) => Promise.resolve().then(() => provider?.close?.());
    await Promise.allSettled([closeProvider(live), closeProvider(transcriber)]);
  }

  close(code = 1000, reason = "Session closed") {
    if (this.closePromise) return this.closePromise;
    this.closed = true;
    this.transcriberGeneration += 1;
    if (this.speechPolicyTimer) this.timers.clearTimeout(this.speechPolicyTimer);
    if (this.liveFrameTimer) this.timers.clearTimeout(this.liveFrameTimer);
    this.cancelAtomicRetry();
    this.speechPolicyTimer = null;
    this.liveFrameTimer = null;
    if (this.activeAtomicAnalysis && !this.activeAtomicAnalysis.controller.signal.aborted) this.activeAtomicAnalysis.controller.abort(new DOMException(reason, "AbortError"));
    const live = this.live;
    const transcriber = this.transcriber;
    this.live = null;
    this.transcriber = null;
    this.pendingLiveFrame = null;
    this.pendingAtomicNarration = null;
    this.latestFrame = null;
    this.activeSpeechTurn = null;
    this.activeAtomicAnalysis = null;
    this.lastTabPacketTimestampMs = null;
    this.completedTurnIds.clear();
    this.visibleStateCache.clear();
    this.tabTranscriptBuffer.clear?.();
    this.audioSequenceGuard.reset?.();
    this.closePromise = this.closeProviders(live, transcriber).finally(() => {
      if (this.browser.readyState === WebSocket.OPEN) this.browser.close(code, reason);
    });
    return this.closePromise;
  }
}
