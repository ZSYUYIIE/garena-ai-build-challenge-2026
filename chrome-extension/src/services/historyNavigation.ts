import { configuredHistoryDashboardUrl } from "./backendUrls.ts";

export type CreateTab = (
  properties: { url: string },
) => Promise<unknown> | unknown;

export async function openHistoryDashboard(
  createTab: CreateTab,
  dashboardUrl: string,
): Promise<void> {
  await createTab({ url: dashboardUrl });
}

export function openConfiguredHistoryDashboard(
  activeSessionId?: string | null,
): Promise<void> {
  return openHistoryDashboard(
    (properties) => chrome.tabs.create(properties),
    configuredHistoryDashboardUrl(activeSessionId),
  );
}
