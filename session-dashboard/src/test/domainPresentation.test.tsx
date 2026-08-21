import { act, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { renderDashboard } from "./renderDashboard";
import { demoSession, jsonResponse } from "./fixtures";

const unknownSession = {
  ...demoSession,
  domain: "unknown",
};

const unknownGraph = {
  nodes: [
    {
      id: `session:${unknownSession.sessionId}`,
      type: "session" as const,
      label: "StreamSense session",
      sessionId: unknownSession.sessionId,
      metadata: { domain: "unknown", durationSeconds: 60 },
    },
    {
      id: "event:unknown-domain",
      type: "event" as const,
      label: "A bear climbs a snowy slope",
      sessionId: unknownSession.sessionId,
      eventId: "88888888-8888-4888-8888-888888888888",
      metadata: { timestampSeconds: 12 },
    },
  ],
  edges: [
    {
      id: "edge:unknown-domain",
      source: `session:${unknownSession.sessionId}`,
      target: "event:unknown-domain",
      type: "same_session" as const,
      weight: 1,
    },
  ],
};

function createDomainFetch(session = unknownSession) {
  return vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.startsWith("/api/sessions?")) {
      return jsonResponse({
        meta: { dataOrigin: "realtime" },
        sessions: [session],
        nextCursor: null,
      });
    }
    if (url === `/api/sessions/${session.sessionId}`) {
      return jsonResponse({
        meta: { dataOrigin: "realtime" },
        session,
      });
    }
    if (url.startsWith(`/api/sessions/${session.sessionId}/events?`)) {
      return jsonResponse({
        meta: { dataOrigin: "realtime" },
        events: [],
        nextCursor: null,
      });
    }
    if (url.startsWith("/api/context-graph?")) {
      return jsonResponse({
        meta: { dataOrigin: "realtime" },
        ...unknownGraph,
      });
    }
    throw new Error(`Unexpected request: ${url}`);
  });
}

describe("optional domain presentation", () => {
  it("does not expose unknown as a user-facing category on Memory home", async () => {
    vi.stubGlobal("fetch", createDomainFetch());

    renderDashboard();

    expect(
      await screen.findByRole("link", { name: unknownSession.title }),
    ).toBeInTheDocument();
    expect(screen.queryByText(/^unknown$/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/other entertainment/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/^unclassified$/i)).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Entertainment domain")).not.toBeInTheDocument();
    expect(screen.getByText("Significant moments")).toBeInTheDocument();
    expect(screen.getByText("0 sessions · 0 moments · 0 populated lanes of 5")).toBeInTheDocument();
  });

  it("does not expose unknown on an individual session page", async () => {
    vi.stubGlobal("fetch", createDomainFetch());

    renderDashboard(`/sessions/${unknownSession.sessionId}`);

    expect(
      await screen.findByRole("heading", {
        level: 1,
        name: unknownSession.title,
      }),
    ).toBeInTheDocument();
    expect(await screen.findByLabelText("Labeled graph node")).toBeEnabled();
    expect(screen.getAllByText("A bear climbs a snowy slope").length).toBeGreaterThan(0);
    expect(screen.getAllByText(/belongs to/i).length).toBeGreaterThan(0);
    expect(screen.getByText(/Domain unavailable/)).toBeInTheDocument();
    expect(screen.queryByText(/^unknown$/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/other entertainment/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/^unclassified$/i)).not.toBeInTheDocument();
  });

  it("keeps a trustworthy known domain visible and filterable", async () => {
    vi.stubGlobal("fetch", createDomainFetch(demoSession));

    renderDashboard();

    expect(
      await screen.findByLabelText("Entertainment domain"),
    ).toBeInTheDocument();
    expect(screen.getAllByText("Football").length).toBeGreaterThan(0);
    expect(screen.getByText("Domains", { selector: "dt" })).toBeInTheDocument();
  });

  it("drops a stale domain filter when refreshed sessions no longer expose that domain", async () => {
    const user = userEvent.setup();
    let activeSession = demoSession;
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.startsWith("/api/sessions?")) {
        return jsonResponse({
          meta: { dataOrigin: "realtime" },
          sessions: [activeSession],
          nextCursor: null,
        });
      }
      if (url.startsWith("/api/context-graph?")) {
        return jsonResponse({
          meta: { dataOrigin: "realtime" },
          nodes: [],
          edges: [],
        });
      }
      throw new Error(`Unexpected request: ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    const { queryClient } = renderDashboard();
    const domainSelector = await screen.findByLabelText("Entertainment domain");
    await user.click(domainSelector);
    const domainList = await screen.findByRole("listbox");
    await user.click(within(domainList).getByRole("option", { name: "Football" }));

    await waitFor(() => {
      expect(
        fetchMock.mock.calls.some(([input]) =>
          String(input).includes("/api/context-graph?") &&
          String(input).includes("domain=Football"),
        ),
      ).toBe(true);
    });

    activeSession = unknownSession;
    await act(async () => {
      await queryClient.refetchQueries({ queryKey: ["history", "sessions"] });
    });

    await waitFor(() => {
      expect(screen.queryByLabelText("Entertainment domain")).not.toBeInTheDocument();
    });

    const callsBeforeGraphRefetch = fetchMock.mock.calls.length;
    await act(async () => {
      await queryClient.refetchQueries({
        queryKey: ["history", "context-graph"],
        type: "active",
      });
    });

    const graphCallsAfterRefresh = fetchMock.mock.calls
      .slice(callsBeforeGraphRefetch)
      .map(([input]) => String(input))
      .filter((url) => url.startsWith("/api/context-graph?"));
    expect(graphCallsAfterRefresh.length).toBeGreaterThan(0);
    expect(
      graphCallsAfterRefresh.every((url) => !url.includes("domain=Football")),
    ).toBe(true);
  });

  it("keeps Memory search query-led without a separate domain field", () => {
    vi.stubGlobal("fetch", vi.fn());

    renderDashboard("/search");

    expect(
      screen.getByRole("searchbox", { name: "What are you looking for?" }),
    ).toBeInTheDocument();
    expect(screen.queryByLabelText(/Domain/i)).not.toBeInTheDocument();
    expect(
      screen.getByText(/no separate domain field is required/i),
    ).toBeInTheDocument();
  });
});
