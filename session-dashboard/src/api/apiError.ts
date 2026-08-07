export class HistoryApiError extends Error {
  readonly code: string;
  readonly status: number;

  constructor(message: string, { code, status }: { code: string; status: number }) {
    super(message);
    this.name = "HistoryApiError";
    this.code = code;
    this.status = status;
  }
}

export function isUnavailableError(error: unknown): boolean {
  if (!(error instanceof HistoryApiError)) return false;

  return (
    error.status === 503 ||
    error.code === "search_unavailable" ||
    error.code === "semantic_search_unavailable" ||
    error.code === "context_graph_unavailable" ||
    error.code === "history_unavailable"
  );
}

export function errorMessage(error: unknown): string {
  if (error instanceof Error && error.message.trim()) return error.message;
  return "The history service returned an unexpected error.";
}
