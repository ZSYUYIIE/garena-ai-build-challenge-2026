import assert from "node:assert/strict";
import test from "node:test";

import {
  analyzeVisionFrame,
  buildAnalysisPrompt,
} from "../src/gemini/vision.js";
import { visibleStateSchema } from "../src/gemini/visualState.js";

test("visible state parsing collapses internal whitespace without changing display case", () => {
  assert.deepEqual(visibleStateSchema.parse({
    domain: "sports_score",
    identity: "  Team A\n  vs   Team B  ",
    value: "  2 - 1  ",
    summary: " Team A\n\n leads   2 - 1. ",
  }), {
    domain: "sports_score",
    identity: "Team A vs Team B",
    value: "2 - 1",
    summary: "Team A leads 2 - 1.",
  });
});

test("buildAnalysisPrompt binds narration to the exact frame", () => {
  const prompt = buildAnalysisPrompt({
    initial: false,
    narrationLevel: "standard",
    previousDescription: "A document editor is visible.",
    priorVisibleStates: [{
      domain: "sports_score",
      identity: "Team A vs Team B",
      value: "1-1",
      summary: "The score is 1-1.",
    }],
    recentTabTranscript: "Commentator: Team A has taken a 2-1 lead.",
    timestampSeconds: 222,
  });

  assert.match(prompt, /exact attached image/i);
  assert.match(prompt, /do not infer a tutorial topic/i);
  assert.match(prompt, /StreamSense interface/i);
  assert.match(prompt, /03:42/);
  assert.match(prompt, /A document editor is visible/);
  assert.match(prompt, /captured-tab context/i);
  assert.match(prompt, /not user speech/i);
  assert.match(prompt, /suppress or corroborate/i);
  assert.match(prompt, /cannot justify unseen visual claims/i);
  assert.match(prompt, /score:2-1/i);
  assert.match(prompt, /routine.*motion.*caption churn/i);
  assert.match(prompt, /materially different.*section/i);
  assert.match(prompt, /comments.*results.*product details/i);
  assert.match(prompt, /goal.*score.*winner announcement/i);
  assert.match(prompt, /do not claim.*user.*scrolled|do not say.*user.*scrolled/i);
  assert.match(prompt, /domain.*identity/i);
  assert.match(prompt, /static score.*score_visible/i);
  assert.match(prompt, /Team A vs Team B/);
  assert.match(prompt, /"value":"1-1"/);
  assert.match(prompt, /description must be empty when shouldNarrate is false/i);
  assert.match(prompt, /Team A has taken a 2-1 lead/);
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
                  semanticKey: null,
                  importance: 0,
                  isNew: false,
                  coveredByTabSpeech: false,
                  event: null,
                  visibleState: null,
                  eventEvidence: null,
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
    recentTabTranscript: "x".repeat(2_100),
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
  assert.deepEqual(requestBody.response_format.schema.required, [
    "shouldNarrate",
    "description",
    "semanticKey",
    "importance",
    "isNew",
    "coveredByTabSpeech",
    "event",
    "visibleState",
    "eventEvidence",
  ]);
  assert.equal(
    requestBody.response_format.schema.properties.visibleState.anyOf[0]
      .properties.domain.pattern,
    "^[a-z0-9]+(?:_[a-z0-9]+)*$",
  );
  assert.equal(
    requestBody.response_format.schema.properties.visibleState.anyOf[0]
      .properties.summary.maxLength,
    300,
  );
  assert.deepEqual(
    requestBody.response_format.schema.properties.eventEvidence.anyOf[0]
      .properties.basis.enum,
    ["current_frame", "state_transition"],
  );
  assert.equal(requestBody.input[0].text.includes("x".repeat(2_000)), true);
  assert.equal(requestBody.input[0].text.includes("x".repeat(2_001)), false);
  assert.deepEqual(requestBody.generation_config, {
    max_output_tokens: 512,
    thinking_level: "minimal",
  });
  assert.equal(requestBody.store, false);
  assert.equal(requestSignal, controller.signal);
});

