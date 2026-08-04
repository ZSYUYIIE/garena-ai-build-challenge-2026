const CONTEXT_SOURCE = "captured_tab_audio_transcript";
const DEFAULT_MAX_AGE_MS = 120_000;
const DEFAULT_MAX_CHARACTERS = 12_000;
const DEFAULT_LOOKBACK_MS = 45_000;
const DEFAULT_RESULT_MAX_CHARACTERS = 4_000;
const LANGUAGE_CODE = /^[A-Za-z0-9]{1,8}(?:-[A-Za-z0-9]{1,8})*$/;

function validateNonNegativeFinite(value, name) {
  if (!Number.isFinite(value) || value < 0) {
    throw new TypeError(`${name} must be a finite nonnegative number`);
  }
}

function validateCharacterCap(value, name) {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new TypeError(`${name} must be a nonnegative safe integer`);
  }
}

// JavaScript string.length counts UTF-16 code units. We deliberately count
// Unicode code points instead, so cap trimming cannot split a surrogate pair.
function characters(text) {
  return Array.from(text);
}

function characterCount(text) {
  return characters(text).length;
}

function keepTail(text, maximumCharacters) {
  if (maximumCharacters === 0) return "";
  const codePoints = characters(text);
  return codePoints.length <= maximumCharacters
    ? text
    : codePoints.slice(-maximumCharacters).join("");
}

function copySegment(segment) {
  return {
    startMs: segment.startMs,
    endMs: segment.endMs,
    text: segment.text,
    languageCode: segment.languageCode,
  };
}

export class TabTranscriptBuffer {
  #maxAgeMs;
  #maxCharacters;
  #nowBackendSessionMs;
  #lastNowMs = null;
  #segments = [];

  constructor({
    maxAgeMs = DEFAULT_MAX_AGE_MS,
    maxCharacters = DEFAULT_MAX_CHARACTERS,
    nowBackendSessionMs,
  } = {}) {
    validateNonNegativeFinite(maxAgeMs, "maxAgeMs");
    validateCharacterCap(maxCharacters, "maxCharacters");
    if (typeof nowBackendSessionMs !== "function") {
      throw new TypeError("nowBackendSessionMs must be a function");
    }

    this.#maxAgeMs = maxAgeMs;
    this.#maxCharacters = maxCharacters;
    this.#nowBackendSessionMs = nowBackendSessionMs;
    this.#readNow();
  }

  get size() {
    return this.#segments.length;
  }

  appendFinal({ startMs, endMs, text, languageCode } = {}) {
    const nowMs = this.#readNow();
    this.#evict(nowMs);

    validateNonNegativeFinite(startMs, "startMs");
    validateNonNegativeFinite(endMs, "endMs");
    if (startMs > endMs) {
      throw new TypeError("invalid final segment timestamps");
    }
    if (typeof text !== "string") {
      throw new TypeError("invalid final segment text");
    }
    const normalizedText = text.trim().replace(/\s+/gu, " ");
    if (normalizedText.length === 0) {
      throw new TypeError("invalid final segment text");
    }
    if (typeof languageCode !== "string" || !LANGUAGE_CODE.test(languageCode)) {
      throw new TypeError("invalid final segment languageCode");
    }

    const candidate = { startMs, endMs, text: normalizedText, languageCode };
    const duplicate = this.#segments.some((existing) => (
      existing.text === candidate.text
      && existing.startMs <= candidate.endMs
      && candidate.startMs <= existing.endMs
    ));

    if (!duplicate) {
      this.#segments.push(candidate);
      this.#segments.sort((left, right) => left.startMs - right.startMs || left.endMs - right.endMs);
      this.#evict(nowMs);
    }
  }

  getRecent({
    lookbackMs = DEFAULT_LOOKBACK_MS,
    maxCharacters = DEFAULT_RESULT_MAX_CHARACTERS,
  } = {}) {
    validateNonNegativeFinite(lookbackMs, "lookbackMs");
    validateCharacterCap(maxCharacters, "maxCharacters");

    const nowMs = this.#readNow();
    this.#evict(nowMs);
    const earliestEndMs = nowMs - lookbackMs;
    const recent = this.#segments.filter((segment) => segment.endMs >= earliestEndMs);

    let remainingCharacters = maxCharacters;
    const selected = [];
    for (let index = recent.length - 1; index >= 0 && remainingCharacters > 0; index -= 1) {
      const item = recent[index];
      const count = characterCount(item.text);
      if (count <= remainingCharacters) {
        selected.unshift(copySegment(item));
        remainingCharacters -= count;
      } else {
        selected.unshift({ ...copySegment(item), text: keepTail(item.text, remainingCharacters) });
        remainingCharacters = 0;
      }
    }

    return {
      source: CONTEXT_SOURCE,
      representsUserSpeech: false,
      segments: selected,
    };
  }

  clear() {
    this.#segments = [];
  }

  #readNow() {
    const nowMs = this.#nowBackendSessionMs();
    validateNonNegativeFinite(nowMs, "nowBackendSessionMs result");
    if (this.#lastNowMs !== null && nowMs < this.#lastNowMs) {
      throw new RangeError("nowBackendSessionMs must be monotonic");
    }
    this.#lastNowMs = nowMs;
    return nowMs;
  }

  #evict(nowMs) {
    const oldestEndMs = nowMs - this.#maxAgeMs;
    this.#segments = this.#segments.filter((segment) => segment.endMs >= oldestEndMs);

    let totalCharacters = this.#segments.reduce(
      (total, segment) => total + characterCount(segment.text),
      0,
    );
    while (totalCharacters > this.#maxCharacters && this.#segments.length > 0) {
      const oldest = this.#segments[0];
      const overflow = totalCharacters - this.#maxCharacters;
      const oldestCharacters = characterCount(oldest.text);
      if (oldestCharacters <= overflow) {
        this.#segments.shift();
        totalCharacters -= oldestCharacters;
      } else {
        oldest.text = keepTail(oldest.text, oldestCharacters - overflow);
        totalCharacters = this.#maxCharacters;
      }
    }
  }
}
