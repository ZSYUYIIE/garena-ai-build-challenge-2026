import assert from "node:assert/strict";
import test from "node:test";

import { buildAnalysisPrompt } from "../src/gemini/vision.js";
import { shouldSuppressVisualDescription } from "../src/gemini/transcript.js";

test("vision prompt requires scene-first audio description instead of page metadata", () => {
  const prompt = buildAnalysisPrompt({
    initial: true,
    narrationLevel: "standard",
    priorVisibleStates: [],
    timestampSeconds: 0,
  });

  assert.match(prompt, /blind or low-vision listener/i);
  assert.match(prompt, /visible subjects and action/i);
  assert.match(prompt, /people or animals.*counts.*spatial relationships/i);
  assert.match(prompt, /do not say.*YouTube page.*video page/i);
  assert.match(prompt, /Two adult owls and three chicks feed on prey/i);
  assert.match(prompt, /event\.description must obey this scene-first rule/i);
  assert.match(prompt, /score.*secondary context/i);
  assert.match(prompt, /formation.*possession.*off-ball action/i);
});

test("wrapper-only page and title descriptions are rejected deterministically", () => {
  for (const description of [
    "A YouTube video page is displayed, featuring a video of a bear titled Rare Wildlife of China's Mountains.",
    "A browser page is shown with a video titled Hidden Kingdoms.",
    "The video is titled Rare Wildlife and is displayed in a media player.",
  ]) {
    assert.equal(shouldSuppressVisualDescription(description), true, description);
  }
});

test("scene-first descriptions and useful action-plus-score context remain eligible", () => {
  for (const description of [
    "Two adult owls and three chicks feed on prey on a patch of snow.",
    "Three attackers enter the penalty area while two defenders retreat; the score remains 1-1.",
    "A bear climbs a steep snowy slope beneath a line of pine trees.",
  ]) {
    assert.equal(shouldSuppressVisualDescription(description), false, description);
  }
});
