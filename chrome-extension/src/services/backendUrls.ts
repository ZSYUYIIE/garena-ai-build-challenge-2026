export const DEFAULT_BACKEND_WEBSOCKET_URL = "ws://127.0.0.1:8000/ws";

export type BackendUrlConfiguration = {
  webSocketUrl?: string | null;
  dashboardUrl?: string | null;
};

export function resolveBackendWebSocketUrl(
  candidate?: string | null,
): string {
  return parseBackendWebSocketUrl(candidate)?.toString()
    ?? DEFAULT_BACKEND_WEBSOCKET_URL;
}

export function deriveDashboardUrlFromWebSocket(
  candidate?: string | null,
): string {
  const dashboardUrl = new URL(resolveBackendWebSocketUrl(candidate));
  dashboardUrl.protocol = dashboardUrl.protocol === "wss:" ? "https:" : "http:";
  dashboardUrl.pathname = "/dashboard/";
  dashboardUrl.search = "";
  dashboardUrl.hash = "";
  return dashboardUrl.toString();
}

export function resolveDashboardUrl({
  dashboardUrl,
  webSocketUrl,
}: BackendUrlConfiguration = {}): string {
  return parseLoopbackDashboardUrl(dashboardUrl)?.toString()
    ?? deriveDashboardUrlFromWebSocket(webSocketUrl);
}

export function configuredBackendWebSocketUrl(): string {
  return resolveBackendWebSocketUrl(buildEnvironment()?.VITE_STREAMSENSE_WS_URL);
}

export function configuredDashboardUrl(): string {
  const environment = buildEnvironment();
  return resolveDashboardUrl({
    dashboardUrl: environment?.VITE_STREAMSENSE_DASHBOARD_URL,
    webSocketUrl: environment?.VITE_STREAMSENSE_WS_URL,
  });
}

function parseBackendWebSocketUrl(candidate?: string | null): URL | null {
  const url = parseUrl(candidate);
  if (!url) return null;
  if (url.protocol !== "ws:" && url.protocol !== "wss:") return null;
  if (url.pathname !== "/ws") return null;
  if (url.username || url.password || url.search || url.hash) return null;
  return url;
}

function parseLoopbackDashboardUrl(candidate?: string | null): URL | null {
  const url = parseUrl(candidate);
  if (!url) return null;
  if (url.protocol !== "http:" && url.protocol !== "https:") return null;
  if (!isLoopbackHostname(url.hostname)) return null;
  if (url.pathname !== "/dashboard/") return null;
  if (url.username || url.password || url.search || url.hash) return null;
  return url;
}

function parseUrl(candidate?: string | null): URL | null {
  const normalized = candidate?.trim();
  if (!normalized) return null;
  try {
    return new URL(normalized);
  } catch {
    return null;
  }
}

function isLoopbackHostname(hostname: string): boolean {
  const normalized = hostname.toLowerCase();
  return normalized === "localhost"
    || normalized === "127.0.0.1"
    || normalized === "[::1]"
    || normalized === "::1";
}

function buildEnvironment(): ImportMetaEnv | undefined {
  return import.meta.env as ImportMetaEnv | undefined;
}
