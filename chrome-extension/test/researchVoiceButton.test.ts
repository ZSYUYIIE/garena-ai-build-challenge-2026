import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("completed research answers do not expose the removed debug voice control", async () => {
  const questionSection = await readFile(
    new URL("../src/sidepanel/components/QuestionSection.tsx", import.meta.url),
    "utf8",
  );
  const app = await readFile(
    new URL("../src/sidepanel/App.tsx", import.meta.url),
    "utf8",
  );

  assert.doesNotMatch(questionSection, /Debug: Play with Gemini Live/);
  assert.doesNotMatch(questionSection, /onPlayResearchVoice|canPlayResearchVoice/);
  assert.doesNotMatch(questionSection, /Tab speech context unavailable|automatic narration paused/);
  assert.doesNotMatch(app, /playResearchVoice|onPlayResearchVoice/);
});
