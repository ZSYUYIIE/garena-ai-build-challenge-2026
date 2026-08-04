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
  "narration",
  "narration_update",
  "status",
  "status_text",
  "telemetry",
  "turn_complete",
  "turn_started",
  "user_transcript",
] as const);

type TextServerMessage = {
  type:
    | "analysis_error"
    | "answer"
    | "answer_update"
    | "error"
    | "narration"
    | "narration_update"
    | "status_text"
    | "telemetry"
    | "user_transcript";
  text?: string;
};

export type ServerMessage =
  | TextServerMessage
  | { type: "connected"; model?: string }
  | { type: "event"; event?: StreamEvent }
  | { type: "model_audio"; mimeType?: string; data?: string }
  | { type: "status"; mode?: string }
  | { type: "turn_started"; mode?: string }
  | {
      type: "turn_complete";
      mode?: string;
      text?: string;
      interrupted?: boolean;
      suppressed?: boolean;
    };
