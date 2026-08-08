import axe from "axe-core";
import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { DashboardAccount } from "../api/accountClient";
import {
  DASHBOARD_ACCOUNT_STORAGE_KEY,
  readDashboardAccountId,
} from "../features/account/accountStorage";
import { renderDashboard } from "./renderDashboard";

describe("dashboard account", () => {
  let storedAccount: DashboardAccount | null;

  beforeEach(() => {
    storedAccount = null;
    window.localStorage.removeItem(DASHBOARD_ACCOUNT_STORAGE_KEY);
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url === "/api/accounts" && init?.method === "POST") {
        const draft = JSON.parse(String(init.body));
        storedAccount = {
          ...draft,
          version: 1,
          accountId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
          createdAt: "2026-08-08T01:00:00.000Z",
          updatedAt: "2026-08-08T01:00:00.000Z",
        };
        return jsonResponse({ account: storedAccount }, 201);
      }
      if (url.startsWith("/api/accounts/") && init?.method === "PUT") {
        if (!storedAccount) return jsonResponse(accountNotFound(), 404);
        const draft = JSON.parse(String(init.body));
        storedAccount = {
          ...storedAccount,
          ...draft,
          updatedAt: "2026-08-08T01:05:00.000Z",
        };
        return jsonResponse({ account: storedAccount });
      }
      if (url.startsWith("/api/accounts/") && (!init?.method || init.method === "GET")) {
        return storedAccount
          ? jsonResponse({ account: storedAccount })
          : jsonResponse(accountNotFound(), 404);
      }
      throw new Error(`Unexpected request: ${url}`);
    }));
  });

  it("creates, edits, exposes, and signs out of a MongoDB-backed profile", async () => {
    const user = userEvent.setup();
    const { container } = renderDashboard("/account");

    expect(
      screen.getByRole("heading", { name: "Create your StreamSense account" }),
    ).toBeInTheDocument();
    expect(screen.getByLabelText("Prototype account notice")).toHaveTextContent(
      "MongoDB prototype profile",
    );
    expect(screen.getByLabelText("Prototype account notice")).toHaveTextContent(
      "no password authentication",
    );

    await user.type(screen.getByLabelText("Display name"), "Maya Chen");
    await user.type(screen.getByLabelText("Email"), "Maya@Example.com");
    await user.click(screen.getByRole("button", { name: "Create MongoDB account" }));

    expect(await screen.findByRole("status")).toHaveTextContent(
      "MongoDB account created",
    );
    expect(storedAccount).toMatchObject({
      displayName: "Maya Chen",
      email: "maya@example.com",
      contentPreference: "mixed",
      narrationPreference: "standard",
    });
    expect(readDashboardAccountId()).toBe("aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa");
    expect(window.localStorage.getItem(DASHBOARD_ACCOUNT_STORAGE_KEY)).not.toContain(
      "maya@example.com",
    );
    expect(await screen.findByRole("link", { name: "Account for Maya Chen" })).toBeVisible();

    await user.clear(screen.getByLabelText("Display name"));
    await user.type(screen.getByLabelText("Display name"), "Maya C");
    await user.click(screen.getByRole("button", { name: "Save account changes" }));

    expect(await screen.findByRole("status")).toHaveTextContent(
      "Account preferences updated",
    );
    expect(storedAccount?.displayName).toBe("Maya C");

    await user.click(screen.getByRole("button", { name: "Sign out on this device" }));
    expect(await screen.findByRole("status")).toHaveTextContent(
      "Signed out on this device",
    );
    expect(readDashboardAccountId()).toBeNull();
    expect(storedAccount?.displayName).toBe("Maya C");
    expect(
      screen.getByRole("button", { name: "Create MongoDB account" }),
    ).toBeEnabled();

    const accessibility = await axe.run(container, {
      rules: { "color-contrast": { enabled: false } },
    });
    expect(accessibility.violations).toEqual([]);
  });

  it("ignores malformed local identity data instead of fetching a profile", () => {
    window.localStorage.setItem(
      DASHBOARD_ACCOUNT_STORAGE_KEY,
      JSON.stringify({ version: 2, accountId: "not-a-uuid", email: "secret@example.com" }),
    );

    renderDashboard("/account");

    expect(readDashboardAccountId()).toBeNull();
    expect(
      screen.getByRole("link", { name: "Create a StreamSense dashboard account" }),
    ).toBeVisible();
    expect(fetch).not.toHaveBeenCalled();
  });
});

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function accountNotFound() {
  return {
    error: { code: "ACCOUNT_NOT_FOUND", message: "The requested account was not found." },
  };
}
