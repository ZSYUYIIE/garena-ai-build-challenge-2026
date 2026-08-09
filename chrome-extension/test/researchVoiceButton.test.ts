import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("completed research answers expose a manual Gemini Live voice control", async () => {
  const source = await readFile(
    new URL("../src/sidepanel/components/QuestionSection.tsx", import.meta.url),
    "utf8",
  );

  assert.match(source, /Debug: Play with Gemini Live/);
  assert.match(source, /disabled=\{!canPlayResearchVoice\}/);
  assert.match(source, /onPlayResearchVoice/);
});
