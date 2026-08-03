import { z } from "zod";

const eventTypeSchema = z
  .string()
  .trim()
  .min(1)
  .max(80)
  .regex(
    /^[a-z0-9]+(?:_[a-z0-9]+)*$/,
    "eventType must use lowercase snake_case"
  );

const scoreSchema = z.number().finite().min(0).max(1);

export const eventCandidateSchema = z
  .object({
    eventType: eventTypeSchema,
    entities: z.array(z.string().trim().min(1).max(120)).max(20).default([]),
    description: z.string().trim().min(1).max(500),
    importance: scoreSchema,
    confidence: scoreSchema,
  })
  .strict();

export const eventRecordInputSchema = eventCandidateSchema.extend({
  sessionId: z.uuid(),
  timestampSeconds: z.number().finite().nonnegative(),
});

export function normalizeTimestampSeconds(value, fallback = 0) {
  const numericValue = Number(value);
  if (Number.isFinite(numericValue) && numericValue >= 0) {
    return Math.round(numericValue * 1000) / 1000;
  }

  const numericFallback = Number(fallback);
  if (Number.isFinite(numericFallback) && numericFallback >= 0) {
    return Math.round(numericFallback * 1000) / 1000;
  }

  return 0;
}

export function formatTimestamp(timestampSeconds) {
  const totalSeconds = Math.max(0, Math.floor(timestampSeconds));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  if (hours > 0) {
    return [hours, minutes, seconds]
      .map((part) => String(part).padStart(2, "0"))
      .join(":");
  }

  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

export function summarizeValidationError(error) {
  if (!(error instanceof z.ZodError)) return error.message;

  return error.issues
    .map((issue) => {
      const field = issue.path.length ? issue.path.join(".") : "event";
      return `${field}: ${issue.message}`;
    })
    .join("; ");
}
