import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import react from "@vitejs/plugin-react";
import { createServer } from "vite";

import {
  DEFAULT_BACKEND_WEBSOCKET_URL,
  configuredBackendWebSocketUrl,
  deriveDashboardUrlFromWebSocket,
  resolveBackendWebSocketUrl,
  resolveDashboardUrl,
} from "../src/services/backendUrls.ts";
import { openHistoryDashboard } from "../src/services/historyNavigation.ts";

test("derives the dashboard HTTP URL from a validated backend WebSocket URL", () => {
  assert.equal(
    deriveDashboardUrlFromWebSocket("ws://127.0.0.1:8000/ws"),
    "http://127.0.0.1:8000/dashboard/",
  );
  assert.equal(
    deriveDashboardUrlFromWebSocket("wss://backend.example:9443/ws"),
    "https://backend.example:9443/dashboard/",
  );
});

test("uses the default WebSocket URL when configuration is missing or unsafe", () => {
  assert.equal(resolveBackendWebSocketUrl(), DEFAULT_BACKEND_WEBSOCKET_URL);
  assert.equal(resolveBackendWebSocketUrl("  "), DEFAULT_BACKEND_WEBSOCKET_URL);
  assert.equal(resolveBackendWebSocketUrl("https://127.0.0.1:8000/ws"), DEFAULT_BACKEND_WEBSOCKET_URL);
  assert.equal(resolveBackendWebSocketUrl("ws://127.0.0.1:8000/not-ws"), DEFAULT_BACKEND_WEBSOCKET_URL);
  assert.equal(resolveBackendWebSocketUrl("ws://user@127.0.0.1:8000/ws"), DEFAULT_BACKEND_WEBSOCKET_URL);
  assert.equal(resolveBackendWebSocketUrl("ws://127.0.0.1:8000/ws?token=secret"), DEFAULT_BACKEND_WEBSOCKET_URL);
  assert.equal(resolveBackendWebSocketUrl("not a URL"), DEFAULT_BACKEND_WEBSOCKET_URL);
  assert.equal(configuredBackendWebSocketUrl(), DEFAULT_BACKEND_WEBSOCKET_URL);
});

test("accepts only an exact loopback HTTP dashboard override", () => {
  const webSocketUrl = "wss://backend.example/ws";

  assert.equal(
    resolveDashboardUrl({
      dashboardUrl: "http://127.0.0.1:5174/dashboard/",
      webSocketUrl,
    }),
    "http://127.0.0.1:5174/dashboard/",
  );
  assert.equal(
    resolveDashboardUrl({
      dashboardUrl: "https://localhost/dashboard/",
      webSocketUrl,
    }),
    "https://localhost/dashboard/",
  );

  for (const dashboardUrl of [
    "javascript:alert(1)",
    "https://example.com/dashboard/",
    "http://127.0.0.1:5174/",
    "http://127.0.0.1:5174/dashboard",
    "http://user@127.0.0.1:5174/dashboard/",
    "http://127.0.0.1:5174/dashboard/?token=secret",
  ]) {
    assert.equal(
      resolveDashboardUrl({ dashboardUrl, webSocketUrl }),
      "https://backend.example/dashboard/",
    );
  }
});

test("opens the resolved dashboard in a normal Chrome tab", async () => {
  const calls: Array<{ url: string }> = [];

  await openHistoryDashboard(
    (properties) => {
      calls.push(properties);
    },
    resolveDashboardUrl({
      dashboardUrl: "http://127.0.0.1:5174/dashboard/",
      webSocketUrl: "ws://127.0.0.1:8000/ws",
    }),
  );

  assert.deepEqual(calls, [{ url: "http://127.0.0.1:5174/dashboard/" }]);
});

test("renders View History as a native keyboard-accessible labeled button", async () => {
  const vite = await createServer({
    configFile: false,
    root: process.cwd(),
    appType: "custom",
    plugins: [react()],
    server: { middlewareMode: true },
  });

  try {
    const module = await vite.ssrLoadModule(
      "/src/sidepanel/components/HistoryNavigation.tsx",
    ) as {
      HistoryNavigation: () => ReturnType<typeof createElement>;
    };
    const markup = renderToStaticMarkup(createElement(module.HistoryNavigation));

    assert.match(markup, /<button\b[^>]*\btype="button"/);
    assert.match(
      markup,
      /\baria-label="View StreamSense history in a new tab"/,
    );
    assert.match(markup, />View History</);
  } finally {
    await vite.close();
  }
});
