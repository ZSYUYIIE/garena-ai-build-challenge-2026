import { z } from "zod";

export const MAX_WEBSOCKET_PAYLOAD_BYTES = 2 * 1024 * 1024;
export const PROTOCOL_VERSION = 2;

export const SERVER_MESSAGE_TYPES = Object.freeze([
  "analysis_error",
  "answer_update",
  "connected",
  "error",
  "event",
  "narration_update",
  "model_audio",
  "playback_clear",
  "provider_health",
  "status",
  "status_text",
  "telemetry",
  "turn_complete",
  "turn_started",
  "user_transcript",
]);

const base64Pattern =
  /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/;

const tabAudioState = z.enum(["absent", "captured", "degraded"]);
const microphoneState = z.enum(["pending", "ready", "denied", "degraded"]);

const browserMessageSchema = z.discriminatedUnion("type", [
  z
    .object({
      type: z.literal("capture_source"),
      source: z.enum(["camera", "screen"]),
    })
    .strict(),
  z
    .object({
      type: z.literal("video_frame"),
      timestampSeconds: z.number().finite().nonnegative(),
      mimeType: z.literal("image/jpeg"),
      data: z
        .string()
        .min(1)
        .max(MAX_WEBSOCKET_PAYLOAD_BYTES)
        .regex(base64Pattern),
    })
    .strict(),
  z
    .object({
      type: z.literal("session_config"),
      narrationLevel: z.enum([
        "minimal",
        "standard",
        "detailed",
        "question_only",
      ]),
    })
    .strict(),
  z
    .object({
      type: z.literal("typed_question"),
      text: z.string().trim().min(1).max(500),
      turnId: z.string().uuid(),
    })
    .strict(),
  z
    .object({
      type: z.literal("session_hello"),
      protocolVersion: z.literal(PROTOCOL_VERSION),
      tabAudioState,
      microphoneState,
    })
    .strict(),
  z.object({ type: z.literal("media_state"), tabAudioState, microphoneState }).strict(),
  z.object({ type: z.literal("tab_audio_activity"), active: z.boolean() }).strict(),
  z
    .object({
      type: z.literal("tab_audio_discontinuity"),
      timestampMs: z.number().int().nonnegative().max(0xffff_ffff),
      reason: z.enum(["websocket_backpressure", "capture_gap", "track_ended"]),
    })
    .strict(),
  z.object({ type: z.literal("user_activity_start"), turnId: z.string().uuid() }).strict(),
  z.object({ type: z.literal("user_activity_end"), turnId: z.string().uuid() }).strict(),
]);

export class BrowserMessageError extends Error {
  constructor(cause) {
    super("Invalid browser message.", { cause });
    this.name = "BrowserMessageError";
  }
}

export function parseBrowserMessage(rawText) {
  let value;
  try {
    value = JSON.parse(rawText);
  } catch (error) {
    throw new BrowserMessageError(error);
  }

  const result = browserMessageSchema.safeParse(value);
  if (!result.success) {
    throw new BrowserMessageError(result.error);
  }
  return result.data;
}
