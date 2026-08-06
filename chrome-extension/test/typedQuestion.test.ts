import assert from "node:assert/strict";
import test from "node:test";

import type { LiveProviderState } from "../src/sidepanel/realtime/types.ts";
import { createMediaSocketProtocol } from "../src/sidepanel/realtime/mediaAudio.ts";
import { createMicrophoneTurnOwnership } from "../src/sidepanel/realtime/sessionLifecycle.ts";
import {
  canAskRealtime,
  dispatchTypedQuestion,
  draftAfterAdmission,
  isEditableShortcutTarget,
  isVoiceHoldShortcut,
  questionAvailabilityFor,
  questionCopyFor,
  retireMicrophoneBeforeTypedAdmission,
  retryableAnswerNotice,
  voiceQuestionStatusFor,
} from "../src/sidepanel/realtime/typedQuestion.ts";

test("recognizes unmodified S as the hold-to-talk shortcut", () => {
  const shortcut = {
    altKey: false,
    shiftKey: false,
    ctrlKey: false,
    metaKey: false,
    code: "KeyS",
  };
  assert.equal(isVoiceHoldShortcut(shortcut), true);
  assert.equal(isVoiceHoldShortcut({ ...shortcut, altKey: true }), false);
  assert.equal(isVoiceHoldShortcut({ ...shortcut, code: "KeyQ" }), false);
});

test("does not capture the voice shortcut while editing text", () => {
  assert.equal(isEditableShortcutTarget(null), false);
  assert.equal(isEditableShortcutTarget({ tagName: "DIV" } as unknown as EventTarget), false);
  assert.equal(isEditableShortcutTarget({ tagName: "input" } as unknown as EventTarget), true);
  assert.equal(isEditableShortcutTarget({ isContentEditable: true } as unknown as EventTarget), true);
});

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
    voiceQuestionStatusFor("degraded", "ready", "denied"),
    "Microphone permission denied — allow access, then select the microphone",
  );
  assert.equal(
    voiceQuestionStatusFor("degraded", "ready", "degraded"),
    "Microphone unavailable — select the microphone to retry",
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

test("retires microphone transport before admitting a typed turn", () => {
  const order: string[] = [];

  assert.equal(retireMicrophoneBeforeTypedAdmission(
    () => { order.push("microphone:end"); return "retired"; },
    () => { order.push("typed:admit"); },
  ), true);
  assert.deepEqual(order, ["microphone:end", "typed:admit"]);

  order.length = 0;
  assert.equal(retireMicrophoneBeforeTypedAdmission(
    () => { order.push("microphone:failed"); return "transport_failed"; },
    () => { order.push("typed:admit"); },
  ), false);
  assert.deepEqual(order, ["microphone:failed"]);
});

test("sends mic end before typed admission, drops stale PCM, and opens a fresh mic turn", () => {
  const firstTurnId = "11111111-1111-4111-8111-111111111111";
  const typedTurnId = "22222222-2222-4222-8222-222222222222";
  const freshTurnId = "33333333-3333-4333-8333-333333333333";
  const turnIds = [firstTurnId, freshTurnId];
  const sent: Array<string | ArrayBuffer> = [];
  const protocol = createMediaSocketProtocol(
    (value) => sent.push(value),
    () => turnIds.shift()!,
  );
  const ownership = createMicrophoneTurnOwnership<{
    turnId: string;
    packets: Array<{ pcm: Int16Array; timestampMs: number }>;
    bytes: number;
  }>();
  const first = { turnId: firstTurnId, packets: [], bytes: 0 };
  const fresh = { turnId: freshTurnId, packets: [], bytes: 0 };
  protocol.open({ tabAudioState: "absent", microphoneState: "ready" });
  ownership.claim(first);
  assert.equal(protocol.startUserActivity(), firstTurnId);
  assert.equal(protocol.sendMicrophone(new Int16Array([1, 2]), 10), true);

  assert.equal(retireMicrophoneBeforeTypedAdmission(
    () => {
      const retired = ownership.retire();
      if (!retired) return "none";
      return protocol.cancelUserActivity() === false ? "transport_failed" : "retired";
    },
    () => sent.push(JSON.stringify({ type: "typed_question", turnId: typedTurnId, text: "What changed?" })),
  ), true);
  if (ownership.isCurrent(first)) protocol.sendMicrophone(new Int16Array([9, 9]), 20);

  ownership.claim(fresh);
  assert.equal(protocol.startUserActivity(), freshTurnId);
  assert.equal(protocol.sendMicrophone(new Int16Array([3, 4]), 30), true);
  assert.equal(protocol.endUserActivity(), true);

  const commands = sent.filter((value): value is string => typeof value === "string").map(JSON.parse);
  assert.deepEqual(commands, [
    { type: "session_hello", protocolVersion: 2, tabAudioState: "absent", microphoneState: "ready" },
    { type: "user_activity_start", turnId: firstTurnId },
    { type: "user_activity_end", turnId: firstTurnId },
    { type: "typed_question", turnId: typedTurnId, text: "What changed?" },
    { type: "user_activity_start", turnId: freshTurnId },
    { type: "user_activity_end", turnId: freshTurnId },
  ]);
  assert.equal(sent.filter((value) => value instanceof ArrayBuffer).length, 2);
});
