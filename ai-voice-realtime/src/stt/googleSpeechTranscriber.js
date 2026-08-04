import { v2 as speech } from "@google-cloud/speech";

const DEFAULT_ROTATE_AFTER_MS = 285_000;
const BRIDGE_MAX_BYTES = 16_000;
const QUEUE_MAX_BYTES = 16_000;
const RETRY_DELAYS_MS = [250, 500, 1_000];

function durationMs(duration) {
  if (!duration) return 0;
  const seconds = Number(duration.seconds ?? 0);
  const nanos = Number(duration.nanos ?? 0);
  return (seconds * 1_000) + (nanos / 1_000_000);
}

function bestTranscript(alternatives) {
  if (!Array.isArray(alternatives)) return null;
  for (const alternative of alternatives) {
    const text = alternative?.transcript?.trim();
    if (text) return text;
  }
  return null;
}

function streamConfig(projectId, location) {
  return {
    recognizer: `projects/${projectId}/locations/${location}/recognizers/_`,
    streamingConfig: {
      config: {
        explicitDecodingConfig: {
          encoding: "LINEAR16",
          sampleRateHertz: 16_000,
          audioChannelCount: 1,
        },
        languageCodes: ["auto"],
        model: "chirp_3",
        features: { enableAutomaticPunctuation: true },
      },
      streamingFeatures: {
        interimResults: true,
        enableVoiceActivityEvents: true,
      },
    },
  };
}

export class GoogleSpeechTranscriber {
  #SpeechClient;
  #projectId;
  #location;
  #timers;
  #rotateAfterMs;
  #onSpeechState;
  #onInterim;
  #onFinal;
  #onHealth;
  #client = null;
  #active = null;
  #records = new Set();
  #bridge = [];
  #bridgeBytes = 0;
  #queue = [];
  #queueBytes = 0;
  #rotationTimer = null;
  #retryTimer = null;
  #retryAttempt = 0;
  #closed = false;
  #health = "closed";
  #cloudSpeechActive = false;

  constructor({
    SpeechClient = speech.SpeechClient,
    projectId = process.env.GOOGLE_CLOUD_PROJECT,
    location = process.env.GOOGLE_CLOUD_SPEECH_LOCATION || "us",
    timers = globalThis,
    rotateAfterMs = DEFAULT_ROTATE_AFTER_MS,
    onSpeechState = () => {},
    onInterim = () => {},
    onFinal = () => {},
    onHealth = () => {},
  } = {}) {
    if (typeof SpeechClient !== "function") throw new TypeError("SpeechClient must be a constructor");
    if (!Number.isFinite(rotateAfterMs) || rotateAfterMs <= 0) throw new TypeError("rotateAfterMs must be positive");
    if (typeof timers.setTimeout !== "function" || typeof timers.clearTimeout !== "function") {
      throw new TypeError("timers must provide setTimeout and clearTimeout");
    }
    this.#SpeechClient = SpeechClient;
    this.#projectId = projectId?.trim();
    this.#location = location?.trim() || "us";
    this.#timers = timers;
    this.#rotateAfterMs = rotateAfterMs;
    this.#onSpeechState = onSpeechState;
    this.#onInterim = onInterim;
    this.#onFinal = onFinal;
    this.#onHealth = onHealth;
  }

  get health() {
    return this.#health;
  }

