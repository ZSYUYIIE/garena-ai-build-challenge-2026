import {
  isVoiceNarrationMode,
  VoiceNarrationMode,
} from "../protocol/voiceNarrationMode.js";

const TAB_AUDIO_STATES = new Set(["absent", "healthy", "degraded"]);
const LIVE_STATES = new Set(["connecting", "ready", "degraded", "closed"]);
const DEFAULT_RECENT_SETTLEMENT_LIMIT = 256;
const DEFAULT_INVALIDATED_RESERVATION_LIMIT = 256;
const DEFAULT_SEMANTIC_COOLDOWN_LIMIT = 512;
const MAX_RESERVATION_SEQUENCE = 0xffff_ffff;

function assertFiniteNonnegative(value, name) {
  if (!Number.isFinite(value) || value < 0) {
    throw new TypeError(`${name} must be a finite nonnegative number`);
  }
}

function assertDuration(value, name) {
  assertFiniteNonnegative(value, name);
}

function assertPositiveSafeInteger(value, name) {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new TypeError(`${name} must be a positive safe integer`);
  }
}

function assertTurnId(turnId) {
  if (typeof turnId !== "string" || turnId.length === 0) {
    throw new TypeError("turnId must be a nonempty string");
  }
}

function assertReservationId(reservationId) {
  if (typeof reservationId !== "string" || reservationId.length === 0) {
    throw new TypeError("reservationId must be a nonempty string");
  }
}

function addBounded(set, value, limit) {
  set.delete(value);
  set.add(value);
  while (set.size > limit) {
    set.delete(set.values().next().value);
  }
}

function addBoundedMap(map, key, value, limit) {
  map.delete(key);
  map.set(key, value);
  while (map.size > limit) {
    map.delete(map.keys().next().value);
  }
}

function copyCandidate(candidate) {
  return { ...candidate };
}

function validateCandidate(candidate) {
  if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) {
    throw new TypeError("candidate must be an object");
  }
  if (typeof candidate.description !== "string" || candidate.description.trim().length === 0) {
    throw new TypeError("candidate.description must be a nonempty string");
  }
  if (typeof candidate.semanticKey !== "string" || candidate.semanticKey.trim().length === 0) {
    throw new TypeError("candidate.semanticKey must be a nonempty string");
  }
  if (!Number.isFinite(candidate.importance) || candidate.importance < 0) {
    throw new TypeError("candidate.importance must be a finite nonnegative number");
  }
  if (
    candidate.smartEligible !== undefined
    && typeof candidate.smartEligible !== "boolean"
  ) {
    throw new TypeError("candidate.smartEligible must be a boolean when supplied");
  }
  assertFiniteNonnegative(candidate.createdAtMs, "candidate.createdAtMs");
}

/**
 * Backend-owned, provider-free gating for automatic narration. The caller owns
 * scheduling and performs the actions returned by each transition.
 *
 * `start_narration` includes an opaque `reservationId` (at most 9 ASCII
 * characters). The caller must acknowledge that exact dispatch with
 * `markNarrationStarted(turnId, reservationId)`. A tokenized acknowledgement
 * can consume only the matching current reservation. The no-token overload is
 * retained solely for seeding an already-active narration in state tests and
 * never consumes a tokenized reservation; if one is outstanding, the untracked
 * no-token turn is cancelled by its supplied turn ID. Settlement replay
 * identity is the exact `(reservationId, turnId)` pair (or the direct turn ID),
 * so reusing a settled token for a different turn produces a new cancellation.
 */
export class SpeechPolicy {
  #nowBackendSessionMs;
  #narrationSilenceMs;
  #narrationTtlMs;
  #semanticCooldownMs;
  #recentSettlementLimit;
  #invalidatedReservationLimit;
  #semanticCooldownLimit;
  #voiceNarrationMode = VoiceNarrationMode.SMART;
  #automaticNarrationEnabled = true;
  #lastNowMs = null;
  #tabAudioState = "degraded";
  #localTabSpeech = false;
  #cloudTabSpeech = false;
  #liveState = "connecting";
  #silenceSinceMs = null;
  #pendingCandidate = null;
  #startReservation = null;
  #activeTurn = null;
  #nextReservationSequence = 1;
  #invalidatedReservationIds = new Set();
  #recentSettlements = new Map();
  #cooldowns = new Map();

