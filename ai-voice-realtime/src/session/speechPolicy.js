const TAB_AUDIO_STATES = new Set(["absent", "healthy", "degraded"]);
const LIVE_STATES = new Set(["connecting", "ready", "degraded", "closed"]);

function assertFiniteNonnegative(value, name) {
  if (!Number.isFinite(value) || value < 0) {
    throw new TypeError(`${name} must be a finite nonnegative number`);
  }
}

function assertDuration(value, name) {
  assertFiniteNonnegative(value, name);
}

function assertTurnId(turnId) {
  if (typeof turnId !== "string" || turnId.length === 0) {
    throw new TypeError("turnId must be a nonempty string");
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
  assertFiniteNonnegative(candidate.createdAtMs, "candidate.createdAtMs");
}

/**
 * Backend-owned, provider-free gating for automatic narration. The caller owns
 * scheduling and performs the actions returned by each transition.
 */
export class SpeechPolicy {
  #nowBackendSessionMs;
  #narrationSilenceMs;
  #narrationTtlMs;
  #semanticCooldownMs;
  #lastNowMs = null;
  #tabAudioState = "degraded";
  #localTabSpeech = false;
  #cloudTabSpeech = false;
  #liveState = "connecting";
  #silenceSinceMs = null;
  #pendingCandidate = null;
  #startingCandidate = null;
  #activeTurn = null;
  #cooldowns = new Map();

  constructor({
    nowBackendSessionMs,
    narrationSilenceMs = 750,
    narrationTtlMs = 5_000,
    semanticCooldownMs = 15_000,
  } = {}) {
    if (typeof nowBackendSessionMs !== "function") {
      throw new TypeError("nowBackendSessionMs must be a function");
    }
    assertDuration(narrationSilenceMs, "narrationSilenceMs");
    assertDuration(narrationTtlMs, "narrationTtlMs");
    assertDuration(semanticCooldownMs, "semanticCooldownMs");

    this.#nowBackendSessionMs = nowBackendSessionMs;
    this.#narrationSilenceMs = narrationSilenceMs;
    this.#narrationTtlMs = narrationTtlMs;
    this.#semanticCooldownMs = semanticCooldownMs;
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
    if (state === "degraded") {
      return this.#cancelAndDrop("tab_audio_degraded");
    }
    return [];
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
    if (state === "degraded" || state === "closed") {
      return this.#cancelAndDrop("live_degraded");
    }
    return [];
  }

  offerNarration(candidate) {
    validateCandidate(candidate);
    const nowMs = this.#readNow();
    this.#discardExpired(nowMs);

    if (this.#isExpired(candidate, nowMs) || this.#isCoolingDown(candidate.semanticKey, nowMs)) {
      return [];
    }
    if (this.#activeTurn?.mode === "user" || this.#startingCandidate) return [];

    if (!this.#pendingCandidate) {
      this.#pendingCandidate = copyCandidate(candidate);
      return [];
    }
    if (this.#pendingCandidate.semanticKey === candidate.semanticKey) return [];
    if (
      candidate.createdAtMs <= this.#pendingCandidate.createdAtMs
      || candidate.importance < this.#pendingCandidate.importance
    ) {
      return [];
    }

    this.#pendingCandidate = copyCandidate(candidate);
    return [{ type: "drop_narration", reason: "replaced" }];
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

  markNarrationStarted(turnId) {
    assertTurnId(turnId);
    const nowMs = this.#readNow();
    const actions = this.#discardExpired(nowMs);
    if (actions.length > 0 || this.#activeTurn) return actions;

    const candidate = this.#startingCandidate;
    this.#startingCandidate = null;
    if (candidate) {
      this.#cooldowns.set(candidate.semanticKey, nowMs + this.#semanticCooldownMs);
    }
    this.#activeTurn = { mode: "narration", turnId };
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
    if (!this.#pendingCandidate || this.#startingCandidate || this.#activeTurn) return [];
    if (!this.#canNarrate() || nowMs < this.#silenceDeadlineMs()) return [];

    this.#startingCandidate = this.#pendingCandidate;
    this.#pendingCandidate = null;
    return [{ type: "start_narration", candidate: copyCandidate(this.#startingCandidate) }];
  }

  nextWakeAtMs() {
    const nowMs = this.#readNow();
    this.#discardExpired(nowMs);
    const candidate = this.#pendingCandidate ?? this.#startingCandidate;
    if (!candidate) return null;

    const expiryMs = candidate.createdAtMs + this.#narrationTtlMs;
    if (!this.#canNarrate()) return expiryMs;
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
    if (!active || this.#activeTurn?.mode !== "narration") return [];
    const turnId = this.#activeTurn.turnId;
    this.#activeTurn = null;
    return [{ type: "cancel_narration", turnId }];
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
    if (!this.#pendingCandidate && !this.#startingCandidate) return;
    this.#pendingCandidate = null;
    this.#startingCandidate = null;
    actions.push({ type: "drop_narration", reason });
  }

  #discardExpired(nowMs) {
    const candidate = this.#pendingCandidate ?? this.#startingCandidate;
    if (!candidate || !this.#isExpired(candidate, nowMs)) return [];
    this.#pendingCandidate = null;
    this.#startingCandidate = null;
    return [{ type: "drop_narration", reason: "expired" }];
  }

  #isExpired(candidate, nowMs) {
    return nowMs >= candidate.createdAtMs + this.#narrationTtlMs;
  }

  #isCoolingDown(semanticKey, nowMs) {
    const untilMs = this.#cooldowns.get(semanticKey);
    if (untilMs === undefined) return false;
    if (nowMs >= untilMs) {
      this.#cooldowns.delete(semanticKey);
      return false;
    }
    return true;
  }

  #refreshSilence(nowMs) {
    this.#silenceSinceMs = this.#canNarrate() ? nowMs : null;
  }

  #canNarrate() {
    return (
      this.#liveState === "ready"
      && this.#tabAudioState !== "degraded"
      && !this.#localTabSpeech
      && !this.#cloudTabSpeech
    );
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
