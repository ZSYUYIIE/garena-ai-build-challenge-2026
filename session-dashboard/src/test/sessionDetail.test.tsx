import axe from "axe-core";
import { screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { renderDashboard } from "./renderDashboard";
import {
  demoGraphResponse,
  demoSession,
  earlierEvent,
  jsonResponse,
  laterEvent,
  sessionId,
} from "./fixtures";

type SessionFetchOptions = {
  sessionBody?: unknown;
  sessionStatus?: number;
  eventsBody?: unknown;
  eventsStatus?: number;
  graphBody?: unknown;
  graphStatus?: number;
};

function createSessionFetch({
  sessionBody = {
    meta: { dataOrigin: "demo" },
    session: demoSession,
  },
  sessionStatus = 200,
  eventsBody = {
    meta: { dataOrigin: "demo" },
    events: [laterEvent, earlierEvent],
    nextCursor: null,
  },
  eventsStatus = 200,
  graphBody = demoGraphResponse,
  graphStatus = 200,
}: SessionFetchOptions = {}) {
  return vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);

    if (url.startsWith("/api/context-graph?")) {
      return jsonResponse(graphBody, graphStatus);
    }
    if (url.startsWith(`/api/sessions/${sessionId}/events?`)) {
      return jsonResponse(eventsBody, eventsStatus);
    }
    if (url === `/api/sessions/${sessionId}`) {
      return jsonResponse(sessionBody, sessionStatus);
    }

    throw new Error(`Unexpected request: ${url}`);
  });
}

describe("session detail", () => {
  it("renders relationships plus a chronological semantic event timeline", async () => {
    vi.stubGlobal("fetch", createSessionFetch());

    const { container } = renderDashboard(`/sessions/${sessionId}`);

    expect(
      await screen.findByRole("heading", { level: 1, name: demoSession.title }),
    ).toBeInTheDocument();
    expect(screen.getByText(demoSession.summary)).toBeInTheDocument();
    expect(screen.getByText("Counterattack")).toBeInTheDocument();
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
    expect(screen.getAllByText("Defensive save")).not.toHaveLength(0);
    expect(
      screen.getAllByText("Recorded structural relationship"),
    ).toHaveLength(2);

    const timelineHeading = screen.getByRole("heading", {
      name: "Significant events",
    });
    const timelineSection = timelineHeading.closest("section");
    expect(timelineSection).not.toBeNull();
    const articles = await within(timelineSection!).findAllByRole("article");
    expect(articles).toHaveLength(2);
    expect(articles[0]).toHaveTextContent("01:35");
    expect(articles[1]).toHaveTextContent("03:42");
    expect(
      screen.getByRole("meter", { name: "Importance 76%" }),
    ).toBeInTheDocument();

    const accessibility = await axe.run(container, {
      rules: { "color-contrast": { enabled: false } },
    });
    expect(accessibility.violations).toEqual([]);
  });

  it("keeps event failure local to the timeline", async () => {
    vi.stubGlobal(
      "fetch",
      createSessionFetch({
        sessionBody: {
          meta: { dataOrigin: "realtime" },
          session: demoSession,
        },
        eventsBody: {
          error: { code: "events_failed", message: "Events are offline." },
        },
        eventsStatus: 500,
      }),
    );

    renderDashboard(`/sessions/${sessionId}`);

    expect(
      await screen.findByRole("heading", { level: 1, name: demoSession.title }),
    ).toBeInTheDocument();
    expect(await screen.findByRole("alert")).toHaveTextContent("Events are offline");
    expect(screen.getByText(demoSession.summary)).toBeInTheDocument();
    expect(
      await screen.findByRole("heading", { name: "Relationships" }),
    ).toBeInTheDocument();
    expect(screen.getByLabelText("Data source notice")).toHaveTextContent(
      "Captured session memory",
    );
  });

  it("loads and focuses an exact event opened from search", async () => {
    const fetchMock = createSessionFetch({
      eventsBody: {
        meta: { dataOrigin: "demo" },
        events: [laterEvent],
        nextCursor: null,
      },
    });
    vi.stubGlobal("fetch", fetchMock);

    renderDashboard(`/sessions/${sessionId}#event-${laterEvent.id}`);

    const article = await screen.findByRole("article");
    await waitFor(() => expect(document.activeElement).toBe(article));
    expect(
      fetchMock.mock.calls.some(([input]) =>
        String(input).includes(`eventId=${laterEvent.id}`),
      ),
    ).toBe(true);
    expect(
      fetchMock.mock.calls.some(([input]) => {
        const url = String(input);
        return (
          url.startsWith("/api/context-graph?") &&
          url.includes(`sessionId=${sessionId}`)
        );
      }),
    ).toBe(true);
    expect(
      screen.getByRole("link", { name: "Show the full timeline" }),
    ).toBeInTheDocument();
  });

  it(
    "refreshes extension-opened session memory from all shared backend surfaces",
    async () => {
      const fetchMock = createSessionFetch();
      vi.stubGlobal("fetch", fetchMock);

      renderDashboard(`/sessions/${sessionId}?source=extension`);

      expect(
        await screen.findByRole("heading", { level: 1, name: demoSession.title }),
      ).toBeInTheDocument();
      expect(
        await screen.findByRole("heading", { name: "Semantic relationship map" }),
      ).toBeInTheDocument();

      await waitFor(
        () => {
          const urls = fetchMock.mock.calls.map(([input]) => String(input));
          expect(
            urls.filter((url) => url === `/api/sessions/${sessionId}`).length,
          ).toBeGreaterThanOrEqual(2);
          expect(
            urls.filter((url) =>
              url.startsWith(`/api/sessions/${sessionId}/events?`),
            ).length,
          ).toBeGreaterThanOrEqual(2);
          expect(
            urls.filter(
              (url) =>
                url.startsWith("/api/context-graph?") &&
                url.includes(`sessionId=${sessionId}`),
            ).length,
          ).toBeGreaterThanOrEqual(2);
        },
        { timeout: 4_500 },
      );
    },
    8_000,
  );
});
