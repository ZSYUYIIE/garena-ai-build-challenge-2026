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
  const describesOnlyMediaWrapper = isWrapperOnlyVisualDescription(text);

  return describesOwnInterface || infersUserInteraction || describesOnlyMediaWrapper;
}

const SIMPLE_WRAPPER_PATTERN =
  /^(?:(?:a|the)\s+)?(?:video|livestream|stream)(?:\s+page)?\s+(?:is\s+)?(?:displayed|shown|open)(?:\s+full-?screen)?[.!]?$/iu;

const PAGE_WITH_TITLE_PATTERNS = [
  /^(?:(?:a|the)\s+)?(?:youtube|twitch|vimeo)\s+(?:video\s+)?page\s+(?:is\s+)?(?:displayed|shown|open)(?:(?:,\s*|\s+)(?:featuring|with)\s+(?:a\s+)?(?:video|livestream|stream)(?:\s+of\s+(?<subject>.+?))?\s+(?:titled|called)\s+(?<title>.+?))?[.!]?$/iu,
  /^(?:(?:a|the)\s+)?(?:youtube|twitch|vimeo)\s+(?:video\s+)?page\s+(?:is\s+)?(?:displayed|shown|open)(?:,\s*|\s+)(?:featuring|with)\s+(?:a\s+)?(?<subject>.+?)\s+video\s+(?:titled|called)\s+(?<title>.+?)[.!]?$/iu,
  /^(?:(?:a|the)\s+)?(?:browser(?:\s+page)?|web\s?page|video\s?page|media\s?player)\s+(?:is\s+)?(?:displayed|shown|open)(?:(?:,\s*|\s+)(?:featuring|with)\s+(?:a\s+)?(?:video|livestream|stream)(?:\s+of\s+(?<subject>.+?))?\s+(?:titled|called)\s+(?<title>.+?))?[.!]?$/iu,
];

const TITLED_WRAPPER_PATTERN =
  /^(?:the\s+)?(?:video|livestream|stream)(?:\s+page)?\s+(?:is\s+)?(?:titled|called)\s+(?<title>.+?)\s+and\s+(?:is\s+)?(?:displayed|shown|open)(?:\s+(?:in|on)\s+(?:a|the)?\s*(?:media\s?player|video\s?page|browser\s?page))?[.!]?$/iu;

const INTERNAL_PROSE_PUNCTUATION = /[.!?;,:]|[\r\n]/u;
const TITLE_CONNECTORS = new Set([
  "a",
  "an",
  "and",
  "at",
  "for",
  "from",
  "in",
  "of",
  "on",
  "the",
  "to",
  "vs",
  "with",
]);

function isWrapperOnlyVisualDescription(text) {
  if (SIMPLE_WRAPPER_PATTERN.test(text)) return true;

  for (const pattern of PAGE_WITH_TITLE_PATTERNS) {
    const match = text.match(pattern);
    if (!match) continue;
    const subject = match.groups?.subject;
    const title = match.groups?.title;
    if (
      (!subject || isMetadataNounPhrase(subject)) &&
      (!title || isBoundedMetadataValue(title))
    ) {
      return true;
    }
  }

  const titled = text.match(TITLED_WRAPPER_PATTERN);
  return Boolean(
    titled?.groups?.title && isBoundedMetadataValue(titled.groups.title),
  );
}

function isBoundedMetadataValue(value) {
  const text = value.trim();
  const quoted = /^(?:"[^"]{1,160}"|'[^']{1,160}'|“[^”]{1,160}”)$/u.test(
    text,
  );
  if (quoted) return true;
  if (INTERNAL_PROSE_PUNCTUATION.test(text)) return false;
  const words = text.split(/\s+/u);
  return (
    words.length <= 12 &&
    words.every((word) => {
      const normalized = word.toLocaleLowerCase("en-US");
      return (
        TITLE_CONNECTORS.has(normalized) ||
        /^[\p{Lu}\p{N}][\p{L}\p{N}'’&+\-]*$/u.test(word)
      );
    })
  );
}

function isMetadataNounPhrase(value) {
  const text = value.trim();
  const words = text.split(/\s+/u);
  return (
    words.length <= 6 &&
    !INTERNAL_PROSE_PUNCTUATION.test(text) &&
    !/\b(?:as|while|where|who|which|that|because|showing)\b/iu.test(text) &&
    words.every((word) => !/(?:ing|ed)$/iu.test(word))
  );
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
