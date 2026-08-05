import { z } from "zod";

const snakeCaseStateDomainSchema = z
  .string()
  .trim()
  .min(1)
  .max(80)
  .regex(
    /^[a-z0-9]+(?:_[a-z0-9]+)*$/,
    "domain must use lowercase snake_case",
  );

export const visibleStateSchema = z
  .object({
    domain: snakeCaseStateDomainSchema,
    identity: z.string().trim().min(1).max(160),
    value: z.string().trim().min(1).max(160),
    summary: z.string().trim().min(1).max(300),
  })
  .strict();

export const eventEvidenceSchema = z
  .object({
    basis: z.enum(["current_frame", "state_transition"]),
    previousState: visibleStateSchema.nullable(),
  })
  .strict()
  .superRefine((evidence, context) => {
    if (evidence.basis === "state_transition" && evidence.previousState === null) {
      context.addIssue({
        code: "custom",
        path: ["previousState"],
        message: "previousState is required for state_transition evidence",
      });
    }
    if (evidence.basis === "current_frame" && evidence.previousState !== null) {
      context.addIssue({
        code: "custom",
        path: ["previousState"],
        message: "previousState must be null for current_frame evidence",
      });
    }
  });

export function normalizeVisibleStateKey(state) {
  return `${normalizeVisibleStateText(state?.domain)}\u0000${normalizeVisibleStateText(state?.identity)}`;
}

function normalizeVisibleStateText(value) {
  return String(value ?? "")
    .trim()
    .replace(/\s+/gu, " ")
    .toLocaleLowerCase("en-US");
}

export class GroundedVisibleStateCache {
  constructor({ maxEntries = 8, maxAgeMs = 120_000 } = {}) {
    this.maxEntries = maxEntries;
    this.maxAgeMs = maxAgeMs;
    this.entries = new Map();
    this.latestObservedFrameSequence = 0;
  }

  list(nowMs) {
    this.prune(nowMs);
    return [...this.entries.values()].map(({ state }) => ({ ...state }));
  }

  findMatching(state, nowMs) {
    this.prune(nowMs);
    const entry = this.entries.get(normalizeVisibleStateKey(state));
    return entry ? { ...entry.state } : null;
  }

  update(state, observedAtMs, frameSequence) {
    const validated = visibleStateSchema.parse(state);
    this.prune(observedAtMs);
    if (frameSequence < this.latestObservedFrameSequence) return false;
    if (frameSequence > this.latestObservedFrameSequence) {
      this.latestObservedFrameSequence = frameSequence;
    }
    const key = normalizeVisibleStateKey(validated);
    const existing = this.entries.get(key);
    if (existing && frameSequence <= existing.frameSequence) return false;
    this.entries.delete(key);
    this.entries.set(key, {
      state: { ...validated },
      observedAtMs,
      frameSequence,
    });
    while (this.entries.size > this.maxEntries) {
      this.entries.delete(this.entries.keys().next().value);
    }
    return true;
  }

  observe(frameSequence) {
    if (!Number.isSafeInteger(frameSequence) || frameSequence < 0) {
      throw new RangeError("frameSequence must be a non-negative safe integer");
    }
    if (frameSequence <= this.latestObservedFrameSequence) return false;
    this.latestObservedFrameSequence = frameSequence;
    return true;
  }

  clear() {
    this.entries.clear();
    this.latestObservedFrameSequence = 0;
  }

  prune(nowMs) {
    for (const [key, entry] of this.entries) {
      if (nowMs - entry.observedAtMs > this.maxAgeMs) this.entries.delete(key);
    }
  }
}

export function validateEventEvidence(analysis, cache, nowMs) {
  const event = analysis?.event ?? null;
  const evidence = analysis?.eventEvidence ?? null;
  if ((event === null) !== (evidence === null)) {
    return invalid("event and eventEvidence must both be present or both be null");
  }

  const stateResult = analysis?.visibleState === null
    ? { success: true, data: null }
    : visibleStateSchema.safeParse(analysis?.visibleState);
  if (!stateResult.success) return invalid("visibleState is invalid");
  if (event === null) return { valid: true };

  const evidenceResult = eventEvidenceSchema.safeParse(evidence);
  if (!evidenceResult.success) return invalid("eventEvidence is invalid");
  const validatedEvidence = evidenceResult.data;
  if (validatedEvidence.basis === "current_frame") {
    if (event.eventType === "score_changed") {
      return invalid("score_changed requires state_transition evidence");
    }
    return { valid: true };
  }

  const currentState = stateResult.data;
  const previousState = validatedEvidence.previousState;
  if (!currentState || !previousState) {
    return invalid("state_transition requires current and previous state");
  }
  if (normalizeVisibleStateKey(currentState) !== normalizeVisibleStateKey(previousState)) {
    return invalid("current and previous state identities are incompatible");
  }
  if (normalizeVisibleStateText(currentState.value) === normalizeVisibleStateText(previousState.value)) {
    return invalid("state_transition values must differ");
  }
  const cachedPrevious = cache.findMatching(previousState, nowMs);
  if (!cachedPrevious) return invalid("previous state is not grounded in the active cache");
  if (
    normalizeVisibleStateText(cachedPrevious.value)
    !== normalizeVisibleStateText(previousState.value)
  ) {
    return invalid("previous state value does not match the grounded cache");
  }
  return { valid: true };
}

function invalid(reason) {
  return { valid: false, reason };
}
