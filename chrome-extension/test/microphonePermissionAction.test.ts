import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("denied microphone state exposes a labeled permission action", async () => {
  const source = await readFile(
    new URL("../src/sidepanel/components/QuestionSection.tsx", import.meta.url),
    "utf8",
  );

  assert.match(source, /Allow microphone access/);
  assert.match(source, /Retry microphone/);
  assert.match(source, /onClick=\{onEnableVoice\}/);
  assert.match(source, /const voiceRetryEnabled = canEnableVoice/);
});
