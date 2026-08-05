import type { LiveProviderState, RealtimeStatus, TurnMode, VoiceStatus } from "./types.ts";

export type QuestionAvailability = "stopped" | "connecting" | "ready" | "degraded";
export type MicrophoneRetirementResult = "none" | "retired" | "transport_failed";

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
): string | null {
  const availabilityText = questionCopyFor(availability).statusText;
  if (availabilityText) return availabilityText;
  return {
    off: null,
    listening: "Mic open — ask a question",
    user_speaking: "Listening to you…",
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
