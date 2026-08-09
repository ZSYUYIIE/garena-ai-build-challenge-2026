import {
  isVoiceNarrationMode,
  type VoiceNarrationMode,
} from "../voiceNarration.ts";

export type TimelineNarratorEvent = {
  id: string;
  description: string;
};

export type TimelineTtsEvent = {
  type: string;
  errorMessage?: string;
};

export type TimelineTtsPort = {
  speak(
    text: string,
    onEvent: (event: TimelineTtsEvent) => void,
  ): void | Promise<void>;
  stop(): void | Promise<void>;
};

export type TimelineNarratorOptions = {
  tts: TimelineTtsPort;
  voiceNarrationMode?: VoiceNarrationMode;
  automaticNarrationEnabled?: boolean;
  now?: () => number;
  setTimeout?: (callback: () => void, delayMs: number) => unknown;
  clearTimeout?: (timer: unknown) => void;
  onActiveChange?: (active: boolean) => void;
  onError?: (message: string) => void;
};

type PendingEvent = TimelineNarratorEvent & { receivedAtMs: number };
type ActiveUtterance = {
  token: number;
  started: boolean;
};

const SMART_SILENCE_MS = 750;
const PENDING_TTL_MS = 5_000;
const TERMINAL_EVENTS = new Set(["end", "interrupted", "cancelled", "error"]);

/** Owns bounded Chrome TTS work for newly inserted timeline events. */
export class TimelineNarrator {
  private readonly options: TimelineNarratorOptions;
  private readonly now: () => number;
  private readonly setTimeoutFn: (callback: () => void, delayMs: number) => unknown;
  private readonly clearTimeoutFn: (timer: unknown) => void;
  private mode: VoiceNarrationMode;
  private enabled: boolean;
  private tabActive = false;
  private stopped = false;
  private pending: PendingEvent | null = null;
  private active: ActiveUtterance | null = null;
  private silenceTimer: unknown | null = null;
  private token = 0;
  private readonly seenEventIds = new Set<string>();

  constructor(options: TimelineNarratorOptions) {
    this.options = options;
    this.now = options.now ?? (() => performance.now());
    this.setTimeoutFn = options.setTimeout
      ?? ((callback, delayMs) => setTimeout(callback, delayMs));
    this.clearTimeoutFn = options.clearTimeout
      ?? ((timer) => clearTimeout(timer as ReturnType<typeof setTimeout>));
    this.mode = isVoiceNarrationMode(options.voiceNarrationMode)
      ? options.voiceNarrationMode
      : "smart";
    this.enabled = options.automaticNarrationEnabled !== false;
  }

  offer(event: TimelineNarratorEvent): void {
    if (this.stopped || typeof event.id !== "string" || !event.id) return;
    const description = typeof event.description === "string"
      ? event.description.trim()
      : "";
    if (!description || this.seenEventIds.has(event.id)) return;
    this.seenEventIds.add(event.id);
    if (!this.enabled) return;
    this.pending = {
      id: event.id,
      description,
      receivedAtMs: this.now(),
    };
    this.evaluatePending();
  }

  setVoiceNarrationMode(mode: VoiceNarrationMode): void {
    if (this.stopped || !isVoiceNarrationMode(mode) || mode === this.mode) return;
    this.mode = mode;
    this.clearSilenceTimer();
    if (mode === "smart" && this.tabActive && this.active) {
      this.interruptActive(false);
    }
    this.evaluatePending();
  }

  setAutomaticNarrationEnabled(enabled: boolean): void {
    if (this.stopped || enabled === this.enabled) return;
    this.enabled = enabled;
    if (!enabled) {
      this.clearSilenceTimer();
      this.pending = null;
      this.interruptActive(true);
    }
  }

  setTabActivity(active: boolean): void {
    if (this.stopped) return;
    this.tabActive = active;
    this.clearSilenceTimer();
    if (active && this.mode === "smart" && this.active) {
      this.interruptActive(false);
      return;
    }
    this.evaluatePending();
  }

  interruptForQuestion(): void {
    if (this.stopped) return;
    this.clearSilenceTimer();
    this.pending = null;
    this.interruptActive(true);
  }

  stop(): void {
    if (this.stopped) return;
    this.stopped = true;
    this.clearSilenceTimer();
    this.pending = null;
    this.interruptActive(true);
  }

  private evaluatePending(): void {
    if (this.stopped || !this.enabled || this.active || !this.pending) return;
    if (this.isExpired(this.pending)) {
      this.pending = null;
      this.clearSilenceTimer();
      return;
    }
    if (this.mode !== "smart") {
      this.clearSilenceTimer();
      this.startPending();
      return;
    }
    if (this.tabActive || this.silenceTimer !== null) return;
    this.silenceTimer = this.setTimeoutFn(() => {
      this.silenceTimer = null;
      if (!this.tabActive) this.startPending();
    }, SMART_SILENCE_MS);
  }

  private startPending(): void {
    if (this.stopped || !this.enabled || this.active || !this.pending) return;
    const candidate = this.pending;
    this.pending = null;
    if (this.isExpired(candidate)) return;
    const active: ActiveUtterance = {
      token: ++this.token,
      started: false,
    };
    this.active = active;
    try {
      const admission = this.options.tts.speak(candidate.description, (event) => {
        this.handleTtsEvent(active, event);
      });
      void Promise.resolve(admission).catch((cause) => {
        this.settle(active, boundedError(cause));
      });
    } catch {
      this.settle(active, "Chrome could not start timeline narration.");
    }
  }

  private handleTtsEvent(active: ActiveUtterance, event: TimelineTtsEvent): void {
    if (this.active !== active || active.token !== this.token) return;
    if (event.type === "start") {
      if (!active.started) {
        active.started = true;
        this.options.onActiveChange?.(true);
      }
      return;
    }
    if (!TERMINAL_EVENTS.has(event.type)) return;
    const error = event.type === "error"
      ? boundedError(event.errorMessage || "Chrome timeline narration failed.")
      : null;
    this.settle(active, error);
  }

  private settle(active: ActiveUtterance, error: string | null): void {
    if (this.active !== active || active.token !== this.token) return;
    this.active = null;
    this.token += 1;
    if (active.started) this.options.onActiveChange?.(false);
    if (error) this.options.onError?.(error);
    this.evaluatePending();
  }

  private interruptActive(clearPending: boolean): void {
    if (clearPending) this.pending = null;
    const active = this.active;
    if (!active) return;
    this.active = null;
    this.token += 1;
    if (active.started) this.options.onActiveChange?.(false);
    try {
      void this.options.tts.stop();
    } catch {
      // The stale utterance token already prevents unsafe lifecycle callbacks.
    }
  }

  private clearSilenceTimer(): void {
    if (this.silenceTimer !== null) this.clearTimeoutFn(this.silenceTimer);
    this.silenceTimer = null;
  }

  private isExpired(event: PendingEvent): boolean {
    return this.now() - event.receivedAtMs >= PENDING_TTL_MS;
  }
}

export function createChromeTimelineTtsPort(): TimelineTtsPort {
  return {
    speak: (text, onEvent) => chrome.tts.speak(text, {
      enqueue: false,
      requiredEventTypes: ["start", "end"],
      onEvent,
    }),
    stop: () => chrome.tts.stop(),
  };
}

function boundedError(cause: unknown): string {
  const message = cause instanceof Error ? cause.message : String(cause ?? "");
  return (message.trim() || "Chrome timeline narration failed.").slice(0, 240);
}
