import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { beforeEach, describe, expect, it } from "vitest";

import { AppShell } from "../app/AppShell";
import { legacyExploreDestination } from "../app/DashboardRoutes";
import { DemoDataBanner } from "../components/DemoDataBanner";

const sessionId = "11111111-1111-4111-8111-111111111111";
const highContrastStorageKey = "streamsense.dashboard.highContrast";

describe("dashboard shell accessibility", () => {
  beforeEach(() => {
    window.localStorage.removeItem(highContrastStorageKey);
  });

  it("presents StreamSense as one Live and Memory product without Explore navigation", () => {
    renderShell();

    const rail = screen.getByRole("complementary", { name: "Dashboard rail" });
    expect(
      within(rail).getByRole("link", { name: "StreamSense Memory home" }),
    ).toHaveTextContent("StreamSenseLive + Memory");
    expect(screen.getByRole("main")).toHaveClass("main-content");

    const navigation = within(rail).getByRole("navigation", {
      name: "StreamSense navigation",
    });
    expect(within(navigation).getByRole("link", { name: "Memory" })).toHaveAttribute(
      "aria-keyshortcuts",
      "Alt+H",
    );
    expect(within(navigation).getByRole("link", { name: "Search" })).toHaveAttribute(
      "aria-keyshortcuts",
      "Control+K",
    );
    expect(within(navigation).getByRole("link", { name: "Account" })).toBeVisible();
    expect(within(navigation).queryByText(/explore/i)).not.toBeInTheDocument();

    expect(within(navigation).getByRole("button", { name: "3D map" })).toHaveAttribute(
      "aria-keyshortcuts",
      "Alt+G",
    );
    expect(screen.getByRole("button", { name: /high contrast/i })).toHaveAttribute(
      "aria-keyshortcuts",
      "Alt+C",
    );
    expect(screen.getByRole("button", { name: "Keyboard shortcuts" })).toHaveAttribute(
      "aria-keyshortcuts",
      "Alt+/",
    );
  });

  it("uses modifier shortcuts to navigate and focus Memory and Search", async () => {
    renderShell("/search");

    fireEvent.keyDown(window, { altKey: true, key: "h" });
    const memoryHeading = await screen.findByRole("heading", {
      level: 1,
      name: "Memory overview",
    });
    await waitFor(() => expect(memoryHeading).toHaveFocus());

    fireEvent.keyDown(window, { ctrlKey: true, key: "k" });
    const searchInput = await screen.findByRole("searchbox", {
      name: "Search session memory",
    });
    await waitFor(() => expect(searchInput).toHaveFocus());
  });

  it("focuses the graph selector after navigating and does not bind bare characters", async () => {
    renderShell("/search");

    fireEvent.keyDown(window, { key: "g" });
    expect(
      screen.getByRole("heading", { level: 1, name: "Search memory" }),
    ).toBeInTheDocument();

    fireEvent.keyDown(window, { altKey: true, key: "g" });
    const graphSelector = await screen.findByRole("combobox", {
      name: "Choose relationship",
    });
    await waitFor(() => expect(graphSelector).toHaveFocus());
  });

  it("offers persistent high contrast and keyboard shortcut help", async () => {
    renderShell();

    const contrastButton = screen.getByRole("button", { name: /high contrast/i });
    expect(contrastButton).toHaveAttribute("aria-pressed", "false");

    fireEvent.keyDown(window, { altKey: true, key: "c" });
    expect(contrastButton).toHaveAttribute("aria-pressed", "true");
    expect(document.querySelector(".app-shell")).toHaveAttribute(
      "data-contrast",
      "high",
    );
    expect(document.documentElement).toHaveAttribute(
      "data-streamsense-dashboard-contrast",
      "high",
    );
    expect(window.localStorage.getItem(highContrastStorageKey)).toBe("true");

    fireEvent.keyDown(window, { altKey: true, key: "/" });
    const helpHeading = screen.getByRole("heading", {
      name: "Keyboard shortcuts",
    });
    await waitFor(() => expect(helpHeading).toHaveFocus());
    expect(screen.getByText("Open and focus Memory search")).toBeInTheDocument();

    fireEvent.keyDown(window, { key: "Escape" });
    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: "Keyboard shortcuts" }),
      ).toHaveFocus(),
    );
    expect(
      screen.queryByRole("heading", { name: "Keyboard shortcuts" }),
    ).not.toBeInTheDocument();
  });

  it("explains an extension handoff without claiming dashboard capture", () => {
    renderShell(`/sessions/${sessionId}?source=extension`);

    const handoff = screen.getByLabelText("StreamSense extension handoff");
    expect(handoff).toHaveTextContent("Opened from StreamSense Live");
    expect(handoff).toHaveTextContent("refreshes periodically from the shared backend");
    expect(handoff).toHaveTextContent("controls remain in the extension side panel");
  });

  it("keeps the extension handoff visible on the Memory overview", () => {
    renderShell("/?source=extension");

    const handoff = screen.getByLabelText("StreamSense extension handoff");
    expect(handoff).toHaveTextContent("Opened from StreamSense Live");
    expect(handoff).toHaveTextContent(
      "Live capture and controls remain in the extension side panel",
    );
    expect(handoff).toHaveTextContent(
      "reads saved sessions from the shared backend",
    );
    expect(handoff).not.toHaveTextContent("refreshes periodically");
  });
});

