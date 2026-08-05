import assert from "node:assert/strict";
import test from "node:test";

import type { LiveProviderState } from "../src/sidepanel/realtime/types.ts";
import {
  canAskRealtime,
  dispatchTypedQuestion,
  draftAfterAdmission,
  questionAvailabilityFor,
  questionCopyFor,
  retryableAnswerNotice,
  voiceQuestionStatusFor,
} from "../src/sidepanel/realtime/typedQuestion.ts";

test("admits typed questions only after handshake and Live readiness", () => {
  assert.equal(questionAvailabilityFor("idle", false, "closed"), "stopped");
  assert.equal(questionAvailabilityFor("connected", true, "connecting"), "connecting");
  assert.equal(questionAvailabilityFor("connected", true, "ready"), "ready");
  assert.equal(questionAvailabilityFor("connected", true, "degraded"), "degraded");
  assert.equal(canAskRealtime("connecting", false, "connecting"), false);
  assert.equal(canAskRealtime("connected", true, "connecting"), false);
  assert.equal(canAskRealtime("connected", true, "ready"), true);
  assert.equal(canAskRealtime("connected", true, "degraded"), false);
  assert.equal(canAskRealtime("connected", true, "closed"), false);
});

test("provides reason-aware question copy", () => {
  assert.deepEqual(questionCopyFor("stopped"), {
    placeholder: "Start StreamSense to ask a question",
    statusText: null,
  });
  assert.deepEqual(questionCopyFor("connecting"), {
    placeholder: "Gemini is connecting…",
    statusText: "Gemini is connecting — questions will unlock when ready",
  });
  assert.deepEqual(questionCopyFor("degraded"), {
    placeholder: "Gemini is reconnecting…",
    statusText: "Gemini is reconnecting — questions are temporarily paused",
  });
  assert.deepEqual(questionCopyFor("ready"), {
    placeholder: "Ask a question...",
    statusText: null,
  });
  assert.equal(
    voiceQuestionStatusFor("degraded", "ready"),
    "Voice unavailable — typed questions still work",
  );
  assert.equal(
    voiceQuestionStatusFor("degraded", "degraded"),
    "Gemini is reconnecting — questions are temporarily paused",
  );
});

test("preserves a draft when admission is refused", () => {
  assert.equal(draftAfterAdmission("  What happened?  ", false), "  What happened?  ");
  assert.equal(draftAfterAdmission("  What happened?  ", true), "");
});

test("surfaces only retryable answer failures", () => {
  assert.equal(
    retryableAnswerNotice("answer", true, true),
    "Gemini could not complete this answer. Ask again when Live is ready.",
  );
  assert.equal(retryableAnswerNotice("answer", false, true), null);
  assert.equal(retryableAnswerNotice("narration", true, true), null);
  assert.equal(retryableAnswerNotice("answer", true, false), null);
});

test("does not send after readiness disappears during frame capture", async () => {
  let releaseFrame: () => void = () => undefined;
  const frameReady = new Promise<void>((resolve) => { releaseFrame = resolve; });
  let liveState: LiveProviderState = "ready";
  let sendCalls = 0;
  let unavailableCalls = 0;
  const dispatch = dispatchTypedQuestion({
    waitForFrame: () => frameReady,
    isReady: () => canAskRealtime("connected", true, liveState),
    send: () => { sendCalls += 1; },
    onUnavailable: () => { unavailableCalls += 1; },
  });
  liveState = "connecting";
  releaseFrame();

  assert.equal(await dispatch, false);
  assert.equal(sendCalls, 0);
  assert.equal(unavailableCalls, 1);
});
