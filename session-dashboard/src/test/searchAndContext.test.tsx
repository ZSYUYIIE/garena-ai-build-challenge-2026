import axe from "axe-core";
import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { renderDashboard } from "./renderDashboard";
import {
  demoGraphResponse,
  demoSearchResponse,
  jsonResponse,
} from "./fixtures";

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

    expect(await screen.findByText(demoSearchResponse.results[0]!.description)).toBeInTheDocument();
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
    expect(screen.getByRole("link", { name: "Sessions" })).toBeInTheDocument();
  });

  it("provides an accessible context-graph boundary without a visual renderer", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => jsonResponse(demoGraphResponse)),
    );

    const { container } = renderDashboard("/explore");

    expect(
      await screen.findByRole("heading", {
        name: "3D relationship map",
      }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("heading", {
        name: "People, topics, sessions, and moments",
      }),
    ).toBeInTheDocument();
    expect(screen.getAllByText("Defensive save")).not.toHaveLength(0);
    expect(screen.getByText(/same session/i)).toBeInTheDocument();

    const accessibility = await axe.run(container, {
      rules: { "color-contrast": { enabled: false } },
    });
    expect(accessibility.violations).toEqual([]);
  });

  it("keeps context-graph unavailability separate from session history", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        jsonResponse(
          {
            error: {
              code: "context_graph_unavailable",
              message: "Context graph is not configured.",
            },
          },
          503,
        ),
      ),
    );

    renderDashboard("/explore");

    expect(
      await screen.findByRole("heading", {
        name: "Context exploration is not available yet",
      }),
    ).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Sessions" })).toBeInTheDocument();
  });
});
