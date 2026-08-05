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

export type VoiceStatus =
  | "off"
  | "listening"
  | "user_speaking"
  | "gemini_speaking"
  | "degraded";

export type VoiceStatusState = {
  sessionActive: boolean;
  microphoneState: "pending" | "ready" | "denied" | "degraded";
  helloAccepted: boolean;
  liveReady: boolean;
  liveDegraded: boolean;
  userSpeaking: boolean;
  geminiSpeaking: boolean;
};

export type TransportKind = "frame" | "tab" | "microphone";
export type BackpressureAction =
  | "send"
  | "replace_latest_frame"
  | "tab_discontinuity"
  | "fail_microphone_turn";

export function backpressureAction(
  kind: TransportKind,
  bufferedAmount: number,
): BackpressureAction {
  if (kind === "frame") {
    return bufferedAmount >= 128 * 1024 ? "replace_latest_frame" : "send";
  }
  if (kind === "tab") {
    return bufferedAmount >= 32 * 1024 ? "tab_discontinuity" : "send";
  }
  return bufferedAmount >= 32 * 1024 ? "fail_microphone_turn" : "send";
}

export function voiceStatusForState(state: VoiceStatusState): VoiceStatus {
  if (!state.sessionActive) return "off";
  if (
    state.microphoneState === "denied" ||
    state.microphoneState === "degraded" ||
    state.liveDegraded
  ) {
    return "degraded";
  }
  if (
    state.microphoneState !== "ready" ||
    !state.helloAccepted ||
    !state.liveReady
  ) {
    return "off";
  }
  if (state.userSpeaking) return "user_speaking";
  if (state.geminiSpeaking) return "gemini_speaking";
  return "listening";
}

export type TurnRoleState = {
  turnId: string;
  userFinished: boolean;
  assistantFinished: boolean;
};

export function createTurnRoleState(
  turnId: string,
  finished: Partial<Pick<TurnRoleState, "userFinished" | "assistantFinished">> = {},
): TurnRoleState {
  return {
    turnId,
    userFinished: finished.userFinished ?? false,
    assistantFinished: finished.assistantFinished ?? false,
  };
}

export function canAcceptTurnRoleUpdate(
  turnId: string,
  role: RealtimeChatMessage["role"],
  activeTurn: TurnRoleState | null,
  settlingTurn: TurnRoleState | null,
): boolean {
  const turn = activeTurn?.turnId === turnId
    ? activeTurn
    : settlingTurn?.turnId === turnId
      ? settlingTurn
      : null;
  if (!turn) return false;
  return role === "user" ? !turn.userFinished : !turn.assistantFinished;
}

export function finishTurnRole(
  turn: TurnRoleState,
  role: RealtimeChatMessage["role"],
): TurnRoleState {
  return role === "user"
    ? { ...turn, userFinished: true }
    : { ...turn, assistantFinished: true };
}

export function settlingTurnAfterComplete(
  turn: TurnRoleState | null,
  turnId: string,
): TurnRoleState | null {
  if (!turn || turn.turnId !== turnId) return null;
  return turn.userFinished && turn.assistantFinished ? null : turn;
}

export function speakingTurnAfterPlaybackIdle(
  speakingTurnId: string | null,
  idleTurnId: string,
): string | null {
  return speakingTurnId === idleTurnId ? null : speakingTurnId;
}

export function descriptionAfterTurnComplete(
  currentDescription: string,
  mode: TurnMode,
  interrupted: boolean,
): string {
  return mode === "narration" && interrupted ? "" : currentDescription;
}

export function updateTurnChatMessages(
  messages: RealtimeChatMessage[],
  update: {
    turnId: string;
    role: RealtimeChatMessage["role"];
    text: string;
    finished: boolean;
  },
): RealtimeChatMessage[] {
  const text = update.text.trim();
  if (!text) return messages;
  const id = `${update.turnId}:${update.role}`;
  const existing = messages.find((message) => message.id === id);
  if (!existing) return [...messages, { id, role: update.role, text }];
  const joined = /^[,.;:!?)]/.test(text) || /[(]$/.test(existing.text)
    ? `${existing.text}${text}`
    : `${existing.text} ${text}`;
  return messages.map((message) =>
    message.id === id ? { ...message, text: joined } : message,
  );
}

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
export type LiveProviderState = "connecting" | "ready" | "degraded" | "closed";

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
  mode: "narration";
  text: string;
  finished: boolean;
  languageCode?: string;
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
      state: LiveProviderState;
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
      retryable: boolean;
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
      if (value.mode !== "answer") invalidServerMessage();
      requireString(value.text);
      if (typeof value.finished !== "boolean") invalidServerMessage();
      requireOptionalString(value.languageCode);
      return value as ServerMessage;
    case "narration_update":
      requireExactKeys(value, ["type", "turnId", "mode", "text", "finished"], ["languageCode"]);
      requireTurn(value);
      if (value.mode !== "narration" || typeof value.finished !== "boolean") invalidServerMessage();
      requireString(value.text);
      requireOptionalString(value.languageCode);
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
      requireExactKeys(value, ["type", "turnId", "mode", "retryable"], ["text", "interrupted", "suppressed"]);
      requireTurn(value);
      requireOptionalString(value.text);
      requireOptionalBoolean(value.interrupted);
      if (typeof value.retryable !== "boolean") invalidServerMessage();
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
