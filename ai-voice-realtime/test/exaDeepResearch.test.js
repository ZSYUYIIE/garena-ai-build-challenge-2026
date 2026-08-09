import assert from "node:assert/strict";
import test from "node:test";

import { ExaDeepResearch } from "../src/research/exaDeepResearch.js";

test("searches Exa and reports bounded research stages without persistence", async () => {
  const requests = [];
  const progress = [];
  const research = new ExaDeepResearch({
    apiKey: "exa-test",
    fetchImpl: async (url, options) => {
      requests.push({ url, options });
      return {
        ok: true,
        json: async () => ({ results: [
          { title: "Example source", url: "https://example.com/report", highlights: ["Relevant evidence."] },
          { title: "Unsafe", url: "javascript:alert(1)", highlights: ["Ignore this."] },
        ] }),
      };
    },
  });

  const result = await research.search("latest tournament result", {
    onProgress: (event) => progress.push(event),
  });

  assert.equal(requests[0].url, "https://api.exa.ai/search");
  assert.equal(requests[0].options.headers["x-api-key"], "exa-test");
  assert.equal(JSON.parse(requests[0].options.body).type, "deep");
  assert.deepEqual(result.sources, [{
    index: 1,
    title: "Example source",
    url: "https://example.com/report",
    excerpt: "Relevant evidence.",
  }]);
  assert.deepEqual(progress.map(({ stage, status }) => ({ stage, status })), [
    { stage: "search", status: "active" },
    { stage: "search", status: "completed" },
    { stage: "review", status: "active" },
    { stage: "review", status: "completed" },
  ]);
});

test("fails closed when Deep Research is not configured", async () => {
  const research = new ExaDeepResearch();
  await assert.rejects(() => research.search("query"), /EXA_API_KEY/);
});
