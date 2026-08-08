export const historyQueryKeys = {
  sessions: (cursor: string | null) => ["history", "sessions", cursor] as const,
  session: (sessionId: string) => ["history", "session", sessionId] as const,
  events: (sessionId: string, cursor: string | null, eventId: string | null) =>
    ["history", "session", sessionId, "events", cursor, eventId] as const,
  graph: (filters: Record<string, string | number | undefined>) =>
    ["history", "context-graph", filters] as const,
};
