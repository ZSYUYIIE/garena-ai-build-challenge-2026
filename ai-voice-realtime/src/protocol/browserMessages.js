import { z } from "zod";

import {
  VOICE_NARRATION_MODES,
  VoiceNarrationMode,
} from "./voiceNarrationMode.js";

export const MAX_WEBSOCKET_PAYLOAD_BYTES = 2 * 1024 * 1024;
export const PROTOCOL_VERSION = 2;
const base64Pattern =
  /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/;

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
  "research_progress",
  "status",
  "status_text",
  "telemetry",
  "turn_complete",
  "turn_started",
  "user_transcript",
]);

const turnId = z.string().uuid();
const sessionId = z.string().uuid();
const turnMode = z.enum(["answer", "narration"]);
const providerState = z.enum(["connecting", "ready", "degraded", "closed"]);
const pcmMimeType = z.string().refine((value) => {
  const match = /^audio\/pcm;rate=([1-9][0-9]*)$/.exec(value);
  if (!match) return false;
  const sampleRate = Number(match[1]);
  return Number.isSafeInteger(sampleRate) && sampleRate >= 8_000 && sampleRate <= 48_000;
});
const serverEvent = z.object({
  id: z.string(),
  timestampSeconds: z.number().finite(),
  timestamp: z.string(),
  eventType: z.string(),
  entities: z.array(z.string()),
  description: z.string(),
  importance: z.number().finite(),
  confidence: z.number().finite(),
}).strict();

const serverOutputSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("analysis_error"), text: z.string().optional() }).strict(),
  z.object({
    type: z.literal("answer_update"), turnId, mode: z.literal("answer"),
    text: z.string(), finished: z.boolean(), languageCode: z.string().optional(),
  }).strict(),
  z.object({
    type: z.literal("connected"),
    protocolVersion: z.literal(2),
    sessionId,
    model: z.string().optional(),
  }).strict(),
  z.object({ type: z.literal("error"), text: z.string().optional() }).strict(),
  z.object({ type: z.literal("event"), event: serverEvent.optional() }).strict(),
  z.object({
    type: z.literal("research_progress"), turnId,
    stage: z.enum(["understand", "search", "review", "synthesize"]),
    status: z.enum(["active", "completed", "failed"]),
    detail: z.string().max(600).optional(),
  }).strict(),
  z.object({
    type: z.literal("narration_update"), turnId, mode: z.literal("narration"),
    text: z.string(), finished: z.boolean(), languageCode: z.string().optional(),
  }).strict(),
  z.object({
    type: z.literal("model_audio"), turnId, mode: turnMode,
    mimeType: pcmMimeType,
    data: z.string().min(1).regex(base64Pattern),
  }).strict(),
  z.object({ type: z.literal("playback_clear"), turnId, mode: turnMode, reason: z.string().optional() }).strict(),
  z.object({
    type: z.literal("provider_health"), provider: z.enum(["live", "tab_stt"]),
    state: providerState, message: z.string().optional(),
  }).strict(),
  z.object({ type: z.literal("status"), mode: z.string().optional() }).strict(),
  z.object({ type: z.literal("status_text"), text: z.string().optional() }).strict(),
  z.object({ type: z.literal("telemetry"), text: z.string().optional() }).strict(),
  z.object({
    type: z.literal("turn_complete"), turnId, mode: turnMode,
    interrupted: z.boolean().optional(), retryable: z.boolean(), text: z.string().optional(),
    suppressed: z.boolean().optional(),
  }).strict(),
  z.object({ type: z.literal("turn_started"), turnId, mode: turnMode }).strict(),
  z.object({
    type: z.literal("user_transcript"), turnId, mode: z.literal("answer"),
    text: z.string(), finished: z.boolean(), languageCode: z.string().optional(),
  }).strict(),
]);

export function parseServerOutput(value) {
  return serverOutputSchema.parse(value);
}

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
      researchMode: z.enum(["normal", "deep_research"]).default("normal"),
      voiceNarrationMode: z
        .enum(VOICE_NARRATION_MODES)
        .default(VoiceNarrationMode.SMART),
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
      type: z.literal("play_research_voice"),
      sourceTurnId: z.string().uuid(),
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
