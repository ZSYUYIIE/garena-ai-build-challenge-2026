import axe from "axe-core";
import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it } from "vitest";

import {
  DASHBOARD_ACCOUNT_STORAGE_KEY,
  readDashboardAccount,
} from "../features/account/accountStorage";
import { renderDashboard } from "./renderDashboard";

describe("dashboard account", () => {
  beforeEach(() => {
    window.localStorage.removeItem(DASHBOARD_ACCOUNT_STORAGE_KEY);
  });

  it("creates, edits, exposes, and signs out a local dashboard account", async () => {
    const user = userEvent.setup();
    const { container } = renderDashboard("/account");

    expect(
      screen.getByRole("heading", { name: "Create your StreamSense account" }),
    ).toBeInTheDocument();
    expect(screen.getByLabelText("Prototype account notice")).toHaveTextContent(
      "stored only in this browser",
    );
    expect(screen.getByLabelText("Prototype account notice")).toHaveTextContent(
      "does not upload credentials",
    );

    await user.type(screen.getByLabelText("Display name"), "Maya Chen");
    await user.type(screen.getByLabelText("Email"), "maya@example.com");
    await user.click(screen.getByRole("button", { name: "Create local account" }));

    expect(await screen.findByRole("status")).toHaveTextContent(
      "Local account created",
    );
    expect(readDashboardAccount()).toMatchObject({
      displayName: "Maya Chen",
      email: "maya@example.com",
      contentPreference: "mixed",
      narrationPreference: "standard",
    });
    expect(screen.getByRole("link", { name: "Account for Maya Chen" })).toBeVisible();
    expect(
      screen.getByRole("button", { name: "Save account changes" }),
    ).toBeEnabled();

    await user.clear(screen.getByLabelText("Display name"));
    await user.type(screen.getByLabelText("Display name"), "Maya C");
    await user.click(screen.getByRole("button", { name: "Save account changes" }));

    expect(await screen.findByRole("status")).toHaveTextContent(
      "Account preferences updated",
    );
    expect(readDashboardAccount()?.displayName).toBe("Maya C");

    await user.click(screen.getByRole("button", { name: "Sign out on this device" }));
    expect(await screen.findByRole("status")).toHaveTextContent(
      "Signed out on this device",
    );
    expect(readDashboardAccount()).toBeNull();
    expect(
      screen.getByRole("button", { name: "Create local account" }),
    ).toBeEnabled();

    const accessibility = await axe.run(container, {
      rules: { "color-contrast": { enabled: false } },
    });
    expect(accessibility.violations).toEqual([]);
  });

  it("ignores malformed account data instead of exposing it in the shell", () => {
    window.localStorage.setItem(
      DASHBOARD_ACCOUNT_STORAGE_KEY,
      JSON.stringify({ version: 1, displayName: "Broken" }),
    );

    renderDashboard("/account");

    expect(readDashboardAccount()).toBeNull();
    expect(
      screen.getByRole("link", { name: "Create a local dashboard account" }),
    ).toBeVisible();
  });
});
