import { isEditableShortcutTarget } from "./realtime/typedQuestion.ts";

export const VOICE_NARRATION_MODES = [
  "smart",
  "over_audio",
  "narration_only",
] as const;

export type VoiceNarrationMode = (typeof VOICE_NARRATION_MODES)[number];

export const DEFAULT_VOICE_NARRATION_MODE: VoiceNarrationMode = "smart";
export const VOICE_NARRATION_STORAGE_KEY =
  "streamsense.voiceNarrationMode.v1";

export const VOICE_NARRATION_MODE_LABELS: Record<
  VoiceNarrationMode,
  string
> = {
  smart: "Smart narration",
  over_audio: "Narrate over audio",
  narration_only: "Narration only",
};

type ReadStorage = Pick<Storage, "getItem">;
type WriteStorage = Pick<Storage, "setItem">;

export type VoiceNarrationShortcutEvent = Pick<
  KeyboardEvent,
  "altKey" | "ctrlKey" | "metaKey" | "shiftKey" | "code" | "repeat"
>;

export function isVoiceNarrationMode(
  value: unknown,
): value is VoiceNarrationMode {
  return typeof value === "string"
    && VOICE_NARRATION_MODES.includes(value as VoiceNarrationMode);
}

export function readVoiceNarrationMode(
  storage: ReadStorage = window.localStorage,
): VoiceNarrationMode {
  try {
    const stored = storage.getItem(VOICE_NARRATION_STORAGE_KEY);
    return isVoiceNarrationMode(stored)
      ? stored
      : DEFAULT_VOICE_NARRATION_MODE;
  } catch {
    return DEFAULT_VOICE_NARRATION_MODE;
  }
}

export function writeVoiceNarrationMode(
  mode: VoiceNarrationMode,
  storage: WriteStorage = window.localStorage,
): boolean {
  try {
    storage.setItem(VOICE_NARRATION_STORAGE_KEY, mode);
    return true;
  } catch {
    return false;
  }
}

export function nextVoiceNarrationMode(
  mode: VoiceNarrationMode,
): VoiceNarrationMode {
  const currentIndex = VOICE_NARRATION_MODES.indexOf(mode);
  return VOICE_NARRATION_MODES[
    (currentIndex + 1) % VOICE_NARRATION_MODES.length
  ];
}

export function isVoiceNarrationShortcut(
  event: VoiceNarrationShortcutEvent,
): boolean {
  return !event.altKey
    && !event.ctrlKey
    && !event.metaKey
    && !event.shiftKey
    && !event.repeat
    && event.code === "KeyN";
}

export function voiceNarrationModeAfterShortcut(
  currentMode: VoiceNarrationMode,
  event: VoiceNarrationShortcutEvent,
  target: EventTarget | null,
): VoiceNarrationMode | null {
  if (
    !isVoiceNarrationShortcut(event)
    || isEditableShortcutTarget(target)
  ) {
    return null;
  }
  return nextVoiceNarrationMode(currentMode);
}
