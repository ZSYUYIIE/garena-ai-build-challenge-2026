export type PlaybackMode = "answer" | "narration";

export type ModelAudioChunk = {
  turnId: string;
  mode: PlaybackMode;
  pcm: ArrayBuffer;
  sampleRate: number;
  mimeType: string;
};

export type ModelAudioPlaybackOptions = {
  audioContext: AudioContext;
  contextTimeToExtensionSessionMs: (contextTime: number) => number;
  onReferencePcm: (reference: {
    source: "model";
    pcm: Int16Array;
    sampleRate: number;
    playAtContextTime: number;
    firstSampleExtensionSessionMs: number;
  }) => void;
  onIdle: (turnId: string) => void;
};

type ScheduledSource = { source: AudioBufferSourceNode; ended: boolean };
type TurnQueue = {
  turnId: string;
  mode: PlaybackMode;
  nextPlayAt: number;
  complete: boolean;
  idleNotified: boolean;
  sources: Set<ScheduledSource>;
};

const MAX_QUEUED_MS = 5_000;
const MAX_RETIRED_TURNS = 128;
const PCM_MIME = /^audio\/pcm;rate=([1-9][0-9]*)$/;

/** Schedules one Live-model PCM turn at a time and owns cancellation of its sources. */
export class ModelAudioPlayback {
  private readonly options: ModelAudioPlaybackOptions;
  private readonly queues = new Map<string, TurnQueue>();
  private readonly retiredTurns = new Set<string>();
  private readonly retiredTurnOrder: string[] = [];
  private activeTurnId: string | null = null;
  private idleListener: ((turnId: string) => void) | null = null;

  constructor(options: ModelAudioPlaybackOptions) {
    this.options = options;
  }

  setOnIdleListener(listener: ((turnId: string) => void) | null): void {
    this.idleListener = listener;
  }

  /** Bounded lifecycle state for diagnostics without exposing retained audio objects. */
  getDiagnostics(): {
    activeTurnId: string | null;
    queuedTurnCount: number;
    retainedSourceCount: number;
    retiredTurnCount: number;
  } {
    let retainedSourceCount = 0;
    for (const queue of this.queues.values()) retainedSourceCount += queue.sources.size;
    return {
      activeTurnId: this.activeTurnId,
      queuedTurnCount: this.queues.size,
      retainedSourceCount,
      retiredTurnCount: this.retiredTurns.size,
    };
  }

  enqueue(chunk: ModelAudioChunk): "accepted" | "overflow" {
    this.validateChunk(chunk);
    if (this.retiredTurns.has(chunk.turnId)) {
      throw new Error(`Stale model audio turn: ${chunk.turnId}`);
    }
    if (this.activeTurnId !== null && this.activeTurnId !== chunk.turnId) {
      throw new Error(`Stale model audio turn: ${chunk.turnId}`);
    }

    const durationSeconds = chunk.pcm.byteLength / 2 / chunk.sampleRate;
    const now = this.options.audioContext.currentTime;
    const queue = this.queues.get(chunk.turnId);
    const queuedUntil = queue ? Math.max(queue.nextPlayAt, now) : now;
    if ((queuedUntil - now + durationSeconds) * 1_000 > MAX_QUEUED_MS) return "overflow";

    const activeQueue = queue ?? {
      turnId: chunk.turnId,
      mode: chunk.mode,
      nextPlayAt: now,
      complete: false,
      idleNotified: false,
      sources: new Set<ScheduledSource>(),
    };
    if (queue && queue.mode !== chunk.mode) {
      throw new Error(`Model audio mode changed for turn: ${chunk.turnId}`);
    }

    const pcm = decodePcm16(chunk.pcm);
    const buffer = this.options.audioContext.createBuffer(1, pcm.length, chunk.sampleRate);
    const channel = buffer.getChannelData(0);
    for (let index = 0; index < pcm.length; index += 1) channel[index] = pcm[index] / 32_768;

    const playAtContextTime = queuedUntil;
    const source = this.options.audioContext.createBufferSource();
    source.buffer = buffer;
    source.connect(this.options.audioContext.destination);
    const scheduled: ScheduledSource = { source, ended: false };
    source.onended = () => this.handleEnded(activeQueue, scheduled);

    // Validation and all allocation above precede the first observable scheduling operation.
    activeQueue.sources.add(scheduled);
    activeQueue.nextPlayAt = playAtContextTime + durationSeconds;
    this.queues.set(chunk.turnId, activeQueue);
    this.activeTurnId = chunk.turnId;
    source.start(playAtContextTime);
    this.options.onReferencePcm({
      source: "model",
      pcm,
      sampleRate: chunk.sampleRate,
      playAtContextTime,
      firstSampleExtensionSessionMs: this.options.contextTimeToExtensionSessionMs(playAtContextTime),
    });
    return "accepted";
  }

