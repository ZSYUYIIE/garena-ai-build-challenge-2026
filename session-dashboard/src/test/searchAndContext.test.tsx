import axe from "axe-core";
import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { renderDashboard } from "./renderDashboard";
import {
  demoGraphResponse,
  demoSearchResponse,
  demoSession,
  jsonResponse,
  laterEvent,
  sessionId,
} from "./fixtures";

type HistorySurfaceFetchOptions = {
  graphBody?: unknown;
  graphStatus?: number;
};

function createHistorySurfaceFetch({
  graphBody = demoGraphResponse,
  graphStatus = 200,
}: HistorySurfaceFetchOptions = {}) {
  return vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);

    if (url.startsWith("/api/context-graph?")) {
      return jsonResponse(graphBody, graphStatus);
    }
    if (url.startsWith(`/api/sessions/${sessionId}/events?`)) {
      return jsonResponse({
        meta: { dataOrigin: "demo" },
        events: [laterEvent],
        nextCursor: null,
      });
    }
    if (url === `/api/sessions/${sessionId}`) {
      return jsonResponse({
        meta: { dataOrigin: "demo" },
        session: demoSession,
      });
    }
    if (url.startsWith("/api/sessions?")) {
      return jsonResponse({
        meta: { dataOrigin: "demo" },
        sessions: [demoSession],
        nextCursor: null,
      });
    }

    throw new Error(`Unexpected request: ${url}`);
  });
}

describe("history intelligence surfaces", () => {
  it("submits natural-language search and renders grounded results", async () => {
    const user = userEvent.setup();
    const fetchMock = vi.fn(
      async (_input: RequestInfo | URL, _init?: RequestInit) =>
        jsonResponse(demoSearchResponse),
    );
    vi.stubGlobal("fetch", fetchMock);

    const { container } = renderDashboard("/search");
    await user.type(
      screen.getByRole("searchbox", { name: "What are you looking for?" }),
      "similar defensive saves",
    );
    await user.click(screen.getByRole("button", { name: "Search history" }));

    expect(
      await screen.findByText(demoSearchResponse.results[0]!.description),
    ).toBeInTheDocument();
    expect(screen.getByText("93% similar")).toBeInTheDocument();
    expect(screen.getByLabelText("Data source notice")).toHaveTextContent(
      "Development demo data",
    );

    const requestInit = fetchMock.mock.calls[0]?.[1] as RequestInit;
    expect(requestInit.method).toBe("POST");
    expect(JSON.parse(String(requestInit.body))).toMatchObject({
      query: "similar defensive saves",
      limit: 20,
    });

    const accessibility = await axe.run(container, {
      rules: { "color-contrast": { enabled: false } },
    });
    expect(accessibility.violations).toEqual([]);
  });

  it("renders an unavailable search mode as a nonfatal state", async () => {
    const user = userEvent.setup();
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        jsonResponse({
          meta: { dataOrigin: "empty" },
          results: [],
          retrievalMode: "unavailable",
          warning: "Semantic search is not configured.",
        }),
      ),
    );

    renderDashboard("/search");
    await user.type(
      screen.getByRole("searchbox", { name: "What are you looking for?" }),
      "counterattack",
    );
    await user.click(screen.getByRole("button", { name: "Search history" }));

    expect(
      await screen.findByRole("heading", {
        name: "Semantic search is temporarily unavailable",
      }),
    ).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Memory" })).toBeInTheDocument();
  });

  it("redirects a valid legacy Explore link into session relationships", async () => {
    const fetchMock = createHistorySurfaceFetch();
    vi.stubGlobal("fetch", fetchMock);

    renderDashboard(`/explore?sessionId=${sessionId}`);

    expect(
      await screen.findByRole("heading", { level: 1, name: demoSession.title }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: "How this session connects" }),
    ).toBeInTheDocument();
    expect(
      await screen.findByRole("heading", { name: "Semantic relationship map" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("heading", {
        name: "People, topics, sessions, and moments",
      }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: "Relationships" }),
    ).toBeInTheDocument();
    expect(
      fetchMock.mock.calls.some(([input]) => {
        const url = String(input);
        return (
          url.startsWith("/api/context-graph?") &&
          url.includes(`sessionId=${sessionId}`) &&
          url.includes("limit=100")
        );
      }),
    ).toBe(true);
  });

  it("safely redirects an invalid legacy session id to Memory home", async () => {
    vi.stubGlobal("fetch", createHistorySurfaceFetch());

    renderDashboard("/explore?sessionId=..%2F..%2Fsearch");

    expect(
      await screen.findByRole("heading", {
        level: 1,
        name: "Your streams, remembered.",
      }),
    ).toBeInTheDocument();
    expect(
      await screen.findByRole("heading", { name: "Semantic relationship map" }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("heading", { name: /Explore session context/i }),
    ).not.toBeInTheDocument();
  });

  it("keeps map unavailability separate from session history on Memory home", async () => {
    vi.stubGlobal(
      "fetch",
      createHistorySurfaceFetch({
        graphBody: {
          error: {
            code: "context_graph_unavailable",
            message: "Context graph is not configured.",
          },
        },
        graphStatus: 503,
      }),
    );

    renderDashboard();

    expect(
      await screen.findByRole("heading", {
        name: "The relationship map is not available yet",
      }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: demoSession.title }),
    ).toBeInTheDocument();
  });
});
