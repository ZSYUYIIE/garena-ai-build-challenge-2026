export const TAB_SPEECH_POSITIVE_THRESHOLD = 0.65;
export const TAB_SPEECH_NEGATIVE_THRESHOLD = 0.35;
export const TAB_SPEECH_END_HANGOVER_MS = 500;

export type TabSpeechDecisionResult = {
  active: boolean;
  changed: boolean;
  stableNonSpeechMs: number;
};

export class TabSpeechDecision {
  private active = false;
  private lastFrameEndMs: number | null = null;
  private negativeSinceMs: number | null = null;
  private positives: boolean[] = [];

  push(probability: number, frameEndMs: number): TabSpeechDecisionResult {
    if (!Number.isFinite(probability) || probability < 0 || probability > 1) {
      throw new RangeError("Speech probability must be between zero and one.");
    }
    if (!Number.isFinite(frameEndMs) || frameEndMs < 0) {
      throw new RangeError("Speech frame time must be finite and nonnegative.");
    }
    if (this.lastFrameEndMs !== null && frameEndMs <= this.lastFrameEndMs) {
      throw new RangeError("Speech frame time must be strictly monotonic.");
    }

    const priorFrameEndMs = this.lastFrameEndMs;
    this.lastFrameEndMs = frameEndMs;
    const wasActive = this.active;

    if (!this.active) {
      this.positives.push(probability >= TAB_SPEECH_POSITIVE_THRESHOLD);
      if (this.positives.length > 3) this.positives.shift();
      if (probability <= TAB_SPEECH_NEGATIVE_THRESHOLD) {
        this.negativeSinceMs ??= priorFrameEndMs ?? frameEndMs;
      } else {
        this.negativeSinceMs = null;
      }
      if (this.positives.filter(Boolean).length >= 2) {
        this.active = true;
        this.negativeSinceMs = null;
        this.positives = [];
      }
    } else if (probability <= TAB_SPEECH_NEGATIVE_THRESHOLD) {
      this.negativeSinceMs ??= priorFrameEndMs ?? frameEndMs;
      if (frameEndMs - this.negativeSinceMs >= TAB_SPEECH_END_HANGOVER_MS) {
        this.active = false;
        this.positives = [];
      }
    } else {
      this.negativeSinceMs = null;
    }

    return {
      active: this.active,
      changed: wasActive !== this.active,
      stableNonSpeechMs: this.active || this.negativeSinceMs === null
        ? 0
        : frameEndMs - this.negativeSinceMs,
    };
  }

  reset(): void {
    this.active = false;
    this.lastFrameEndMs = null;
    this.negativeSinceMs = null;
    this.positives = [];
  }
}
