import assert from "node:assert/strict";
import test from "node:test";

import {
  analyzeVisionFrame,
  buildAnalysisPrompt,
} from "../src/gemini/vision.js";

test("buildAnalysisPrompt binds narration to the exact frame", () => {
  const prompt = buildAnalysisPrompt({
    initial: false,
    narrationLevel: "standard",
    previousDescription: "A document editor is visible.",
    timestampSeconds: 222,
  });

  assert.match(prompt, /exact attached image/i);
  assert.match(prompt, /do not infer a tutorial topic/i);
  assert.match(prompt, /StreamSense interface/i);
  assert.match(prompt, /03:42/);
  assert.match(prompt, /A document editor is visible/);
});

test("analyzeVisionFrame uses Gemini 3 request settings", async (t) => {
  let requestBody;
  let requestSignal;
  const originalFetch = globalThis.fetch;
  t.after(() => {
    globalThis.fetch = originalFetch;
  });
  globalThis.fetch = async (_url, init) => {
    requestBody = JSON.parse(init.body);
    requestSignal = init.signal;
    return new Response(
      JSON.stringify({
        candidates: [
          {
            content: {
              parts: [
                {
                  text: JSON.stringify({
                    shouldNarrate: false,
                    description: "",
                    event: null,
                  }),
                },
              ],
            },
          },
        ],
      }),
      { status: 200, headers: { "content-type": "application/json" } }
    );
  };

  const controller = new AbortController();
  await analyzeVisionFrame({
    apiKey: "test-key",
    model: "gemini-3.6-flash",
    frame: { mimeType: "image/jpeg", data: "test-frame" },
    initial: true,
    narrationLevel: "standard",
    previousDescription: "",
    timestampSeconds: 0,
    signal: controller.signal,
  });

  assert.deepEqual(requestBody.generationConfig.thinkingConfig, {
    thinkingLevel: "minimal",
  });
  assert.equal("temperature" in requestBody.generationConfig, false);
  assert.equal(requestSignal, controller.signal);
});
