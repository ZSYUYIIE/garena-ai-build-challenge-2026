import assert from "node:assert/strict";
import test from "node:test";

import { deepResearchDemoForQuestion } from "../src/demo/deepResearchDemo.js";
import { DeepResearchAnswerService } from "../src/research/deepResearchAnswerService.js";

test("matches the spoken Declan Rice Deep Research demo question", () => {
  assert.equal(deepResearchDemoForQuestion("Who is number 4 on England?")?.query,
    "England number 4 Declan Rice player profile");
  assert.equal(deepResearchDemoForQuestion("Who is number four on England?")?.query,
    "England number 4 Declan Rice player profile");
  assert.equal(deepResearchDemoForQuestion("Who is the England manager?"), null);
});

test("simulates the full research pipeline and returns the cited Declan Rice fixture", async () => {
  const progress = [];
  const service = new DeepResearchAnswerService({
    interactions: {
      async create() { throw new Error("Gemini must not run for the demo fixture."); },
    },
    exa: {
      async search() { throw new Error("Exa must not run for the demo fixture."); },
    },
    sleep: async () => {},
  });

  const result = await service.answer("Who is number 4 on England?", {
    onProgress: (event) => progress.push(event),
  });

  assert.match(result.answer, /^Declan Rice is an English professional footballer/);
  assert.match(result.answer, /## Sources/);
  assert.match(result.answer, /Arsenal\.com/);
  assert.equal(result.sources.length, 5);
  assert.doesNotMatch(result.voiceSummary, /\[\d/);
  assert.deepEqual(progress.map(({ stage, status }) => `${stage}:${status}`), [
    "understand:active",
    "understand:completed",
    "search:active",
    "search:completed",
    "review:active",
    "review:completed",
    "synthesize:active",
  ]);
});
