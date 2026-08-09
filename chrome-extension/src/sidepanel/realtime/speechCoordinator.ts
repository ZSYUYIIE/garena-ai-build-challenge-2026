import type {
  ModelAudioChunk,
  ModelAudioEnqueueResult,
  PlaybackMode,
} from "./modelAudioPlayback.ts";
import {
  isVoiceNarrationMode,
  type VoiceNarrationMode,
} from "../voiceNarration.ts";

type TabGain = 0 | 0.3 | 0.4 | 1;

export type PlaybackController = {
  enqueue(chunk: ModelAudioChunk): ModelAudioEnqueueResult;
  complete(turnId: string): void;
  clear(turnId?: string): void;
  stop(): void;
  setOnIdleListener(listener: ((turnId: string) => void) | null): void;
};

export type SpeechCoordinatorOptions = {
  playback: PlaybackController;
  voiceNarrationMode?: VoiceNarrationMode;
  setTabGain: (gain: TabGain, fadeMs: number) => void;
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
  private voiceNarrationMode: VoiceNarrationMode;
  private timelineNarrationActive = false;
  private tabGain: TabGain = 1;
  private stopped = false;

  constructor(options: SpeechCoordinatorOptions) {
    this.options = options;
    this.setTimeoutFn = options.setTimeout ?? ((callback, delayMs) => setTimeout(callback, delayMs));
    this.clearTimeoutFn = options.clearTimeout ?? ((timer) => clearTimeout(timer as ReturnType<typeof setTimeout>));
    this.voiceNarrationMode = isVoiceNarrationMode(options.voiceNarrationMode)
      ? options.voiceNarrationMode
      : "smart";
    options.playback.setOnIdleListener((turnId) => this.playbackIdle(turnId));
    this.syncTabGain();
  }

  userStarted(turnId: string): void {
    if (this.stopped) return;
    this.replaceWithAnswer(turnId, true);
  }

  userEnded(turnId: string): void {
    if (!this.isActiveAnswer(turnId)) return;
    const active = this.active!;
    active.userSpeaking = false;
    this.syncTabGain();
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
    if (
      active
      && this.voiceNarrationMode === "smart"
      && this.active?.mode === "narration"
    ) {
      this.clearActive();
    }
  }

  setVoiceNarrationMode(mode: VoiceNarrationMode): void {
    if (this.stopped || !isVoiceNarrationMode(mode) || mode === this.voiceNarrationMode) return;
    this.voiceNarrationMode = mode;
    if (
      mode === "smart"
      && this.tabActive
      && this.active?.mode === "narration"
    ) {
      this.clearActive();
      return;
    }
    this.syncTabGain();
  }

  setTimelineNarrationActive(active: boolean): void {
    if (this.stopped || active === this.timelineNarrationActive) return;
    this.timelineNarrationActive = active;
    this.syncTabGain();
  }

  answerOwnsSpeech(): boolean {
    return this.active?.mode === "answer";
  }

  modelAudio(chunk: ModelAudioChunk): boolean {
    if (this.stopped) return false;
    if (chunk.mode === "answer") {
      if (!this.isActiveAnswer(chunk.turnId)) return false;
    } else if (chunk.mode === "narration") {
      if (this.voiceNarrationMode === "smart" && this.tabActive) return false;
      if (this.active && (this.active.turnId !== chunk.turnId || this.active.mode !== "narration")) return false;
      if (!this.active) {
        this.active = {
          turnId: chunk.turnId,
          mode: "narration",
          userSpeaking: false,
          localSpeechTimer: null,
          responseTimer: null,
        };
        this.syncTabGain();
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
    this.clearActive();
  }

  clearPlayback(turnId?: string): void {
    if (turnId === undefined) {
      this.clearActive();
      this.options.playback.clear();
      return;
    }
    if (this.active?.turnId === turnId) this.clearActive();
    else this.options.playback.clear(turnId);
  }

  stop(): void {
    if (this.stopped) return;
    this.stopped = true;
    this.cancelTimers(this.active);
    this.active = null;
    this.timelineNarrationActive = false;
    this.options.playback.stop();
    this.syncTabGain();
  }

  private replaceWithAnswer(turnId: string, userSpeaking: boolean): void {
    this.clearActive();
    this.active = {
      turnId,
      mode: "answer",
      userSpeaking,
      localSpeechTimer: null,
      responseTimer: null,
    };
    this.syncTabGain();
    if (userSpeaking) {
      this.active.localSpeechTimer = this.setTimeoutFn(
        () => this.failTurn(turnId, "Speech turn exceeded 60 seconds. Please try again."),
        MAX_LOCAL_SPEECH_MS,
      );
    }
  }

  private clearActive(): void {
    const active = this.active;
    if (!active) return;
    this.cancelTimers(active);
    this.options.playback.clear(active.turnId);
    this.active = null;
    this.syncTabGain();
  }

  private playbackIdle(turnId: string): void {
    if (!this.active || this.active.turnId !== turnId) return;
    const active = this.active;
    this.cancelTimers(active);
    this.active = null;
    this.syncTabGain();
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

  private desiredTabGain(): TabGain {
    if (this.stopped) return 1;
    if (this.voiceNarrationMode === "narration_only") return 0;
    if (this.active?.mode === "answer") {
      return this.active.userSpeaking ? 0 : 0.3;
    }
    if (
      (this.active?.mode === "narration" || this.timelineNarrationActive)
      && this.voiceNarrationMode === "over_audio"
    ) {
      return 0.4;
    }
    return 1;
  }

  private syncTabGain(): void {
    const gain = this.desiredTabGain();
    if (gain === this.tabGain) return;
    const fadeMs = gain === 0 ? 50 : gain === 1 ? 250 : 150;
    this.options.setTabGain(gain, fadeMs);
    this.tabGain = gain;
  }
}
