import test from "node:test";
import assert from "node:assert/strict";

import {
  NORMAL_DEMO_RESPONSES,
  normalDemoAnswerForQuestion,
} from "../src/demo/normalDemoScript.js";

test("matches the two Normal-mode demo questions despite harmless speech punctuation", () => {
  assert.equal(
    normalDemoAnswerForQuestion("What's happening right now?"),
    NORMAL_DEMO_RESPONSES.whatsHappening,
  );
  assert.equal(
    normalDemoAnswerForQuestion("WHAT IS HAPPENING RIGHT NOW"),
    NORMAL_DEMO_RESPONSES.whatsHappening,
  );
  assert.equal(
    normalDemoAnswerForQuestion("How did they score?"),
    NORMAL_DEMO_RESPONSES.howTheyScored,
  );
});

test("does not intercept the Deep Research demo question", () => {
  assert.equal(
    normalDemoAnswerForQuestion("Who is World Cup 2026 number 4 on England?"),
    null,
  );
});
