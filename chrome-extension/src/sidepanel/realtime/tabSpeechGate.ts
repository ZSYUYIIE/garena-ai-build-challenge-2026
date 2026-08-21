import { PcmChunker } from "./audioPcm.ts";
import { TabSpeechDecision } from "./tabSpeechDecision.ts";
import {
  parseTabSpeechWorkerEvent,
  type TabSpeechWorkerCommand,
} from "./tabSpeechWorkerProtocol.ts";
import { TabActivityGate } from "./voiceActivity.ts";

type WorkerPort = {
  onmessage: ((event: MessageEvent<unknown>) => void) | null;
  onerror: ((event: ErrorEvent) => void) | null;
  postMessage(message: unknown, transfer?: Transferable[]): void;
  terminate(): void;
};

type GateMode = "warming" | "model" | "fallback" | "stopped";
type TimerHandle = ReturnType<typeof globalThis.setTimeout>;

export type TabSpeechGateOptions = {
  onSpeechChange(active: boolean): void;
  createWorker?: () => WorkerPort;
  setTimeout?: (callback: () => void, delayMs: number) => TimerHandle;
  clearTimeout?: (handle: TimerHandle) => void;
};

const FRAME_SAMPLES = 512;
const FRAME_DURATION_MS = 32;
const MODEL_WARMUP_MS = 500;
const STARTUP_TIMEOUT_MS = 5_000;
const MAX_IN_FLIGHT = 8;

export class TabSpeechGate {
  private readonly onSpeechChange: (active: boolean) => void;
  private readonly setTimeoutFn: (callback: () => void, delayMs: number) => TimerHandle;
  private readonly clearTimeoutFn: (handle: TimerHandle) => void;
  private readonly energy = new TabActivityGate();
  private readonly decision = new TabSpeechDecision();
  private readonly chunker = new PcmChunker(FRAME_SAMPLES);
  private worker: WorkerPort | null = null;
  private mode: GateMode = "warming";
  private startupTimer: TimerHandle | null = null;
  private ready = false;
  private generation = 1;
  private sequence = 0;
  private lastAcceptedSequence = 0;
  private inFlight = 0;
  private expectedFrameEnds = new Map<number, number>();
  private expectedPacketTimestampMs: number | null = null;
  private nextFrameEndMs: number | null = null;
  private energyActive = false;
  private published = false;

  constructor(options: TabSpeechGateOptions) {
    this.onSpeechChange = options.onSpeechChange;
    this.setTimeoutFn = options.setTimeout ?? ((callback, delayMs) => globalThis.setTimeout(callback, delayMs));
    this.clearTimeoutFn = options.clearTimeout ?? ((handle) => globalThis.clearTimeout(handle));
    const createWorker = options.createWorker ?? (() => new Worker(
      new URL("./tabSpeechWorker.ts", import.meta.url),
      { type: "module", name: "streamsense-tab-speech" },
    ));
    try {
      const worker = createWorker();
      this.worker = worker;
      worker.onmessage = (event) => this.handleWorkerEvent(event.data);
      worker.onerror = () => this.enterFallback();
      worker.postMessage({ type: "initialize", generation: this.generation } satisfies TabSpeechWorkerCommand);
      this.startupTimer = this.setTimeoutFn(() => this.enterFallback(), STARTUP_TIMEOUT_MS);
    } catch {
      this.terminateWorker();
      this.mode = "fallback";
      this.clearStartupTimer();
    }
  }

  push(pcm: Int16Array, firstSampleTimestampMs: number): void {
    if (this.mode === "stopped") return;
    if (!(pcm instanceof Int16Array) || pcm.length === 0) {
      this.enterFallback();
      return;
    }
    if (!Number.isFinite(firstSampleTimestampMs) || firstSampleTimestampMs < 0) {
      this.enterFallback();
      return;
    }
    const energy = this.energy.push(pcm, firstSampleTimestampMs);
    this.energyActive = energy.active;
    if (this.mode === "fallback" || (this.mode === "warming" && !this.ready)) {
      if (energy.changed) this.publish(energy.active);
      return;
    }
    if (this.mode === "warming" && energy.changed) this.publish(energy.active);
    if (!this.validatePacketClock(pcm, firstSampleTimestampMs)) {
      this.enterFallback();
      return;
    }
    for (const frame of this.chunker.push(pcm)) {
      if (!this.sendFrame(frame)) break;
    }
  }

