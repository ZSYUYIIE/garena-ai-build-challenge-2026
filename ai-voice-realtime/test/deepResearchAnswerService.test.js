import assert from "node:assert/strict";
import test from "node:test";

import { GeminiInteractions } from "../src/gemini/interactions.js";
import { DeepResearchAnswerService } from "../src/research/deepResearchAnswerService.js";

test("Gemini interactions opt out of storage and parse finalized text and audio", async () => {
  let request;
  const interactions = new GeminiInteractions({
    apiKey: "gemini-test",
    fetchImpl: async (_url, options) => {
      request = options;
      return {
        ok: true,
        json: async () => ({ steps: [{
          type: "model_output",
          content: [
            { type: "text", text: "Final answer." },
            { type: "audio", data: "AQI=", mime_type: "audio/pcm;rate=24000" },
            { type: "audio", data: "AwQ=", mime_type: "audio/pcm;rate=24000" },
          ],
        }] }),
      };
    },
  });
  const payload = await interactions.create({ model: "gemini-3.6-flash", input: "question" });

  assert.equal(request.headers["x-goog-api-key"], "gemini-test");
  assert.equal(request.headers["Api-Revision"], "2026-05-20");
  assert.equal(JSON.parse(request.body).store, false);
  assert.equal(interactions.text(payload), "Final answer.");
  assert.deepEqual(interactions.audio(payload), { data: "AQIDBA==", mimeType: "audio/pcm;rate=24000" });
});

test("finalizes Exa research and prepares a source-free Live voice summary", async () => {
  const calls = [];
  const progress = [];
  const interactions = {
    async create(body) {
      calls.push(body);
      if (String(body.input).startsWith("Rewrite")) return { kind: "query" };
      return { kind: "answer" };
    },
    text(payload) {
      return payload.kind === "query"
        ? "California Open current standings"
        : "Joe Edley leads the displayed standings [1].\n\n### Sources\nThis model-added list is discarded.";
    },
  };
  const exa = {
    async search(query, { onProgress }) {
      assert.equal(query, "California Open current standings");
      onProgress({ stage: "search", status: "active" });
      onProgress({ stage: "review", status: "completed" });
      return { sources: [{ index: 1, title: "Example", url: "https://example.com", excerpt: "Standings evidence." }] };
    },
  };
  const service = new DeepResearchAnswerService({ interactions, exa });

  const result = await service.answer("Who is leading?", {
    screenContext: "California Open standings are visible.",
    onProgress: (event) => progress.push(event),
  });

  assert.match(result.answer, /Joe Edley leads/);
  assert.equal(result.summary, "Joe Edley leads the displayed standings [1].");
  assert.equal(result.voiceSummary, "Joe Edley leads the displayed standings.");
  assert.equal(result.answer, "Joe Edley leads the displayed standings [1].\n\n## Sources\n\n1. [Example](https://example.com)");
  assert.equal(calls.length, 2);
  assert.equal(calls[0].model, "gemini-3.6-flash");
  assert.equal(calls[0].generation_config.max_output_tokens, 512);
  assert.equal(calls[1].model, "gemini-3.6-flash");
  assert.equal(calls[1].generation_config.max_output_tokens, 2_048);
  assert.equal(progress.at(-1).status, "active");
  assert.match(progress.at(-1).detail, /final answer/i);
});

test("transcribes a Deep Research microphone question outside Gemini Live", async () => {
  let request;
  const interactions = {
    async create(body) {
      request = body;
      return { kind: "transcript" };
    },
    text() {
      return "Who is leading the California Open?";
    },
  };
  const service = new DeepResearchAnswerService({ interactions, exa: {} });

  const transcript = await service.transcribeMicrophone(Buffer.from([1, 2, 3, 4]));

  assert.equal(transcript, "Who is leading the California Open?");
  assert.equal(request.model, "gemini-3.6-flash");
  assert.equal(request.input[1].type, "audio");
  assert.equal(request.input[1].mime_type, "audio/wav");
  const wav = Buffer.from(request.input[1].data, "base64");
  assert.equal(wav.toString("ascii", 0, 4), "RIFF");
  assert.equal(wav.toString("ascii", 8, 12), "WAVE");
  assert.equal(wav.readUInt16LE(20), 1);
  assert.equal(wav.readUInt16LE(22), 1);
  assert.equal(wav.readUInt32LE(24), 16_000);
  assert.equal(wav.readUInt16LE(34), 16);
  assert.equal(wav.readUInt32LE(40), 4);
  assert.deepEqual(wav.subarray(44), Buffer.from([1, 2, 3, 4]));
});
