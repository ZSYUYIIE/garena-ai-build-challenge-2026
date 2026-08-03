const DEFAULT_WINDOW_SECONDS = 12;
const DEFAULT_SIMILARITY_THRESHOLD = 0.78;

export function findDuplicateEvent(
  candidate,
  recentEvents,
  {
    windowSeconds = DEFAULT_WINDOW_SECONDS,
    similarityThreshold = DEFAULT_SIMILARITY_THRESHOLD,
  } = {}
) {
  for (const existing of recentEvents) {
    if (existing.eventType !== candidate.eventType) continue;

    const timeDelta = Math.abs(
      existing.timestampSeconds - candidate.timestampSeconds
    );
    if (timeDelta > windowSeconds) continue;

    const existingDescription = normalizeText(existing.description);
    const candidateDescription = normalizeText(candidate.description);
    if (existingDescription === candidateDescription) return existing;

    const similarity = jaccardSimilarity(
      tokenize(existingDescription),
      tokenize(candidateDescription)
    );
    if (similarity >= similarityThreshold) return existing;
  }

  return null;
}

export function normalizeText(value) {
  return String(value)
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function tokenize(value) {
  return new Set(value.split(" ").filter(Boolean));
}

function jaccardSimilarity(left, right) {
  if (!left.size && !right.size) return 1;

  let intersection = 0;
  for (const token of left) {
    if (right.has(token)) intersection += 1;
  }

  const union = new Set([...left, ...right]).size;
  return union ? intersection / union : 0;
}
