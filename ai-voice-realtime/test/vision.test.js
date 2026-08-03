import assert from "node:assert/strict";
import test from "node:test";

import { buildAnalysisPrompt } from "../src/gemini/vision.js";

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
