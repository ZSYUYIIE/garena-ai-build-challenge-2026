import assert from "node:assert/strict";
import test from "node:test";

import {
  buildNarrationEventCandidate,
  isDescriptionCoveredByTranscript,
  mergeTranscriptChunk,
  shouldSuppressVisualDescription,
} from "../src/gemini/transcript.js";

test("mergeTranscriptChunk joins incremental audio transcription", () => {
  assert.equal(
    mergeTranscriptChunk("A player enters", "the penalty area."),
    "A player enters the penalty area."
  );
});

test("shouldSuppressVisualDescription blocks self-feedback and inferred actions", () => {
  assert.equal(
    shouldSuppressVisualDescription("A narration level menu is visible."),
    true
  );
  assert.equal(
    shouldSuppressVisualDescription("The user opened a dropdown menu."),
    true
  );
  assert.equal(
    shouldSuppressVisualDescription("Number nine enters the penalty area."),
    false
  );
});

test("mergeTranscriptChunk accepts cumulative transcription without duplication", () => {
  assert.equal(
    mergeTranscriptChunk("A player enters", "A player enters the penalty area."),
    "A player enters the penalty area."
  );
  assert.equal(
    mergeTranscriptChunk("A player enters the penalty area.", "the penalty area."),
    "A player enters the penalty area."
  );
});

test("buildNarrationEventCandidate creates an initial scene timeline item", () => {
  assert.deepEqual(
    buildNarrationEventCandidate("A document editor is visible.", { initial: true }),
    {
      eventType: "scene_observed",
      entities: [],
      description: "A document editor is visible.",
      importance: 0.35,
      confidence: 0.7,
    }
  );
});

test("captured speech suppresses only an already-grounded overlapping description", () => {
  assert.equal(
    isDescriptionCoveredByTranscript(
      "Three attackers enter the penalty area.",
      "The commentator says three attackers are entering the penalty area.",
    ),
    true,
  );
  assert.equal(
    isDescriptionCoveredByTranscript(
      "A Google document is visible.",
      "Now let us fold the wings of the paper airplane.",
    ),
    false,
  );
});
