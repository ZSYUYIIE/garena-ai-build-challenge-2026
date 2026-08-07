import type { ZodType } from "zod";

import { HistoryApiError } from "./apiError";
import {
  contextGraphResponseSchema,
  errorResponseSchema,
  searchRequestSchema,
  searchResponseSchema,
  sessionDetailResponseSchema,
  sessionEventsResponseSchema,
  sessionListResponseSchema,
  type ContextGraphResponse,
  type SearchRequest,
  type SearchResponse,
  type SessionDetailResponse,
  type SessionEventsResponse,
  type SessionListResponse,
} from "./contracts";

const API_ROOT = "/api";

export type SessionListOptions = {
  limit?: number;
  cursor?: string;
};

export type SessionEventOptions = {
  limit?: number;
  cursor?: string;
  eventType?: string;
  eventId?: string;
};

export type ContextGraphOptions = {
  sessionId?: string;
  query?: string;
  domain?: string;
  limit?: number;
};

export const historyClient = {
  listSessions(
    options: SessionListOptions = {},
    signal?: AbortSignal,
  ): Promise<SessionListResponse> {
    const parameters = new URLSearchParams();
    parameters.set("limit", String(clampInteger(options.limit, 12, 1, 50)));
    if (options.cursor) parameters.set("cursor", options.cursor);

    return request(
      `${API_ROOT}/sessions?${parameters.toString()}`,
      sessionListResponseSchema,
      { signal },
    );
  },

  getSession(
    sessionId: string,
    signal?: AbortSignal,
  ): Promise<SessionDetailResponse> {
    return request(
      `${API_ROOT}/sessions/${encodeURIComponent(sessionId)}`,
      sessionDetailResponseSchema,
      { signal },
    );
  },

  listSessionEvents(
    sessionId: string,
    options: SessionEventOptions = {},
    signal?: AbortSignal,
  ): Promise<SessionEventsResponse> {
    const parameters = new URLSearchParams();
    parameters.set("limit", String(clampInteger(options.limit, 50, 1, 100)));
    if (options.cursor) parameters.set("cursor", options.cursor);
    if (options.eventType) parameters.set("eventType", options.eventType);
    if (options.eventId) parameters.set("eventId", options.eventId);

    return request(
      `${API_ROOT}/sessions/${encodeURIComponent(sessionId)}/events?${parameters.toString()}`,
      sessionEventsResponseSchema,
      { signal },
    );
  },

  search(
    input: SearchRequest,
    signal?: AbortSignal,
  ): Promise<SearchResponse> {
    const validated = searchRequestSchema.parse(input);

    return request(`${API_ROOT}/search`, searchResponseSchema, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(validated),
      signal,
    });
  },

  getContextGraph(
    options: ContextGraphOptions = {},
    signal?: AbortSignal,
  ): Promise<ContextGraphResponse> {
    const parameters = new URLSearchParams();
    parameters.set("limit", String(clampInteger(options.limit, 80, 1, 200)));
    if (options.sessionId) parameters.set("sessionId", options.sessionId);
    if (options.query) parameters.set("query", options.query);
    if (options.domain) parameters.set("domain", options.domain);

    return request(
      `${API_ROOT}/context-graph?${parameters.toString()}`,
      contextGraphResponseSchema,
      { signal },
    );
  },
};

async function request<T>(
  url: string,
  schema: ZodType<T>,
  init: RequestInit,
): Promise<T> {
  let response: Response;
  try {
    response = await fetch(url, {
      ...init,
      headers: {
        accept: "application/json",
        ...init.headers,
      },
    });
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") throw error;
    throw new HistoryApiError(
      "StreamSense history could not be reached. Check that the local backend is running.",
      { code: "network_error", status: 0 },
    );
  }

  const body = await readJson(response);
  if (!response.ok) {
    const parsedError = errorResponseSchema.safeParse(body);
    throw new HistoryApiError(
      parsedError.success
        ? parsedError.data.error.message
        : `The history request failed with status ${response.status}.`,
      {
        code: parsedError.success
          ? parsedError.data.error.code
          : "unexpected_http_error",
        status: response.status,
      },
    );
  }

  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    throw new HistoryApiError(
      "StreamSense history returned data in an unexpected format.",
      { code: "invalid_response", status: response.status },
    );
  }

  return parsed.data;
}

async function readJson(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    return null;
  }
}

function clampInteger(
  value: number | undefined,
  fallback: number,
  minimum: number,
  maximum: number,
): number {
  if (!Number.isInteger(value)) return fallback;
  return Math.max(minimum, Math.min(value ?? fallback, maximum));
}