  constructor({
    nowBackendSessionMs,
    narrationSilenceMs = 750,
    narrationTtlMs = 5_000,
    semanticCooldownMs = 15_000,
    recentSettlementLimit = DEFAULT_RECENT_SETTLEMENT_LIMIT,
    invalidatedReservationLimit = DEFAULT_INVALIDATED_RESERVATION_LIMIT,
    semanticCooldownLimit = DEFAULT_SEMANTIC_COOLDOWN_LIMIT,
  } = {}) {
    if (typeof nowBackendSessionMs !== "function") {
      throw new TypeError("nowBackendSessionMs must be a function");
    }
    assertDuration(narrationSilenceMs, "narrationSilenceMs");
    assertDuration(narrationTtlMs, "narrationTtlMs");
    assertDuration(semanticCooldownMs, "semanticCooldownMs");
    assertPositiveSafeInteger(recentSettlementLimit, "recentSettlementLimit");
    assertPositiveSafeInteger(invalidatedReservationLimit, "invalidatedReservationLimit");
    assertPositiveSafeInteger(semanticCooldownLimit, "semanticCooldownLimit");

    this.#nowBackendSessionMs = nowBackendSessionMs;
    this.#narrationSilenceMs = narrationSilenceMs;
    this.#narrationTtlMs = narrationTtlMs;
    this.#semanticCooldownMs = semanticCooldownMs;
    this.#recentSettlementLimit = recentSettlementLimit;
    this.#invalidatedReservationLimit = invalidatedReservationLimit;
    this.#semanticCooldownLimit = semanticCooldownLimit;
    this.#readNow();
  }