  async start() {
    if (this.#closed) return;
    if (!this.#projectId) {
      this.#setHealth("degraded", "missing GOOGLE_CLOUD_PROJECT configuration");
      return;
    }
    if (!this.#client) {
      this.#client = new this.#SpeechClient({
        apiEndpoint: `${this.#location}-speech.googleapis.com`,
      });
    }
    this.#setHealth("connecting");
    try {
      this.#openStream();
    } catch {
      this.#handleFailure(this.#active);
    }
  }

  write(pcm, firstSampleBackendSessionMs) {
    if (!Buffer.isBuffer(pcm) || pcm.length === 0 || pcm.length % 2 !== 0) {
      throw new TypeError("PCM must be a nonempty even-length Buffer");
    }
    if (!Number.isFinite(firstSampleBackendSessionMs) || firstSampleBackendSessionMs < 0) {
      throw new TypeError("firstSampleBackendSessionMs must be finite and nonnegative");
    }
    if (this.#closed || !this.#projectId) return "degraded";

    const item = { pcm, firstSampleBackendSessionMs };
    if (!this.#active || this.#active.backpressured) {
      return this.#enqueue(item);
    }
    return this.#writeToActive(item);
  }

  async markDiscontinuity() {
    if (this.#closed) return;
    this.#clearAudioBuffers();
    this.#handleFailure(this.#active);
  }

  async close() {
    if (this.#closed) return;
    this.#closed = true;
    this.#clearTimers();
    this.#clearAudioBuffers();
    for (const record of this.#records) this.#endRecord(record);
    this.#active = null;
    if (this.#client) await this.#client.close();
    this.#setHealth("closed");
  }

  #openStream() {
    const stream = this.#client._streamingRecognize();
    const record = {
      stream,
      originBackendSessionMs: null,
      activityStartOffsetMs: null,
      priorFinalEndOffsetMs: 0,
      activityHadFinal: false,
      speechActive: false,
      pendingReplay: [...this.#bridge],
      backpressured: false,
      ended: false,
      destroyed: false,
      retiring: false,
    };
    this.#records.add(record);
    this.#active = record;
    stream.on("data", (response) => this.#handleResponse(record, response));
    stream.on("error", () => this.#handleFailure(record));
    stream.on("drain", () => this.#handleDrain(record));
    stream.on("close", () => this.#handleTerminal(record));
    stream.on("end", () => this.#handleTerminal(record));
    if (stream.write(streamConfig(this.#projectId, this.#location)) === false) {
      record.backpressured = true;
    }
    this.#setHealth("ready");
    this.#flushRecord(record);
    this.#scheduleRotation(record);
  }

  #scheduleRotation(record) {
    if (this.#rotationTimer) this.#timers.clearTimeout(this.#rotationTimer);
    this.#rotationTimer = this.#timers.setTimeout(() => {
      this.#rotationTimer = null;
      if (this.#closed || this.#active !== record) return;
      try {
        this.#openStream();
        this.#endRecord(record);
      } catch {
        this.#handleFailure(record);
      }
    }, this.#rotateAfterMs);
  }

  #writeToActive(item, retainBridge = true) {
    const record = this.#active;
    if (!record) return this.#enqueue(item);
    return this.#writeToRecord(record, item, retainBridge);
  }

  #writeToRecord(record, item, retainBridge) {
    if (record.originBackendSessionMs === null) {
      record.originBackendSessionMs = item.firstSampleBackendSessionMs;
    }
    if (retainBridge) this.#appendBridge(item);
    const accepted = record.stream.write({ audio: item.pcm });
    if (!accepted) {
      record.backpressured = true;
      return "backpressured";
    }
    return "accepted";
  }

  #enqueue(item) {
    if (this.#queueBytes + item.pcm.length > QUEUE_MAX_BYTES) {
      this.#clearAudioBuffers();
      this.#handleFailure(this.#active);
      return "degraded";
    }
    this.#queue.push(item);
    this.#queueBytes += item.pcm.length;
    return "backpressured";
  }

  #handleDrain(record) {
    if (this.#closed || this.#active !== record) return;
    record.backpressured = false;
    this.#flushRecord(record);
  }

  #flushRecord(record) {
    if (this.#closed || this.#active !== record || record.backpressured) return;
    while (record.pendingReplay.length > 0 && !record.backpressured && this.#active === record) {
      const item = record.pendingReplay.shift();
      this.#writeToRecord(record, item, false);
    }
    while (this.#queue.length > 0 && !record.backpressured && this.#active === record) {
      const item = this.#queue.shift();
      this.#queueBytes -= item.pcm.length;
      this.#writeToRecord(record, item, true);
    }
  }

  #appendBridge(item) {
    this.#bridge.push(item);
    this.#bridgeBytes += item.pcm.length;
    while (this.#bridgeBytes > BRIDGE_MAX_BYTES && this.#bridge.length > 0) {
      const dropped = this.#bridge.shift();
      this.#bridgeBytes -= dropped.pcm.length;
    }
  }

  #handleResponse(record, response) {
    if (this.#closed || record.originBackendSessionMs === null) return;
    if (response?.speechEventType === "SPEECH_ACTIVITY_BEGIN") {
      record.activityStartOffsetMs = durationMs(response.speechEventOffset);
      record.priorFinalEndOffsetMs = record.activityStartOffsetMs;
      record.activityHadFinal = false;
      this.#setRecordSpeechActive(record, true);
    } else if (response?.speechEventType === "SPEECH_ACTIVITY_END") {
      record.activityStartOffsetMs = null;
      this.#setRecordSpeechActive(record, false);
    }

    for (const item of response?.results ?? []) {
      const text = bestTranscript(item.alternatives);
      if (!text) continue;
      if (!item.isFinal) {
        this.#onInterim(text);
        continue;
      }
      const endOffsetMs = durationMs(item.resultEndOffset);
      const startOffsetMs = record.activityHadFinal
        ? record.priorFinalEndOffsetMs
        : (record.activityStartOffsetMs ?? record.priorFinalEndOffsetMs);
      record.priorFinalEndOffsetMs = endOffsetMs;
      record.activityHadFinal = true;
      const languageCode = item.languageCode?.trim();
      if (!languageCode) continue;
      this.#onFinal({
        startMs: record.originBackendSessionMs + startOffsetMs,
        endMs: record.originBackendSessionMs + endOffsetMs,
        text,
        languageCode,
      });
    }
  }

  #handleFailure(record) {
    if (this.#closed || (record && record !== this.#active && record.retiring)) return;
    if (record) this.#destroyRecord(record);
    if (record === this.#active) this.#active = null;
    if (this.#rotationTimer) {
      this.#timers.clearTimeout(this.#rotationTimer);
      this.#rotationTimer = null;
    }
    this.#setHealth("degraded");
    if (this.#retryAttempt >= RETRY_DELAYS_MS.length || this.#retryTimer || !this.#projectId) return;
    const delay = RETRY_DELAYS_MS[this.#retryAttempt++];
    this.#retryTimer = this.#timers.setTimeout(() => {
      this.#retryTimer = null;
      if (this.#closed) return;
      this.#setHealth("connecting");
      try {
        this.#openStream();
      } catch {
        this.#handleFailure(this.#active);
      }
    }, delay);
  }

  #endRecord(record) {
    if (record.ended || record.destroyed) return;
    record.ended = true;
    record.retiring = true;
    record.stream.end();
  }

  #destroyRecord(record) {
    if (record.destroyed || record.ended) return;
    record.destroyed = true;
    record.retiring = true;
    record.stream.destroy();
    this.#removeRecord(record);
  }

  #handleTerminal(record) {
    if (!this.#records.has(record)) return;
    const wasActive = this.#active === record;
    this.#removeRecord(record);
    if (wasActive && !this.#closed && !record.retiring) this.#handleFailure(null);
  }

  #removeRecord(record) {
    if (!this.#records.delete(record)) return;
    record.pendingReplay = [];
    record.speechActive = false;
    if (this.#active === record) this.#active = null;
    this.#publishSpeechState();
  }

  #setRecordSpeechActive(record, active) {
    if (record.speechActive === active) return;
    record.speechActive = active;
    this.#publishSpeechState();
  }

  #publishSpeechState() {
    if (this.#closed) return;
    const active = [...this.#records].some((record) => record.speechActive);
    if (active === this.#cloudSpeechActive) return;
    this.#cloudSpeechActive = active;
    this.#onSpeechState(active);
  }

  #clearAudioBuffers() {
    this.#bridge = [];
    this.#bridgeBytes = 0;
    this.#queue = [];
    this.#queueBytes = 0;
  }

  #clearTimers() {
    if (this.#rotationTimer) this.#timers.clearTimeout(this.#rotationTimer);
    if (this.#retryTimer) this.#timers.clearTimeout(this.#retryTimer);
    this.#rotationTimer = null;
    this.#retryTimer = null;
  }

  #setHealth(health, message) {
    this.#health = health;
    this.#onHealth(health, message);
  }
}
