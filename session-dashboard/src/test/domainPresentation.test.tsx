import { screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { renderDashboard } from "./renderDashboard";
import { demoSession, jsonResponse } from "./fixtures";

const unknownSession = {
  ...demoSession,
  domain: "unknown",
};

function createUnknownDomainFetch() {
  return vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.startsWith("/api/sessions?")) {
      return jsonResponse({
        meta: { dataOrigin: "realtime" },
        sessions: [unknownSession],
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
}

describe("optional domain presentation", () => {
  it("does not expose unknown as a user-facing category", async () => {
    vi.stubGlobal("fetch", createUnknownDomainFetch());

    renderDashboard();

    expect(
      await screen.findByRole("link", { name: unknownSession.title }),
    ).toBeInTheDocument();
    expect(screen.queryByText(/^unknown$/i)).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Entertainment domain")).not.toBeInTheDocument();
    expect(screen.getByText("Significant moments")).toBeInTheDocument();
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