describe("legacy context route", () => {
  it("redirects only a single valid session ID and preserves a trusted extension handoff", () => {
    expect(
      legacyExploreDestination(`?sessionId=${sessionId}&source=extension`),
    ).toBe(`/sessions/${sessionId}?source=extension#relationships`);
    expect(legacyExploreDestination(`?sessionId=${sessionId}`)).toBe(
      `/sessions/${sessionId}#relationships`,
    );
  });

  it("falls back safely for missing, duplicated, or invalid session IDs", () => {
    expect(legacyExploreDestination("")).toBe("/");
    expect(legacyExploreDestination("?source=extension")).toBe(
      "/?source=extension",
    );
    expect(legacyExploreDestination("?sessionId=../../search")).toBe("/");
    expect(
      legacyExploreDestination(`?sessionId=${sessionId}&sessionId=${sessionId}`),
    ).toBe("/");
  });
});

describe("data source notice", () => {
  it("identifies realtime, mixed, and demo sources with explicit text", () => {
    const view = render(<DemoDataBanner dataOrigin="realtime" />);
    expect(screen.getByLabelText("Data source notice")).toHaveTextContent(
      "Captured session memory",
    );
    expect(screen.getByLabelText("Data source notice")).toHaveTextContent(
      "recorded through StreamSense Live",
    );

    view.rerender(<DemoDataBanner dataOrigin="mixed" />);
    expect(screen.getByLabelText("Data source notice")).toHaveTextContent(
      "Captured and demo memory",
    );

    view.rerender(<DemoDataBanner dataOrigin="demo" />);
    expect(screen.getByLabelText("Data source notice")).toHaveTextContent(
      "Development demo data",
    );

    view.rerender(<DemoDataBanner dataOrigin="empty" />);
    expect(screen.queryByLabelText("Data source notice")).not.toBeInTheDocument();
  });
});

function renderShell(initialEntry = "/") {
  return render(
    <MemoryRouter initialEntries={[initialEntry]}>
      <Routes>
        <Route element={<AppShell />}>
          <Route index element={<MemoryFixture />} />
          <Route path="search" element={<SearchFixture />} />
          <Route path="sessions/:sessionId" element={<SessionFixture />} />
        </Route>
      </Routes>
    </MemoryRouter>,
  );
}

function MemoryFixture() {
  return (
    <section>
      <h1 data-route-heading tabIndex={-1}>Memory overview</h1>
      <label htmlFor="test-graph-selector">Choose relationship</label>
      <select id="test-graph-selector" data-graph-node-selector defaultValue="">
        <option value="">Choose a relationship</option>
      </select>
    </section>
  );
}

function SearchFixture() {
  return (
    <section>
      <h1 data-route-heading tabIndex={-1}>Search memory</h1>
      <label htmlFor="history-query">Search session memory</label>
      <input id="history-query" type="search" />
    </section>
  );
}

function SessionFixture() {
  return <h1 data-route-heading tabIndex={-1}>Saved session</h1>;
}