  complete(turnId: string): void {
    if (this.retiredTurns.has(turnId)) return;
    const queue = this.queues.get(turnId);
    if (!queue) {
      this.retireTurn(turnId);
      if (this.activeTurnId === turnId) this.activeTurnId = null;
      this.notifyIdle(turnId);
      return;
    }
    queue.complete = true;
    this.maybeIdle(queue);
  }

  clear(turnId?: string): void {
    const ids = turnId === undefined
      ? [...this.queues.keys()]
      : [turnId];
    for (const id of ids) {
      const queue = this.queues.get(id);
      this.retireTurn(id);
      if (this.activeTurnId === id) this.activeTurnId = null;
      if (!queue) continue;
      // Keep entries until after every source has been stopped: an ended callback may clear reentrantly.
      for (const scheduled of queue.sources) scheduled.source.stop();
      queue.sources.clear();
      this.queues.delete(id);
    }
  }

  stop(): void {
    this.clear();
  }

  private handleEnded(queue: TurnQueue, scheduled: ScheduledSource): void {
    if (!queue.sources.has(scheduled) || this.queues.get(queue.turnId) !== queue) return;
    scheduled.ended = true;
    this.maybeIdle(queue);
  }

  private maybeIdle(queue: TurnQueue): void {
    if (!queue.complete || queue.idleNotified || [...queue.sources].some((scheduled) => !scheduled.ended)) return;
    queue.idleNotified = true;
    this.retireTurn(queue.turnId);
    if (this.activeTurnId === queue.turnId) this.activeTurnId = null;
    // Invoke while the queue still owns every source so reentrant clear() stops them all.
    this.notifyIdle(queue.turnId);
    if (this.queues.get(queue.turnId) === queue) {
      queue.sources.clear();
      this.queues.delete(queue.turnId);
    }
  }

  private notifyIdle(turnId: string): void {
    this.options.onIdle(turnId);
    this.idleListener?.(turnId);
  }

  private retireTurn(turnId: string): void {
    if (this.retiredTurns.has(turnId)) return;
    this.retiredTurns.add(turnId);
    this.retiredTurnOrder.push(turnId);
    while (this.retiredTurnOrder.length > MAX_RETIRED_TURNS) {
      const expiredTurnId = this.retiredTurnOrder.shift()!;
      this.retiredTurns.delete(expiredTurnId);
    }
  }

  private validateChunk(chunk: ModelAudioChunk): void {
    if (!chunk || typeof chunk.turnId !== "string" || chunk.turnId.length === 0) {
      throw new TypeError("Model audio turn ID is required.");
    }
    if (chunk.mode !== "answer" && chunk.mode !== "narration") {
      throw new TypeError("Model audio mode is invalid.");
    }
    const match = PCM_MIME.exec(chunk.mimeType);
    if (!match) throw new TypeError("Model audio MIME type must be PCM.");
    const mimeRate = Number(match[1]);
    if (
      !Number.isSafeInteger(chunk.sampleRate) ||
      chunk.sampleRate < 8_000 ||
      chunk.sampleRate > 48_000 ||
      mimeRate !== chunk.sampleRate
    ) {
      throw new RangeError("Model audio sample rate is invalid.");
    }
    if (!(chunk.pcm instanceof ArrayBuffer) || chunk.pcm.byteLength === 0 || chunk.pcm.byteLength % 2 !== 0) {
      throw new TypeError("Model audio PCM must contain an even number of bytes.");
    }
  }
}

function decodePcm16(buffer: ArrayBuffer): Int16Array {
  const data = new DataView(buffer);
  const pcm = new Int16Array(buffer.byteLength / 2);
  for (let index = 0; index < pcm.length; index += 1) pcm[index] = data.getInt16(index * 2, true);
  return pcm;
}
