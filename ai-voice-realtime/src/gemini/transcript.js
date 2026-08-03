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

function longestOverlap(left, right) {
  const limit = Math.min(left.length, right.length);
  for (let size = limit; size > 0; size -= 1) {
    if (left.slice(-size) === right.slice(0, size)) return size;
  }
  return 0;
}
