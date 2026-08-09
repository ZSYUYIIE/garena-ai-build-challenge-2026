import assert from "node:assert/strict";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import react from "@vitejs/plugin-react";
import { createServer } from "vite";

test("latest description is an accessible collapsed accordion by default", async () => {
  const vite = await createServer({
    configFile: false,
    root: process.cwd(),
    appType: "custom",
    plugins: [react()],
    resolve: { alias: { "@": fileURLToPath(new URL("../src", import.meta.url)) } },
    server: { middlewareMode: true },
  });

  try {
    const module = await vite.ssrLoadModule(
      "/src/sidepanel/components/VideoDescriptionSection.tsx",
    ) as {
      VideoDescriptionSection: (props: {
        description: string;
        statusText: string;
        error: string | null;
        isRunning: boolean;
        isSpeaking: boolean;
      }) => ReturnType<typeof createElement>;
    };
    const markup = renderToStaticMarkup(createElement(module.VideoDescriptionSection, {
      description: "A scoreboard is visible.",
      statusText: "Connected to Gemini.",
      error: null,
      isRunning: true,
      isSpeaking: false,
    }));

    assert.match(markup, /<button\b[^>]*aria-expanded="false"/);
    assert.match(markup, /aria-controls=/);
    assert.match(markup, />Latest description</);
    assert.match(markup, />A scoreboard is visible\.</);
    assert.doesNotMatch(markup, /border-t border-border px-3/);
    assert.match(markup, /class="sr-only" role="status">Connected to Gemini\./);
  } finally {
    await vite.close();
  }
});
