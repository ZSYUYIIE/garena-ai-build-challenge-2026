export function mergeTranscriptChunk(current, incoming) {
  const left = String(current || "").trim();
  const right = String(incoming || "").trim();

  if (!left) return right;
  if (!right || left === right || left.endsWith(right)) return left;
  if (right.startsWith(left)) return right;

  const overlap = longestOverlap(left, right);
  if (overlap > 0) {
    return `${left}${right.slice(overlap)}`;
  }

  if (/^[,.;:!?)]/.test(right) || /[(]$/.test(left)) {
    return `${left}${right}`;
  }
  return `${left} ${right}`;
}

export function buildNarrationEventCandidate(description, { initial = false } = {}) {
  return {
    eventType: initial ? "scene_observed" : "visual_change",
    entities: [],
    description: String(description).trim(),
    importance: initial ? 0.35 : 0.5,
    confidence: 0.7,
  };
}

export function shouldSuppressVisualDescription(description) {
  const text = String(description || "").trim();
  if (!text) return false;

  const describesOwnInterface =
    /\bstreamsense\b/i.test(text) ||
    /\b(narration level|now describing|ask about this video)\b/i.test(text);
  const infersUserInteraction =
    /\b(?:the\s+)?(?:user|someone|they)\s+(?:has\s+)?(?:opened|clicked|selected|scrolled|typed|navigated|switched|pressed)\b/i.test(
      text
    );

  return describesOwnInterface || infersUserInteraction;
}

export function isDescriptionCoveredByTranscript(description, transcript) {
  const descriptionTokens = significantTokens(description);
  if (descriptionTokens.length < 2) return false;
  const transcriptTokens = new Set(significantTokens(transcript));
  if (transcriptTokens.size < 2) return false;
  const covered = descriptionTokens.filter((token) => transcriptTokens.has(token));
  return covered.length >= 2 && covered.length / descriptionTokens.length >= 0.6;
}

const TRANSCRIPT_STOP_WORDS = new Set([
  "about", "after", "again", "also", "been", "before", "being", "from",
  "have", "into", "near", "only", "over", "that", "their", "there",
  "these", "they", "this", "through", "under", "very", "while", "with",
]);

function significantTokens(value) {
  return String(value ?? "")
    .toLocaleLowerCase("en-US")
    .match(/[\p{L}\p{N}]+/gu)
    ?.filter((token) => token.length >= 3 && !TRANSCRIPT_STOP_WORDS.has(token))
    ?? [];
}

function longestOverlap(left, right) {
  const limit = Math.min(left.length, right.length);
  for (let size = limit; size > 0; size -= 1) {
    if (left.slice(-size) === right.slice(0, size)) return size;
  }
  return 0;
}
