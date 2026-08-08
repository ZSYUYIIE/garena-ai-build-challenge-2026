import { describe, expect, it, vi } from "vitest";

import { historyClient } from "../api/historyClient";
import { demoSession, jsonResponse } from "./fixtures";

describe("history API client", () => {
  it("uses a relative bounded URL and validates a successful response", async () => {
    const fetchMock = vi.fn(
      async (_input: RequestInfo | URL, _init?: RequestInit) =>
        jsonResponse({
          meta: { dataOrigin: "realtime" },
          sessions: [demoSession],
          nextCursor: null,
        }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const result = await historyClient.listSessions({ limit: 999 });

    expect(result.sessions[0]?.sessionId).toBe(demoSession.sessionId);
    expect(fetchMock.mock.calls[0]?.[0]).toBe("/api/sessions?limit=50");
  });

  it("rejects a malformed success payload as an invalid response", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => jsonResponse({ sessions: "not-an-array" })),
    );

    await expect(historyClient.listSessions()).rejects.toMatchObject({
      code: "invalid_response",
      status: 200,
    });
  });

  it("normalizes a predictable API error contract", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        jsonResponse(
          { error: { code: "history_unavailable", message: "History is offline." } },
          503,
        ),
      ),
    );

    await expect(historyClient.listSessions()).rejects.toMatchObject({
      code: "history_unavailable",
      status: 503,
      message: "History is offline.",
    });
  });

  it("requests one exact event for a search-result deep link", async () => {
    const fetchMock = vi.fn(
      async (_input: RequestInfo | URL, _init?: RequestInit) => jsonResponse({
        meta: { dataOrigin: "demo" },
        events: [],
        nextCursor: null,
      }),
    );
    vi.stubGlobal("fetch", fetchMock);
    const eventId = "00000001-0000-4000-8000-000000000001";

    await historyClient.listSessionEvents(demoSession.sessionId, { eventId });

    expect(String(fetchMock.mock.calls[0]?.[0])).toContain(`eventId=${eventId}`);
  });
});
