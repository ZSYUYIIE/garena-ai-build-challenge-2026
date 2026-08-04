export type RealtimeStatus =
  | "idle"
  | "requesting_capture"
  | "connecting"
  | "connected"
  | "error";

export type StreamEvent = {
  id: string;
  timestampSeconds: number;
  timestamp: string;
  eventType: string;
  entities: string[];
  description: string;
  importance: number;
  confidence: number;
};

export type RealtimeChatMessage = {
  id: string;
  role: "user" | "assistant";
  text: string;
};

export const SUPPORTED_SERVER_MESSAGE_TYPES = Object.freeze([
  "analysis_error",
  "answer",
  "answer_update",
  "connected",
  "error",
  "event",
  "model_audio",
  "playback_clear",
  "provider_health",
  "narration",
  "narration_update",
  "status",
  "status_text",
  "telemetry",
  "turn_complete",
  "turn_started",
  "user_transcript",
] as const);

export type TurnMode = "answer" | "narration";

type TextServerMessage = {
  type:
    | "analysis_error"
    | "answer"
    | "error"
    | "narration"
    | "status_text"
    | "telemetry";
  text?: string;
};

type TurnTextServerMessage = {
  type: "narration_update";
  turnId: string;
  mode: TurnMode;
  text: string;
};

type TranscriptServerMessage = {
  type: "user_transcript" | "answer_update";
  turnId: string;
  mode: TurnMode;
  text: string;
  finished: boolean;
  languageCode?: string;
};

export type ServerMessage =
  | TextServerMessage
  | TurnTextServerMessage
  | TranscriptServerMessage
  | { type: "connected"; protocolVersion: 2; model?: string }
  | { type: "event"; event?: StreamEvent }
  | {
      type: "model_audio";
      turnId: string;
      mode: TurnMode;
      mimeType: string;
      data: string;
    }
  | { type: "playback_clear"; turnId: string; mode: TurnMode; reason?: string }
  | {
      type: "provider_health";
      provider: "live" | "tab_stt";
      state: "connecting" | "ready" | "degraded" | "closed";
      message?: string;
    }
  | { type: "status"; mode?: string }
  | { type: "turn_started"; turnId: string; mode: TurnMode }
  | {
      type: "turn_complete";
      turnId: string;
      mode: TurnMode;
      text?: string;
      interrupted?: boolean;
      suppressed?: boolean;
    };

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const BASE64_PATTERN =
  /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/;
const PCM_MIME_PATTERN = /^audio\/pcm;rate=([1-9][0-9]*)$/;

