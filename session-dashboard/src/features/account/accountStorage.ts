import { z } from "zod";

export const DASHBOARD_ACCOUNT_STORAGE_KEY =
  "streamsense.dashboard.account.v1";
export const DASHBOARD_ACCOUNT_CHANGED_EVENT =
  "streamsense:dashboard-account-changed";

export const contentPreferences = [
  "mixed",
  "sports",
  "esports",
  "concerts",
  "product_launches",
  "creator_livestreams",
] as const;

export const narrationPreferences = [
  "minimal",
  "standard",
  "detailed",
  "question_only",
] as const;

const dashboardAccountSchema = z.object({
  version: z.literal(1),
  id: z.string().min(1).max(120),
  displayName: z.string().trim().min(1).max(60),
  email: z.string().trim().email().max(254),
  contentPreference: z.enum(contentPreferences),
  narrationPreference: z.enum(narrationPreferences),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});

const dashboardAccountDraftSchema = dashboardAccountSchema.pick({
  displayName: true,
  email: true,
  contentPreference: true,
  narrationPreference: true,
});

export type DashboardAccount = z.infer<typeof dashboardAccountSchema>;
export type DashboardAccountDraft = z.infer<
  typeof dashboardAccountDraftSchema
>;

export function readDashboardAccount(): DashboardAccount | null {
  if (typeof window === "undefined") return null;

  try {
    const rawValue = window.localStorage.getItem(DASHBOARD_ACCOUNT_STORAGE_KEY);
    if (!rawValue) return null;
    const parsed = dashboardAccountSchema.safeParse(JSON.parse(rawValue));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

export function saveDashboardAccount(
  draft: DashboardAccountDraft,
  existingAccount: DashboardAccount | null = readDashboardAccount(),
): DashboardAccount {
  const validatedDraft = dashboardAccountDraftSchema.parse(draft);
  const now = new Date().toISOString();
  const account = dashboardAccountSchema.parse({
    ...validatedDraft,
    version: 1,
    id: existingAccount?.id ?? createLocalAccountId(),
    createdAt: existingAccount?.createdAt ?? now,
    updatedAt: now,
  });

  window.localStorage.setItem(
    DASHBOARD_ACCOUNT_STORAGE_KEY,
    JSON.stringify(account),
  );
  notifyAccountChanged();
  return account;
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

function createLocalAccountId(): string {
  const randomUuid = globalThis.crypto?.randomUUID?.();
  return randomUuid ? `local:${randomUuid}` : `local:${Date.now().toString(36)}`;
}

function notifyAccountChanged(): void {
  window.dispatchEvent(new Event(DASHBOARD_ACCOUNT_CHANGED_EVENT));
}
