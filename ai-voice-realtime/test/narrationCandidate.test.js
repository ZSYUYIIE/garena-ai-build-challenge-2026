import assert from "node:assert/strict";
import test from "node:test";

import { buildModeNarrationCandidate } from "../src/session/narrationCandidate.js";

const recordedEvent = {
  id: "event-1",
  sessionId: "123e4567-e89b-42d3-a456-426614174000",
  timestamp: "00:10",
  timestampSeconds: 10,
  eventType: "score_changed",
  entities: ["Blue", "Red"],
  description: "The score is now 2-1.",
  importance: 0.8,
  confidence: 0.9,
};

const smartAnalysis = {
  shouldNarrate: true,
  isNew: true,
  coveredByTabSpeech: false,
  importance: 0.85,
  description: "Blue takes a 2-1 lead.",
  semanticKey: "score:2-1",
};

function build(overrides = {}) {
  return buildModeNarrationCandidate({
    voiceNarrationMode: "smart",
    narrationLevel: "standard",
    offerCandidate: true,
    persistenceStatus: "recorded",
    recordedEvent,
    analysis: smartAnalysis,
    createdAtMs: 100,
    ...overrides,
  });
}

test("Smart uses the approved atomic narration only after event recording", () => {
  assert.deepEqual(build(), {
    description: "Blue takes a 2-1 lead.",
    semanticKey: "score:2-1",
    importance: 0.85,
    createdAtMs: 100,
    smartEligible: true,
  });
  assert.equal(build({ persistenceStatus: "duplicate" }), null);
  assert.equal(build({ offerCandidate: false }), null);
});

test("Smart rejects commentary-covered and low-importance narration", () => {
  assert.equal(build({
    analysis: { ...smartAnalysis, coveredByTabSpeech: true },
  }), null);
  assert.equal(build({
    analysis: { ...smartAnalysis, importance: 0.59 },
  }), null);
});

test("always-narrate modes speak the recorded timeline event", () => {
  const analysis = {
    ...smartAnalysis,
    shouldNarrate: false,
    isNew: false,
    importance: 0.2,
    description: "",
    semanticKey: null,
  };

  for (const voiceNarrationMode of ["over_audio", "narration_only"]) {
    assert.deepEqual(build({ voiceNarrationMode, analysis }), {
      description: "The score is now 2-1.",
      semanticKey: "score_changed:the-score-is-now-2-1",
      importance: 0.8,
      createdAtMs: 100,
      smartEligible: false,
    });
  }
});

test("always-narrate mode retains Smart eligibility for later mode changes", () => {
  assert.deepEqual(build({ voiceNarrationMode: "over_audio" }), {
    description: "The score is now 2-1.",
    semanticKey: "score:2-1",
    importance: 0.8,
    createdAtMs: 100,
    smartEligible: true,
  });
});

test("Question only suppresses voice without suppressing timeline recording", () => {
  assert.equal(build({
    voiceNarrationMode: "narration_only",
    narrationLevel: "question_only",
  }), null);
});

test("candidate selection rejects missing recorded event text and invalid clocks", () => {
  assert.equal(build({ recordedEvent: null }), null);
  assert.equal(build({ recordedEvent: { ...recordedEvent, description: " " } }), null);
  assert.equal(build({ createdAtMs: -1 }), null);
});