function invalidServerMessage(): never {
  throw new Error("Invalid server message.");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function requireExactKeys(
  value: Record<string, unknown>,
  required: readonly string[],
  optional: readonly string[] = [],
): void {
  const allowed = new Set([...required, ...optional]);
  if (
    required.some((key) => !(key in value)) ||
    Object.keys(value).some((key) => !allowed.has(key))
  ) {
    invalidServerMessage();
  }
}

function requireString(value: unknown): string {
  if (typeof value !== "string") invalidServerMessage();
  return value;
}

function requireTurn(value: Record<string, unknown>): void {
  if (!UUID_PATTERN.test(requireString(value.turnId))) invalidServerMessage();
  if (value.mode !== "answer" && value.mode !== "narration") invalidServerMessage();
}

function requireOptionalString(value: unknown): void {
  if (value !== undefined && typeof value !== "string") invalidServerMessage();
}

function requireOptionalBoolean(value: unknown): void {
  if (value !== undefined && typeof value !== "boolean") invalidServerMessage();
}

function requireEvent(value: unknown): void {
  if (!isRecord(value)) invalidServerMessage();
  requireExactKeys(value, [
    "id",
    "timestampSeconds",
    "timestamp",
    "eventType",
    "entities",
    "description",
    "importance",
    "confidence",
  ]);
  requireString(value.id);
  requireString(value.timestamp);
  requireString(value.eventType);
  requireString(value.description);
  if (
    typeof value.timestampSeconds !== "number" ||
    !Number.isFinite(value.timestampSeconds) ||
    typeof value.importance !== "number" ||
    !Number.isFinite(value.importance) ||
    typeof value.confidence !== "number" ||
    !Number.isFinite(value.confidence) ||
    !Array.isArray(value.entities) ||
    value.entities.some((entity) => typeof entity !== "string")
  ) {
    invalidServerMessage();
  }
}

function requirePcmMimeType(value: unknown): void {
  const match = PCM_MIME_PATTERN.exec(requireString(value));
  if (!match) invalidServerMessage();
  const sampleRate = Number(match[1]);
  if (!Number.isSafeInteger(sampleRate) || sampleRate < 8_000 || sampleRate > 48_000) {
    invalidServerMessage();
  }
}

export function parseServerMessage(rawText: string): ServerMessage {
  let value: unknown;
  try {
    value = JSON.parse(rawText);
  } catch {
    return invalidServerMessage();
  }
  if (!isRecord(value) || typeof value.type !== "string") return invalidServerMessage();

  switch (value.type) {
    case "analysis_error":
    case "answer":
    case "error":
    case "narration":
    case "status_text":
    case "telemetry":
      requireExactKeys(value, ["type"], ["text"]);
      requireOptionalString(value.text);
      return value as ServerMessage;
    case "connected":
      requireExactKeys(value, ["type", "protocolVersion"], ["model"]);
      if (value.protocolVersion !== 2) invalidServerMessage();
      requireOptionalString(value.model);
      return value as ServerMessage;
    case "event":
      requireExactKeys(value, ["type"], ["event"]);
      if (value.event !== undefined) requireEvent(value.event);
      return value as ServerMessage;
    case "status":
      requireExactKeys(value, ["type"], ["mode"]);
      requireOptionalString(value.mode);
      return value as ServerMessage;
    case "turn_started":
      requireExactKeys(value, ["type", "turnId", "mode"]);
      requireTurn(value);
      return value as ServerMessage;
    case "user_transcript":
    case "answer_update":
      requireExactKeys(value, ["type", "turnId", "mode", "text", "finished"], ["languageCode"]);
      requireTurn(value);
      requireString(value.text);
      if (typeof value.finished !== "boolean") invalidServerMessage();
      requireOptionalString(value.languageCode);
      return value as ServerMessage;
    case "narration_update":
      requireExactKeys(value, ["type", "turnId", "mode", "text"]);
      requireTurn(value);
      requireString(value.text);
      return value as ServerMessage;
    case "model_audio":
      requireExactKeys(value, ["type", "turnId", "mode", "mimeType", "data"]);
      requireTurn(value);
      requirePcmMimeType(value.mimeType);
      const data = requireString(value.data);
      if (!BASE64_PATTERN.test(data) || data.length === 0) {
        invalidServerMessage();
      }
      return value as ServerMessage;
    case "playback_clear":
      requireExactKeys(value, ["type", "turnId", "mode"], ["reason"]);
      requireTurn(value);
      requireOptionalString(value.reason);
      return value as ServerMessage;
    case "turn_complete":
      requireExactKeys(value, ["type", "turnId", "mode"], ["text", "interrupted", "suppressed"]);
      requireTurn(value);
      requireOptionalString(value.text);
      requireOptionalBoolean(value.interrupted);
      requireOptionalBoolean(value.suppressed);
      return value as ServerMessage;
    case "provider_health":
      requireExactKeys(value, ["type", "provider", "state"], ["message"]);
      if (value.provider !== "live" && value.provider !== "tab_stt") invalidServerMessage();
      if (!(["connecting", "ready", "degraded", "closed"] as const).includes(value.state as never)) {
        invalidServerMessage();
      }
      requireOptionalString(value.message);
      return value as ServerMessage;
    default:
      return invalidServerMessage();
  }
}
