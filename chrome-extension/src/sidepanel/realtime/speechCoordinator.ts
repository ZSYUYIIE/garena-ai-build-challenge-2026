import type {
  ModelAudioChunk,
  ModelAudioEnqueueResult,
  PlaybackMode,
} from "./modelAudioPlayback.ts";

export type PlaybackController = {
  enqueue(chunk: ModelAudioChunk): ModelAudioEnqueueResult;
  complete(turnId: string): void;
  clear(turnId?: string): void;
  stop(): void;
  setOnIdleListener(listener: ((turnId: string) => void) | null): void;
};

export type SpeechCoordinatorOptions = {
  playback: PlaybackController;
  setTabGain: (gain: 0.3 | 1, fadeMs: number) => void;
  onFailTurn?: (turnId: string, reason: string) => void;
  onPlaybackIdle?: (turnId: string) => void;
  setTimeout?: (callback: () => void, delayMs: number) => unknown;
  clearTimeout?: (timer: unknown) => void;
};

type ActiveTurn = {
  turnId: string;
  mode: PlaybackMode;
  userSpeaking: boolean;
  localSpeechTimer: unknown | null;
  responseTimer: unknown | null;
};

const RESPONSE_TIMEOUT_MS = 15_000;
const MAX_LOCAL_SPEECH_MS = 60_000;

/** Applies the user-answer priority rules around a cancellable model PCM queue. */
export class SpeechCoordinator {
  private readonly options: SpeechCoordinatorOptions;
  private readonly setTimeoutFn: (callback: () => void, delayMs: number) => unknown;
  private readonly clearTimeoutFn: (timer: unknown) => void;
  private active: ActiveTurn | null = null;
  private tabActive = false;
  private ducked = false;
  private stopped = false;

  constructor(options: SpeechCoordinatorOptions) {
    this.options = options;
    this.setTimeoutFn = options.setTimeout ?? ((callback, delayMs) => setTimeout(callback, delayMs));
    this.clearTimeoutFn = options.clearTimeout ?? ((timer) => clearTimeout(timer as ReturnType<typeof setTimeout>));
    options.playback.setOnIdleListener((turnId) => this.playbackIdle(turnId));
  }

  userStarted(turnId: string): void {
    if (this.stopped) return;
    this.replaceWithAnswer(turnId, true);
  }

  userEnded(turnId: string): void {
    if (!this.isActiveAnswer(turnId)) return;
    const active = this.active!;
    active.userSpeaking = false;
    this.cancelLocalSpeechTimer(active);
    this.resetResponseTimer(active);
  }

  typedQuestionStarted(turnId: string): void {
    if (this.stopped) return;
    this.replaceWithAnswer(turnId, false);
    this.resetResponseTimer(this.active!);
  }

  answerProgress(turnId: string): void {
    if (this.stopped || !this.isActiveAnswer(turnId)) return;
    const active = this.active!;
    if (active.userSpeaking || active.responseTimer === null) return;
    this.resetResponseTimer(active);
  }

  tabActivity(active: boolean): void {
    this.tabActive = active;
    if (active && this.active?.mode === "narration") this.clearActive(false);
  }

  modelAudio(chunk: ModelAudioChunk): boolean {
    if (this.stopped) return false;
    if (chunk.mode === "answer") {
      if (!this.isActiveAnswer(chunk.turnId)) return false;
    } else if (chunk.mode === "narration") {
      if (this.tabActive) return false;
      if (this.active && (this.active.turnId !== chunk.turnId || this.active.mode !== "narration")) return false;
      if (!this.active) {
        this.active = {
          turnId: chunk.turnId,
          mode: "narration",
          userSpeaking: false,
          localSpeechTimer: null,
          responseTimer: null,
        };
      }
    } else {
      return false;
    }

    try {
      const result = this.options.playback.enqueue(chunk);
      if (result === "overflow") {
        this.failTurn(chunk.turnId, "Model audio queue overflow.");
        return false;
      }
      if (result === "unavailable") {
        this.failTurn(chunk.turnId, "Model audio playback unavailable.");
        return false;
      }
    } catch {
      // Invalid and stale provider output cannot become audible or re-open a cancelled turn.
      this.failTurn(chunk.turnId, "Invalid model audio.");
      return false;
    }
    if (this.active?.turnId === chunk.turnId && !this.active.userSpeaking) this.resetResponseTimer(this.active);
    return true;
  }