  setTabAudioState(state) {
    if (!TAB_AUDIO_STATES.has(state)) {
      throw new TypeError("invalid tab audio state");
    }
    const nowMs = this.#readNow();
    if (this.#tabAudioState === state) return [];

    this.#tabAudioState = state;
    this.#refreshSilence(nowMs);
    if (
      state === "degraded"
      && this.#voiceNarrationMode === VoiceNarrationMode.SMART
    ) {
      return this.#cancelAndDrop("tab_audio_degraded");
    }
    return [];
  }

  setVoiceNarrationMode(mode) {
    if (!isVoiceNarrationMode(mode)) {
      throw new TypeError("invalid voice narration mode");
    }
    const nowMs = this.#readNow();
    if (this.#voiceNarrationMode === mode) return [];

    this.#voiceNarrationMode = mode;
    this.#refreshSilence(nowMs);
    if (mode !== VoiceNarrationMode.SMART) return [];

    const actions = [];
    if (
      this.#activeTurn?.mode === "narration"
      && (
        this.#activeTurn.smartEligible === false
        || !this.#canNarrate()
      )
    ) {
      actions.push({
        type: "cancel_narration",
        turnId: this.#activeTurn.turnId,
      });
      this.#activeTurn = null;
    }
    if (this.#pendingCandidate?.smartEligible === false) {
      this.#pendingCandidate = null;
      actions.push({ type: "drop_narration", reason: "mode_changed" });
    }
    this.#invalidateReservation(actions, "mode_changed");
    return actions;
  }

  setAutomaticNarrationEnabled(enabled) {
    if (typeof enabled !== "boolean") {
      throw new TypeError("automatic narration enabled must be a boolean");
    }
    const nowMs = this.#readNow();
    if (this.#automaticNarrationEnabled === enabled) return [];

    this.#automaticNarrationEnabled = enabled;
    this.#refreshSilence(nowMs);
    return enabled
      ? []
      : this.#cancelAndDrop("automatic_narration_disabled");
  }

  setLocalTabSpeech(active) {
    return this.#setTabSpeech("local", active);
  }

  setCloudTabSpeech(active) {
    return this.#setTabSpeech("cloud", active);
  }

  setLiveState(state) {
    if (!LIVE_STATES.has(state)) {
      throw new TypeError("invalid Live state");
    }
    const nowMs = this.#readNow();
    if (this.#liveState === state) return [];

    this.#liveState = state;
    this.#refreshSilence(nowMs);
    if (state !== "ready") {
      return this.#cancelAndDrop("live_degraded");
    }
    return [];
  }

  offerNarration(candidate) {
    validateCandidate(candidate);
    const nowMs = this.#readNow();
    this.#pruneCooldowns(nowMs);
    const actions = this.#discardExpired(nowMs);

    if (!this.#automaticNarrationEnabled) return actions;
    if (this.#isExpired(candidate, nowMs) || this.#isCoolingDown(candidate.semanticKey, nowMs)) {
      return actions;
    }
    if (this.#activeTurn?.mode === "user" || this.#startReservation) return actions;

    if (!this.#pendingCandidate) {
      this.#pendingCandidate = copyCandidate(candidate);
      return actions;
    }
    if (this.#pendingCandidate.semanticKey === candidate.semanticKey) return actions;
    const preservesImportance =
      this.#voiceNarrationMode === VoiceNarrationMode.SMART;
    if (
      candidate.createdAtMs <= this.#pendingCandidate.createdAtMs
      || (
        preservesImportance
        && candidate.importance < this.#pendingCandidate.importance
      )
    ) {
      return actions;
    }

    this.#pendingCandidate = copyCandidate(candidate);
    actions.push({ type: "drop_narration", reason: "replaced" });
    return actions;
  }

  startUserTurn(turnId) {
    assertTurnId(turnId);
    const nowMs = this.#readNow();
    const actions = this.#discardExpired(nowMs);
    if (this.#activeTurn?.mode === "user") return actions;

    if (this.#activeTurn?.mode === "narration") {
      actions.push({ type: "cancel_narration", turnId: this.#activeTurn.turnId });
      this.#activeTurn = null;
    }
    this.#dropPending(actions, "user_turn");
    this.#activeTurn = { mode: "user", turnId };
    return actions;
  }

  markNarrationStarted(turnId, reservationId) {
    assertTurnId(turnId);
    if (reservationId !== undefined) assertReservationId(reservationId);
    const nowMs = this.#readNow();
    this.#pruneCooldowns(nowMs);

    const actions = this.#discardExpired(nowMs);
    if (reservationId !== undefined) {
      if (this.#hasSettlement(reservationId, turnId)) return actions;

      if (
        this.#startReservation?.reservationId === reservationId
        && !this.#activeTurn
      ) {
        const candidate = this.#startReservation.candidate;
        this.#startReservation = null;
        this.#invalidatedReservationIds.delete(reservationId);
        this.#recordSettlement(reservationId, turnId);
        this.#recordCooldown(candidate.semanticKey, nowMs);
        this.#activeTurn = {
          mode: "narration",
          turnId,
          smartEligible: candidate.smartEligible !== false,
        };
        return actions;
      }

      this.#invalidatedReservationIds.delete(reservationId);
      this.#recordSettlement(reservationId, turnId);
      actions.push({ type: "cancel_narration", turnId });
      return actions;
    }

    if (this.#hasSettlement(null, turnId)) return actions;
    this.#recordSettlement(null, turnId);
    if (this.#startReservation) {
      actions.push({ type: "cancel_narration", turnId });
      return actions;
    }
    if (actions.length > 0) return actions;
    if (this.#activeTurn) {
      if (this.#activeTurn.turnId !== turnId) {
        actions.push({ type: "cancel_narration", turnId });
      }
      return actions;
    }
    this.#activeTurn = { mode: "narration", turnId, smartEligible: true };
    return actions;
  }

  finishTurn(turnId) {
    assertTurnId(turnId);
    this.#readNow();
    if (!this.#activeTurn || this.#activeTurn.turnId !== turnId) return [];
    this.#activeTurn = null;
    return [];
  }

  poll() {
    const nowMs = this.#readNow();
    const actions = this.#discardExpired(nowMs);
    if (actions.length > 0) return actions;
    if (!this.#pendingCandidate || this.#startReservation || this.#activeTurn) return [];
    if (
      !this.#canNarrate()
      || (
        this.#voiceNarrationMode === VoiceNarrationMode.SMART
        && nowMs < this.#silenceDeadlineMs()
      )
    ) return [];

    this.#startReservation = {
      candidate: this.#pendingCandidate,
      reservationId: this.#createReservationId(),
    };
    this.#pendingCandidate = null;
    return [{
      type: "start_narration",
      candidate: copyCandidate(this.#startReservation.candidate),
      reservationId: this.#startReservation.reservationId,
    }];
  }

  nextWakeAtMs() {
    const nowMs = this.#readNow();
    const reservation = this.#startReservation;
    const candidate = this.#pendingCandidate ?? reservation?.candidate;
    if (!candidate) return null;

    const expiryMs = candidate.createdAtMs + this.#narrationTtlMs;
    if (expiryMs <= nowMs) return null;
    if (reservation) return expiryMs;
    if (!this.#canNarrate()) return expiryMs;
    if (this.#voiceNarrationMode !== VoiceNarrationMode.SMART) return nowMs;
    return Math.max(nowMs, Math.min(expiryMs, this.#silenceDeadlineMs()));
  }

  #setTabSpeech(source, active) {
    if (typeof active !== "boolean") {
      throw new TypeError("tab speech state must be a boolean");
    }
    const nowMs = this.#readNow();
    if (source === "local") {
      if (this.#localTabSpeech === active) return [];
      this.#localTabSpeech = active;
    } else {
      if (this.#cloudTabSpeech === active) return [];
      this.#cloudTabSpeech = active;
    }

    this.#refreshSilence(nowMs);
    if (!active || this.#voiceNarrationMode !== VoiceNarrationMode.SMART) {
      return [];
    }

    const actions = [];
    if (this.#activeTurn?.mode === "narration") {
      actions.push({ type: "cancel_narration", turnId: this.#activeTurn.turnId });
      this.#activeTurn = null;
    }
    this.#invalidateReservation(actions, "tab_speech");
    return actions;
  }

  #cancelAndDrop(reason) {
    const actions = [];
    if (this.#activeTurn?.mode === "narration") {
      actions.push({ type: "cancel_narration", turnId: this.#activeTurn.turnId });
      this.#activeTurn = null;
    }
    this.#dropPending(actions, reason);
    return actions;
  }

  #dropPending(actions, reason) {
    if (this.#pendingCandidate) {
      this.#pendingCandidate = null;
      actions.push({ type: "drop_narration", reason });
      return;
    }
    this.#invalidateReservation(actions, reason);
  }

  #discardExpired(nowMs) {
    if (this.#pendingCandidate && this.#isExpired(this.#pendingCandidate, nowMs)) {
      this.#pendingCandidate = null;
      return [{ type: "drop_narration", reason: "expired" }];
    }
    if (
      this.#startReservation
      && this.#isExpired(this.#startReservation.candidate, nowMs)
    ) {
      const actions = [];
      this.#invalidateReservation(actions, "expired");
      return actions;
    }
    return [];
  }

  #invalidateReservation(actions, reason) {
    if (!this.#startReservation) return;
    addBounded(
      this.#invalidatedReservationIds,
      this.#startReservation.reservationId,
      this.#invalidatedReservationLimit,
    );
    this.#startReservation = null;
    actions.push({ type: "drop_narration", reason });
  }

  #isExpired(candidate, nowMs) {
    return nowMs >= candidate.createdAtMs + this.#narrationTtlMs;
  }

  #isCoolingDown(semanticKey, nowMs) {
    const untilMs = this.#cooldowns.get(semanticKey);
    return untilMs !== undefined && nowMs < untilMs;
  }

  #pruneCooldowns(nowMs) {
    for (const [semanticKey, untilMs] of this.#cooldowns) {
      if (nowMs >= untilMs) this.#cooldowns.delete(semanticKey);
    }
  }

  #recordCooldown(semanticKey, nowMs) {
    this.#pruneCooldowns(nowMs);
    this.#cooldowns.delete(semanticKey);
    this.#cooldowns.set(semanticKey, nowMs + this.#semanticCooldownMs);
    while (this.#cooldowns.size > this.#semanticCooldownLimit) {
      this.#cooldowns.delete(this.#cooldowns.keys().next().value);
    }
  }

  #hasSettlement(reservationId, turnId) {
    return this.#recentSettlements.has(JSON.stringify([reservationId, turnId]));
  }

  #recordSettlement(reservationId, turnId) {
    const key = JSON.stringify([reservationId, turnId]);
    addBoundedMap(
      this.#recentSettlements,
      key,
      { reservationId, turnId },
      this.#recentSettlementLimit,
    );
  }

  #hasSettledReservationId(reservationId) {
    for (const settlement of this.#recentSettlements.values()) {
      if (settlement.reservationId === reservationId) return true;
    }
    return false;
  }

  #createReservationId() {
    while (true) {
      const reservationId = `r:${this.#nextReservationSequence.toString(36)}`;
      this.#nextReservationSequence = this.#nextReservationSequence === MAX_RESERVATION_SEQUENCE
        ? 1
        : this.#nextReservationSequence + 1;
      if (
        this.#startReservation?.reservationId !== reservationId
        && !this.#invalidatedReservationIds.has(reservationId)
        && !this.#hasSettledReservationId(reservationId)
      ) {
        return reservationId;
      }
    }
  }

  #refreshSilence(nowMs) {
    this.#silenceSinceMs = this.#canNarrate() ? nowMs : null;
  }

  #canNarrate() {
    if (!this.#automaticNarrationEnabled || this.#liveState !== "ready") {
      return false;
    }
    if (this.#voiceNarrationMode !== VoiceNarrationMode.SMART) return true;
    return this.#tabAudioState !== "degraded"
      && !this.#localTabSpeech
      && !this.#cloudTabSpeech;
  }

  #silenceDeadlineMs() {
    return this.#silenceSinceMs + this.#narrationSilenceMs;
  }

  #readNow() {
    const nowMs = this.#nowBackendSessionMs();
    assertFiniteNonnegative(nowMs, "nowBackendSessionMs result");
    if (this.#lastNowMs !== null && nowMs < this.#lastNowMs) {
      throw new RangeError("nowBackendSessionMs must be monotonic");
    }
    this.#lastNowMs = nowMs;
    return nowMs;
  }
}
