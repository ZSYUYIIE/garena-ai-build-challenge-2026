import { z } from "zod";

import type { DashboardAccount } from "../../api/accountClient";

export const DASHBOARD_ACCOUNT_STORAGE_KEY =
  "streamsense.dashboard.account.v2";
export const DASHBOARD_ACCOUNT_CHANGED_EVENT =
  "streamsense:dashboard-account-changed";

const storedIdentitySchema = z.object({
  version: z.literal(2),
  accountId: z.string().uuid(),
});

export function readDashboardAccountId(): string | null {
  if (typeof window === "undefined") return null;
  try {
    const rawValue = window.localStorage.getItem(DASHBOARD_ACCOUNT_STORAGE_KEY);
    if (!rawValue) return null;
    const parsed = storedIdentitySchema.safeParse(JSON.parse(rawValue));
    return parsed.success ? parsed.data.accountId : null;
  } catch {
    return null;
  }
}

export function saveDashboardAccountId(accountId: string): void {
  const identity = storedIdentitySchema.parse({ version: 2, accountId });
  window.localStorage.setItem(
    DASHBOARD_ACCOUNT_STORAGE_KEY,
    JSON.stringify(identity),
  );
  notifyAccountChanged();
}

export function clearDashboardAccount(): void {
  if (typeof window === "undefined") return;
  window.localStorage.removeItem(DASHBOARD_ACCOUNT_STORAGE_KEY);
  notifyAccountChanged();
}

export function accountInitials(account: DashboardAccount | null): string {
  if (!account) return "?";
  const words = account.displayName.trim().split(/\s+/).filter(Boolean);
  return words
    .slice(0, 2)
    .map((word) => word[0]?.toLocaleUpperCase("en-US") ?? "")
    .join("") || "?";
}

function notifyAccountChanged(): void {
  window.dispatchEvent(new Event(DASHBOARD_ACCOUNT_CHANGED_EVENT));
}
