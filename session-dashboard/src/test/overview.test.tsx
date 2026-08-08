import axe from "axe-core";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { renderDashboard } from "./renderDashboard";
import {
  demoGraphResponse,
  demoSession,
  jsonResponse,
  secondDemoSession,
} from "./fixtures";

type OverviewFetchOptions = {
  sessionsBody?: unknown;
  sessionsStatus?: number;
  graphBody?: unknown;
  graphStatus?: number;
};

function createOverviewFetch({
  sessionsBody = {
    meta: { dataOrigin: "demo" },
    sessions: [demoSession, secondDemoSession],
    nextCursor: null,
  },
  sessionsStatus = 200,
  graphBody = demoGraphResponse,
  graphStatus = 200,
}: OverviewFetchOptions = {}) {
  return vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);

    if (url.startsWith("/api/sessions?")) {
      return jsonResponse(sessionsBody, sessionsStatus);
    }
    if (url.startsWith("/api/context-graph?")) {
      return jsonResponse(graphBody, graphStatus);
    }

    throw new Error(`Unexpected request: ${url}`);
  });
}

describe("history overview", () => {
  it("announces both memory sources while their requests are pending", () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() => new Promise<Response>(() => undefined)),
    );

    renderDashboard();

    expect(screen.getByText(/Loading previous sessions/)).toBeInTheDocument();
    expect(
      screen.getByText(/Building the memory constellation/),
    ).toBeInTheDocument();
  });

  it("renders a clear empty-history state", async () => {
    vi.stubGlobal(
      "fetch",
      createOverviewFetch({
        sessionsBody: {
          meta: { dataOrigin: "empty" },
          sessions: [],
          nextCursor: null,
        },
        graphBody: {
          meta: { dataOrigin: "empty" },
          nodes: [],
          edges: [],
        },
      }),
    );

    renderDashboard();

    expect(
      await screen.findByRole("heading", { name: "No session history yet" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: "No connected moments are available" }),
    ).toBeInTheDocument();
    expect(screen.queryByLabelText("Data source notice")).not.toBeInTheDocument();
  });

  it("shows a recoverable session-history error without hiding the map", async () => {
    vi.stubGlobal(
      "fetch",
      createOverviewFetch({
        sessionsBody: {
          error: { code: "history_failed", message: "History is unavailable." },
        },
        sessionsStatus: 500,
      }),
    );

    renderDashboard();

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "History is unavailable",
    );
    expect(screen.getByRole("button", { name: "Try again" })).toBeEnabled();
    expect(
      screen.getByRole("heading", { name: "3D relationship map" }),
    ).toBeInTheDocument();
  });

  it("keeps the relationship map ahead of metrics and session history", async () => {
    const user = userEvent.setup();
    const fetchMock = createOverviewFetch();
    vi.stubGlobal("fetch", fetchMock);

    const { container } = renderDashboard();

    expect(
      await screen.findByRole("link", { name: demoSession.title }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: secondDemoSession.title }),
    ).toBeInTheDocument();

    const graphHeading = screen.getByRole("heading", {
      name: "3D relationship map",
    });
    const overviewHeading = screen.getByRole("heading", {
      name: "This page of memory",
    });
    const sessionsHeading = screen.getByRole("heading", {
      name: "Recent sessions",
    });
    expect(
      Boolean(
        graphHeading.compareDocumentPosition(overviewHeading) &
          Node.DOCUMENT_POSITION_FOLLOWING,
      ),
    ).toBe(true);
    expect(
      Boolean(
        overviewHeading.compareDocumentPosition(sessionsHeading) &
          Node.DOCUMENT_POSITION_FOLLOWING,
      ),
    ).toBe(true);

    await user.keyboard("{Alt>}g{/Alt}");
    expect(screen.getByLabelText("Labeled graph node")).toHaveFocus();

    const domainSelector = screen.getByLabelText("Entertainment domain");
    await user.click(domainSelector);
    const domainList = await screen.findByRole("listbox");
    expect(
      within(domainList).getByRole("option", { name: "Football" }),
    ).toBeInTheDocument();
    expect(
      within(domainList).getByRole("option", { name: "Esports" }),
    ).toBeInTheDocument();

    await user.click(
      within(domainList).getByRole("option", { name: "Football" }),
    );
    await waitFor(() => {
      expect(
        fetchMock.mock.calls.some(([input]) => {
          const url = String(input);
          return (
            url.startsWith("/api/context-graph?") &&
            url.includes("limit=80") &&
            url.includes("domain=Football")
          );
        }),
      ).toBe(true);
    });

    expect(screen.getByLabelText("Data source notice")).toHaveTextContent(
      "Development demo data",
    );
    expect(screen.getByText("22", { selector: "dd" })).toBeInTheDocument();

    const accessibility = await axe.run(container, {
      rules: { "color-contrast": { enabled: false } },
    });
    expect(accessibility.violations).toEqual([]);
  });

  it("preserves keyboard entry and focuses the next page heading after navigation", async () => {
    const user = userEvent.setup();
    vi.stubGlobal(
      "fetch",
      createOverviewFetch({
        sessionsBody: {
          meta: { dataOrigin: "demo" },
          sessions: [demoSession],
          nextCursor: null,
        },
      }),
    );

    renderDashboard();
    await screen.findByRole("link", { name: demoSession.title });

    await user.tab();
    expect(screen.getByRole("link", { name: "Skip to main content" })).toHaveFocus();

    await user.click(screen.getByRole("link", { name: "Search" }));
    const heading = await screen.findByRole("heading", {
      level: 1,
      name: "Search meaningful moments",
    });
    await waitFor(() => expect(heading).toHaveFocus());
  });
});
