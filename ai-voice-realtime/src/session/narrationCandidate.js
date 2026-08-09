import {
  isVoiceNarrationMode,
  VoiceNarrationMode,
} from "../protocol/voiceNarrationMode.js";

const MAX_SEMANTIC_KEY_LENGTH = 160;

export function buildModeNarrationCandidate({
  voiceNarrationMode,
  narrationLevel,
  offerCandidate,
  persistenceStatus,
  recordedEvent,
  analysis,
  createdAtMs,
}) {
  if (
    !isVoiceNarrationMode(voiceNarrationMode)
    || narrationLevel === "question_only"
    || !offerCandidate
    || persistenceStatus !== "recorded"
    || !recordedEvent
    || typeof recordedEvent.description !== "string"
    || !recordedEvent.description.trim()
    || !Number.isFinite(createdAtMs)
    || createdAtMs < 0
  ) {
    return null;
  }

  const smartEligible = isSmartEligible(analysis);
  if (voiceNarrationMode === VoiceNarrationMode.SMART) {
    if (!smartEligible) return null;
    return {
      description: analysis.description.trim(),
      semanticKey: analysis.semanticKey.trim(),
      importance: analysis.importance,
      createdAtMs,
      smartEligible: true,
    };
  }

  return {
    description: recordedEvent.description.trim(),
    semanticKey: atomicSemanticKey(analysis) ?? eventSemanticKey(recordedEvent),
    importance: recordedEvent.importance,
    createdAtMs,
    smartEligible,
  };
}

function atomicSemanticKey(analysis) {
  if (
    typeof analysis?.semanticKey !== "string"
    || !analysis.semanticKey.trim()
  ) {
    return null;
  }
  return analysis.semanticKey.trim().slice(0, MAX_SEMANTIC_KEY_LENGTH);
}

function isSmartEligible(analysis) {
  return Boolean(
    analysis
    && analysis.shouldNarrate
    && analysis.isNew
    && !analysis.coveredByTabSpeech
    && Number.isFinite(analysis.importance)
    && analysis.importance >= 0.6
    && typeof analysis.description === "string"
    && analysis.description.trim()
    && typeof analysis.semanticKey === "string"
    && analysis.semanticKey.trim(),
  );
}

function eventSemanticKey(event) {
  const eventType = typeof event.eventType === "string"
    ? event.eventType.trim()
    : "event";
  const descriptionKey = event.description
    .normalize("NFKC")
    .toLocaleLowerCase("en-US")
    .match(/[\p{L}\p{N}]+/gu)
    ?.join("-") ?? "event";
  return `${eventType}:${descriptionKey}`.slice(0, MAX_SEMANTIC_KEY_LENGTH);
}
