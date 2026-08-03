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

export type ServerMessage = {
  type: string;
  text?: string;
  mode?: string;
  model?: string;
  mimeType?: string;
  data?: string;
  event?: StreamEvent;
};
