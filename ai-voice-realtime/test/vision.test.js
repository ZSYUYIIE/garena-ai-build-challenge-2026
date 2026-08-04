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

test("analyzeVisionFrame uses the Gemini Interactions contract", async (t) => {
  let requestUrl;
  let requestBody;
  let requestHeaders;
  let requestSignal;
  const originalFetch = globalThis.fetch;
  t.after(() => {
    globalThis.fetch = originalFetch;
  });
  globalThis.fetch = async (url, init) => {
    requestUrl = url;
    requestBody = JSON.parse(init.body);
    requestHeaders = new Headers(init.headers);
    requestSignal = init.signal;
    return new Response(
      JSON.stringify({
        id: "interaction-test",
        model: "gemini-3.6-flash",
        status: "completed",
        steps: [
          {
            type: "user_input",
            content: [{ type: "text", text: "request fixture" }],
          },
          {
            type: "model_output",
            content: [
              {
                type: "text",
                text: JSON.stringify({
                  shouldNarrate: false,
                  description: "",
                  event: null,
                }),
              },
            ],
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

  assert.equal(
    requestUrl,
    "https://generativelanguage.googleapis.com/v1beta/interactions"
  );
  assert.equal(requestHeaders.get("x-goog-api-key"), "test-key");
  assert.equal(requestHeaders.get("api-revision"), "2026-05-20");
  assert.equal(requestBody.model, "gemini-3.6-flash");
  assert.equal(requestBody.input[0].type, "text");
  assert.deepEqual(requestBody.input.slice(1), [
    { type: "image", data: "test-frame", mime_type: "image/jpeg" },
  ]);
  assert.equal(requestBody.response_format.type, "text");
  assert.equal(requestBody.response_format.mime_type, "application/json");
  assert.equal(requestBody.response_format.schema.type, "object");
  assert.deepEqual(requestBody.generation_config, {
    max_output_tokens: 512,
    thinking_level: "minimal",
  });
  assert.equal(requestBody.store, false);
  assert.equal(requestSignal, controller.signal);
});
