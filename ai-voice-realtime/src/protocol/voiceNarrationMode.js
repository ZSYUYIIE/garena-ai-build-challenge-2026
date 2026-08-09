export const VoiceNarrationMode = Object.freeze({
  SMART: "smart",
  OVER_AUDIO: "over_audio",
  NARRATION_ONLY: "narration_only",
});

export const VOICE_NARRATION_MODES = Object.freeze(
  Object.values(VoiceNarrationMode),
);

export function isVoiceNarrationMode(value) {
  return VOICE_NARRATION_MODES.includes(value);
}
