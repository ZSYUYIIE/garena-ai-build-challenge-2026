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
    "A VIDEO IS DISPLAYED FULL-SCREEN!",
    "the browser page is shown with a livestream called Hidden Kingdoms.",
  ]) {
    assert.equal(shouldSuppressVisualDescription(description), true, description);
  }
});

test("incidental wrapper wording does not suppress a visible scene", () => {
  for (const description of [
    "Two owls feed their chicks while the livestream is shown full-screen.",
    "Three players sprint into the box as the video page is shown on a stadium monitor.",
    "A livestream shows a bear climbing a snowy slope beneath pine trees.",
    "A YouTube video page is shown; two owls feed their chicks on snow.",
    "The video is titled Rare Wildlife as a bear climbs a steep slope.",
    "The livestream is shown full-screen while a bear climbs a snowy slope.",
    "A YouTube video page is displayed as two owls feed their chicks in the snow.",
    "A YouTube video page is shown with a video called Hidden Kingdoms. A bear climbs a snowy slope.",
    "A YouTube video page is shown with a video called Hidden Kingdoms because a bear climbs a snowy slope.",
    "A YouTube video page is shown with a video called Hidden Kingdoms showing a bear climbing a snowy slope.",
  ]) {
    assert.equal(shouldSuppressVisualDescription(description), false, description);
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