  stop(): void {
    if (this.mode === "stopped") return;
    this.mode = "stopped";
    this.generation += 1;
    this.clearStartupTimer();
    this.terminateWorker();
    this.expectedFrameEnds.clear();
    this.chunker.flush();
    this.decision.reset();
  }

  private validatePacketClock(pcm: Int16Array, timestampMs: number): boolean {
    if (!Number.isFinite(timestampMs) || timestampMs < 0) return false;
    if (
      this.expectedPacketTimestampMs !== null
      && Math.abs(timestampMs - this.expectedPacketTimestampMs) > 1
    ) return false;
    this.nextFrameEndMs ??= timestampMs + FRAME_DURATION_MS;
    this.expectedPacketTimestampMs = timestampMs + pcm.length / 16;
    return true;
  }

  private sendFrame(pcm: Int16Array): boolean {
    if (!this.worker || this.nextFrameEndMs === null) return false;
    if (this.inFlight >= MAX_IN_FLIGHT || this.sequence >= Number.MAX_SAFE_INTEGER) {
      this.enterFallback();
      return false;
    }
    const normalized = Float32Array.from(pcm, (sample) => sample / 32_768);
    const sequence = ++this.sequence;
    const frameEndMs = this.nextFrameEndMs;
    this.nextFrameEndMs += FRAME_DURATION_MS;
    this.inFlight += 1;
    this.expectedFrameEnds.set(sequence, frameEndMs);
    try {
      this.worker.postMessage({
        type: "frame",
        generation: this.generation,
        sequence,
        frameEndMs,
        pcm: normalized.buffer,
      } satisfies TabSpeechWorkerCommand, [normalized.buffer]);
      return true;
    } catch {
      this.enterFallback();
      return false;
    }
  }

  private handleWorkerEvent(value: unknown): void {
    if (this.mode === "fallback" || this.mode === "stopped") return;
    let event;
    try {
      event = parseTabSpeechWorkerEvent(value);
    } catch {
      this.enterFallback();
      return;
    }
    if (event.generation !== this.generation) {
      this.enterFallback();
      return;
    }
    if (event.type === "failed") {
      this.enterFallback();
      return;
    }
    if (event.type === "ready") {
      if (this.ready) {
        this.enterFallback();
        return;
      }
      this.ready = true;
      this.clearStartupTimer();
      this.chunker.flush();
      this.expectedPacketTimestampMs = null;
      this.nextFrameEndMs = null;
      return;
    }
    const expectedFrameEnd = this.expectedFrameEnds.get(event.sequence);
    if (
      !this.ready
      || event.sequence !== this.lastAcceptedSequence + 1
      || expectedFrameEnd === undefined
      || expectedFrameEnd !== event.frameEndMs
    ) {
      this.enterFallback();
      return;
    }
    this.expectedFrameEnds.delete(event.sequence);
    this.lastAcceptedSequence = event.sequence;
    this.inFlight -= 1;
    let result;
    try {
      result = this.decision.push(event.probability, event.frameEndMs);
    } catch {
      this.enterFallback();
      return;
    }
    if (this.mode === "warming") {
      if (result.active || result.stableNonSpeechMs >= MODEL_WARMUP_MS) {
        this.mode = "model";
        this.publish(result.active);
      }
      return;
    }
    if (result.changed) this.publish(result.active);
  }

  private enterFallback(): void {
    if (this.mode === "fallback" || this.mode === "stopped") return;
    this.mode = "fallback";
    this.clearStartupTimer();
    this.terminateWorker();
    this.expectedFrameEnds.clear();
    this.chunker.flush();
    this.decision.reset();
    this.publish(this.energyActive);
  }

  private publish(active: boolean): void {
    if (active === this.published || this.mode === "stopped") return;
    this.published = active;
    this.onSpeechChange(active);
  }

  private clearStartupTimer(): void {
    if (this.startupTimer === null) return;
    this.clearTimeoutFn(this.startupTimer);
    this.startupTimer = null;
  }

  private terminateWorker(): void {
    const worker = this.worker;
    this.worker = null;
    try {
      worker?.terminate();
    } catch {
      // A broken worker must never break captured-tab audio delivery.
    }
  }
}
