import axe from "axe-core";
import { screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { renderDashboard } from "./renderDashboard";
import {
  demoSession,
  earlierEvent,
  jsonResponse,
  laterEvent,
  sessionId,
} from "./fixtures";

describe("session detail", () => {
  it("renders summary metadata and a chronological semantic event timeline", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url.includes("/events?")) {
          return jsonResponse({
            meta: { dataOrigin: "demo" },
            events: [laterEvent, earlierEvent],
            nextCursor: null,
          });
        }
        return jsonResponse({
          meta: { dataOrigin: "demo" },
          session: demoSession,
        });
      }),
    );

    const { container } = renderDashboard(`/sessions/${sessionId}`);

    expect(
      await screen.findByRole("heading", { level: 1, name: demoSession.title }),
    ).toBeInTheDocument();
    expect(screen.getByText(demoSession.summary)).toBeInTheDocument();
    expect(screen.getByText("Counterattack")).toBeInTheDocument();

    const timelineHeading = screen.getByRole("heading", {
      name: "Significant events",
    });
    const timelineSection = timelineHeading.closest("section");
    expect(timelineSection).not.toBeNull();
    const articles = within(timelineSection!).getAllByRole("article");
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
      vi.fn(async (input: RequestInfo | URL) => {
        if (String(input).includes("/events?")) {
          return jsonResponse(
            { error: { code: "events_failed", message: "Events are offline." } },
            500,
          );
        }
        return jsonResponse({
          meta: { dataOrigin: "realtime" },
          session: demoSession,
        });
      }),
    );

    renderDashboard(`/sessions/${sessionId}`);

    expect(
      await screen.findByRole("heading", { level: 1, name: demoSession.title }),
    ).toBeInTheDocument();
    expect(await screen.findByRole("alert")).toHaveTextContent("Events are offline");
    expect(screen.getByText(demoSession.summary)).toBeInTheDocument();
  });

  it("loads and focuses an exact event opened from search", async () => {
    const requestedUrls: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        requestedUrls.push(url);
        if (url.includes("/events?")) {
          return jsonResponse({
            meta: { dataOrigin: "demo" },
            events: [laterEvent],
            nextCursor: null,
          });
        }
        return jsonResponse({
          meta: { dataOrigin: "demo" },
          session: demoSession,
        });
      }),
    );

    renderDashboard(`/sessions/${sessionId}#event-${laterEvent.id}`);

    const article = await screen.findByRole("article");
    await waitFor(() => expect(document.activeElement).toBe(article));
    expect(requestedUrls.some((url) => url.includes(`eventId=${laterEvent.id}`))).toBe(true);
    expect(screen.getByRole("link", { name: "Show the full timeline" })).toBeInTheDocument();
  });
});