test("analyzeVisionFrame rejects invalid semantic narration approvals", async (t) => {
  const originalFetch = globalThis.fetch;
  t.after(() => {
    globalThis.fetch = originalFetch;
  });

  for (const result of [
    {
      shouldNarrate: false,
      description: "",
      semanticKey: null,
      importance: 1.01,
      isNew: false,
      coveredByTabSpeech: false,
      event: null,
      visibleState: null,
      eventEvidence: null,
    },
    {
      shouldNarrate: true,
      description: "The score changes to 2-1.",
      semanticKey: null,
      importance: 0.9,
      isNew: true,
      coveredByTabSpeech: false,
      event: null,
      visibleState: null,
      eventEvidence: null,
    },
    {
      shouldNarrate: true,
      description: "The score changes to 2-1.",
      semanticKey: "score:2-1",
      importance: 0.9,
      isNew: true,
      coveredByTabSpeech: true,
      event: null,
      visibleState: null,
      eventEvidence: null,
    },
  ]) {
    globalThis.fetch = async () => new Response(
      JSON.stringify({
        steps: [{
          type: "model_output",
          content: [{ type: "text", text: JSON.stringify(result) }],
        }],
      }),
      { status: 200, headers: { "content-type": "application/json" } },
    );

    await assert.rejects(
      analyzeVisionFrame({
        apiKey: "test-key",
        model: "gemini-3.6-flash",
        frame: { mimeType: "image/jpeg", data: "sports-frame" },
        initial: false,
        narrationLevel: "standard",
        previousDescription: "The scoreboard shows 1-1.",
        recentTabTranscript: "Commentary mentions the equalizer.",
        timestampSeconds: 10,
      }),
      /semanticKey|importance|coveredByTabSpeech/i,
    );
  }
});

test("analyzeVisionFrame enforces visible state and event evidence relationships", async (t) => {
  const originalFetch = globalThis.fetch;
  t.after(() => {
    globalThis.fetch = originalFetch;
  });

  const currentState = {
    domain: "sports_score",
    identity: "Team A vs Team B",
    value: "2-1",
    summary: "Team A leads Team B 2-1.",
  };
  const previousState = {
    ...currentState,
    value: "1-1",
    summary: "The score is 1-1.",
  };
  const event = {
    eventType: "score_changed",
    entities: ["Team A", "Team B"],
    description: "The score changes to 2-1.",
    importance: 0.9,
    confidence: 0.95,
  };
  const base = {
    shouldNarrate: false,
    description: "",
    semanticKey: null,
    importance: 0.9,
    isNew: true,
    coveredByTabSpeech: false,
    event,
    visibleState: currentState,
    eventEvidence: { basis: "state_transition", previousState },
  };

  for (const result of [
    { ...base, eventEvidence: null },
    {
      ...base,
      eventEvidence: { basis: "state_transition", previousState: null },
    },
    {
      ...base,
      eventEvidence: { basis: "current_frame", previousState },
    },
    {
      ...base,
      visibleState: { ...currentState, domain: "Sports Score" },
    },
    {
      ...base,
      visibleState: { ...currentState, identity: "x".repeat(161) },
    },
  ]) {
    globalThis.fetch = async () => new Response(
      JSON.stringify({
        steps: [{
          type: "model_output",
          content: [{ type: "text", text: JSON.stringify(result) }],
        }],
      }),
      { status: 200, headers: { "content-type": "application/json" } },
    );

    await assert.rejects(
      analyzeVisionFrame({
        apiKey: "test-key",
        model: "gemini-3.6-flash",
        frame: { mimeType: "image/jpeg", data: "sports-frame" },
        initial: false,
        narrationLevel: "standard",
        priorVisibleStates: [previousState],
        recentTabTranscript: "",
        timestampSeconds: 10,
      }),
      /eventEvidence|previousState|domain|identity/i,
    );
  }
});
