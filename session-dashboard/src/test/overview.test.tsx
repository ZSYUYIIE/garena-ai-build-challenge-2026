import axe from "axe-core";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { renderDashboard } from "./renderDashboard";
import {
  demoSession,
  jsonResponse,
  secondDemoSession,
} from "./fixtures";

describe("history overview", () => {
  it("announces loading while the session request is pending", () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() => new Promise<Response>(() => undefined)),
    );

    renderDashboard();

    expect(screen.getByRole("status")).toHaveTextContent(
      "Loading previous sessions",
    );
  });

  it("renders a clear empty-history state", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        jsonResponse({
          meta: { dataOrigin: "empty" },
          sessions: [],
          nextCursor: null,
        }),
      ),
    );

    renderDashboard();

    expect(
      await screen.findByRole("heading", { name: "No session history yet" }),
    ).toBeInTheDocument();
    expect(screen.queryByLabelText("Data source notice")).not.toBeInTheDocument();
  });

  it("shows a recoverable backend error", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        jsonResponse(
          { error: { code: "history_failed", message: "History is unavailable." } },
          500,
        ),
      ),
    );

    renderDashboard();

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "History is unavailable",
    );
    expect(screen.getByRole("button", { name: "Try again" })).toBeEnabled();
  });

  it("renders seeded sessions, metadata, metrics, and an explicit demo notice", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        jsonResponse({
          meta: { dataOrigin: "demo" },
          sessions: [demoSession, secondDemoSession],
          nextCursor: null,
        }),
      ),
    );

    const { container } = renderDashboard();

    expect(
      await screen.findByRole("link", { name: demoSession.title }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: secondDemoSession.title }),
    ).toBeInTheDocument();
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
      vi.fn(async () =>
        jsonResponse({
          meta: { dataOrigin: "demo" },
          sessions: [demoSession],
          nextCursor: null,
        }),
      ),
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