  turnComplete(turn: { turnId: string; mode: PlaybackMode }): void {
    if (!this.active || this.active.turnId !== turn.turnId || this.active.mode !== turn.mode) return;
    this.cancelResponseTimer(this.active);
    this.options.playback.complete(turn.turnId);
  }

  failTurn(turnId: string, reason: string): void {
    if (!this.active || this.active.turnId !== turnId) return;
    this.options.onFailTurn?.(turnId, reason);
    this.clearActive(this.active.mode === "answer");
  }

  clearPlayback(turnId?: string): void {
    if (turnId === undefined) {
      this.clearActive(this.active?.mode === "answer");
      this.options.playback.clear();
      return;
    }
    if (this.active?.turnId === turnId) this.clearActive(this.active.mode === "answer");
    else this.options.playback.clear(turnId);
  }

  stop(): void {
    if (this.stopped) return;
    this.stopped = true;
    this.cancelTimers(this.active);
    this.active = null;
    this.options.playback.stop();
    this.restoreTabGain();
  }

  private replaceWithAnswer(turnId: string, userSpeaking: boolean): void {
    this.clearActive(false);
    this.active = {
      turnId,
      mode: "answer",
      userSpeaking,
      localSpeechTimer: null,
      responseTimer: null,
    };
    this.duckTabGain();
    if (userSpeaking) {
      this.active.localSpeechTimer = this.setTimeoutFn(
        () => this.failTurn(turnId, "Speech turn exceeded 60 seconds. Please try again."),
        MAX_LOCAL_SPEECH_MS,
      );
    }
  }

  private clearActive(restoreAnswerGain: boolean): void {
    const active = this.active;
    if (!active) return;
    this.cancelTimers(active);
    this.options.playback.clear(active.turnId);
    this.active = null;
    if (restoreAnswerGain && active.mode === "answer") this.restoreTabGain();
  }

  private playbackIdle(turnId: string): void {
    if (!this.active || this.active.turnId !== turnId) return;
    const active = this.active;
    this.cancelTimers(active);
    this.active = null;
    if (active.mode === "answer") this.restoreTabGain();
    this.options.onPlaybackIdle?.(turnId);
  }

  private resetResponseTimer(active: ActiveTurn): void {
    if (active.userSpeaking) return;
    this.cancelResponseTimer(active);
    active.responseTimer = this.setTimeoutFn(() => {
      if (this.active === active && !active.userSpeaking) {
        this.failTurn(active.turnId, "Model response timed out.");
      }
    }, RESPONSE_TIMEOUT_MS);
  }

  private cancelTimers(active: ActiveTurn | null): void {
    if (!active) return;
    this.cancelLocalSpeechTimer(active);
    this.cancelResponseTimer(active);
  }

  private cancelLocalSpeechTimer(active: ActiveTurn): void {
    if (active.localSpeechTimer !== null) this.clearTimeoutFn(active.localSpeechTimer);
    active.localSpeechTimer = null;
  }

  private cancelResponseTimer(active: ActiveTurn): void {
    if (active.responseTimer !== null) this.clearTimeoutFn(active.responseTimer);
    active.responseTimer = null;
  }

  private isActiveAnswer(turnId: string): boolean {
    return this.active?.turnId === turnId && this.active.mode === "answer";
  }

  private duckTabGain(): void {
    this.options.setTabGain(0.3, 150);
    this.ducked = true;
  }

  private restoreTabGain(): void {
    if (!this.ducked) return;
    this.options.setTabGain(1, 250);
    this.ducked = false;
  }
}
