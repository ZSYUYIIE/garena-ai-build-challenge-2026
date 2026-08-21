import assert from "node:assert/strict";
import test from "node:test";

import { TabSpeechDecision } from "../src/sidepanel/realtime/tabSpeechDecision.ts";

test("requires two positive frames in a rolling three-frame window", () => {
  const decision = new TabSpeechDecision();
  assert.equal(decision.push(0.92, 32).active, false);
  assert.equal(decision.push(0.10, 64).active, false);
  assert.deepEqual(decision.push(0.81, 96), {
    active: true,
    changed: true,
    stableNonSpeechMs: 0,
  });
});

test("opens for two 0.50 probability frames but not lower probabilities", () => {
  const belowThreshold = new TabSpeechDecision();
  assert.equal(belowThreshold.push(0.49, 32).active, false);
  assert.equal(belowThreshold.push(0.49, 64).active, false);
  assert.equal(belowThreshold.push(0.49, 96).active, false);

  const atThreshold = new TabSpeechDecision();
  assert.equal(atThreshold.push(0.50, 32).active, false);
  assert.equal(atThreshold.push(0.10, 64).active, false);
  assert.deepEqual(atThreshold.push(0.50, 96), {
    active: true,
    changed: true,
    stableNonSpeechMs: 0,
  });
});

test("keeps sustained low-probability non-speech inactive", () => {
  const decision = new TabSpeechDecision();
  for (let frame = 1; frame <= 40; frame += 1) {
    assert.equal(decision.push(0.12, frame * 32).active, false);
  }
});

test("holds through uncertainty and closes after 500 ms below the negative threshold", () => {
  const decision = new TabSpeechDecision();
  decision.push(0.80, 32);
  decision.push(0.76, 64);
  assert.equal(decision.push(0.50, 96).active, true);
  for (let frame = 4; frame < 19; frame += 1) {
    assert.equal(decision.push(0.10, frame * 32).active, true);
  }
  assert.deepEqual(decision.push(0.10, 19 * 32), {
    active: false,
    changed: true,
    stableNonSpeechMs: 512,
  });
});

test("reports stable non-speech before speech has ever opened", () => {
  const decision = new TabSpeechDecision();
  let result = decision.push(0.10, 32);
  for (let frame = 2; frame <= 17; frame += 1) {
    result = decision.push(0.10, frame * 32);
  }
  assert.equal(result.active, false);
  assert.equal(result.stableNonSpeechMs, 512);
});

test("rejects invalid probabilities and non-monotonic frame clocks", () => {
  const decision = new TabSpeechDecision();
  assert.throws(() => decision.push(Number.NaN, 32), /probability/i);
  decision.push(0.1, 64);
  assert.throws(() => decision.push(0.1, 63), /monotonic/i);
});
