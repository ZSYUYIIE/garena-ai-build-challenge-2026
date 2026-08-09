import type { LiveProviderState, RealtimeStatus, TurnMode, VoiceStatus } from "./types.ts";

export type QuestionAvailability = "stopped" | "connecting" | "ready" | "degraded";
export type MicrophoneRetirementResult = "none" | "retired" | "transport_failed";

export type VoiceShortcutEvent = Pick<
  KeyboardEvent,
  "altKey" | "shiftKey" | "ctrlKey" | "metaKey" | "code"
>;

export function isVoiceHoldShortcut(event: VoiceShortcutEvent): boolean {
  return !event.altKey
    && !event.shiftKey
    && !event.ctrlKey
    && !event.metaKey
    && event.code === "KeyS";
}

export function isEditableShortcutTarget(target: EventTarget | null): boolean {
  if (!target || typeof target !== "object") return false;
  const candidate = target as { isContentEditable?: boolean; tagName?: unknown };
  const tagName = typeof candidate.tagName === "string"
    ? candidate.tagName.toUpperCase()
    : "";
  return candidate.isContentEditable === true
    || tagName === "INPUT"
    || tagName === "TEXTAREA"
    || tagName === "SELECT";
}

export function questionAvailabilityFor(
  status: RealtimeStatus,
  helloAccepted: boolean,
  liveState: LiveProviderState,
): QuestionAvailability {
  if (status === "idle" || status === "error") return "stopped";
  if (status !== "connected" || !helloAccepted || liveState === "connecting") return "connecting";
  return liveState === "ready" ? "ready" : "degraded";
}

export function canAskRealtime(
  status: RealtimeStatus,
  helloAccepted: boolean,
  liveState: LiveProviderState,
): boolean {
  return questionAvailabilityFor(status, helloAccepted, liveState) === "ready";
}

export function questionCopyFor(availability: QuestionAvailability) {
  if (availability === "connecting") return {
    placeholder: "Gemini is connecting…",
    statusText: "Gemini is connecting — questions will unlock when ready",
  };
  if (availability === "degraded") return {
    placeholder: "Gemini is reconnecting…",
    statusText: "Gemini is reconnecting — questions are temporarily paused",
  };
  return availability === "ready"
    ? { placeholder: "Ask a question...", statusText: null }
    : { placeholder: "Start StreamSense to ask a question", statusText: null };
}

export function voiceQuestionStatusFor(
  voiceStatus: VoiceStatus,
  availability: QuestionAvailability,
  microphoneState?: "pending" | "ready" | "denied" | "degraded",
): string | null {
  const availabilityText = questionCopyFor(availability).statusText;
  if (availabilityText) return availabilityText;
  if (microphoneState === "denied") {
    return "Microphone access is blocked. Allow access to enable voice questions.";
  }
  if (microphoneState === "degraded") {
    return "Microphone unavailable. Retry after selecting a working input device.";
  }
  if (microphoneState === "pending" && availability === "ready") {
    return "Requesting microphone access…";
  }
  return {
    off: null,
    listening: "Hold S or the microphone to ask by voice",
    user_speaking: "Listening live… Release S to send",
    gemini_speaking: "Gemini is replying…",
    degraded: "Voice unavailable — typed questions still work",
  }[voiceStatus];
}

export function draftAfterAdmission(draft: string, accepted: boolean): string {
  return accepted ? "" : draft;
}

export function retryableAnswerNotice(
  mode: TurnMode,
  retryable: boolean,
  settledActiveTurn: boolean,
): string | null {
  return settledActiveTurn && mode === "answer" && retryable
    ? "Gemini could not complete this answer. Ask again when Live is ready."
    : null;
}

export function retireMicrophoneBeforeTypedAdmission(
  retireMicrophone: () => MicrophoneRetirementResult,
  admitTypedTurn: () => void,
): boolean {
  if (retireMicrophone() === "transport_failed") return false;
  admitTypedTurn();
  return true;
}

export async function dispatchTypedQuestion(options: {
  waitForFrame: () => Promise<void>;
  isReady: () => boolean;
  send: () => void;
  onUnavailable: () => void;
}): Promise<boolean> {
  await options.waitForFrame();
  if (!options.isReady()) {
    options.onUnavailable();
    return false;
  }
  options.send();
  return true;
}
