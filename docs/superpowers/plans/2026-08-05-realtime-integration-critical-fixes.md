# StreamSense Critical Realtime Integration Fixes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Repair the production-cadence microphone VAD failure and the three provider ownership, retry, and readiness failures without changing StreamSense's protocol or source-separated audio architecture.

**Architecture:** Make four focused state-machine corrections: freeze VAD noise adaptation during a speech candidate, poison and hard-reconnect an ambiguously written Gemini Live generation, reset Cloud STT retry attempts only after provider evidence, and gate typed questions on existing Live provider health. Every repair starts with a regression test, preserves exactly-once turn settlement, and never automatically replays ambiguous user input.

**Tech Stack:** TypeScript 5.9, React 19, Chrome Manifest V3, Web Audio API and AudioWorklet, Node.js ESM and built-in test runner, Vite 8, `@google/genai` 2.15.0, `@google-cloud/speech` 7.5.0, WebSocket protocol v2

## Global Constraints

- Implement only the approved P0/P1 repairs; do not fold in the P2 input-length, question-rate, or frame-rate-limit findings.
- Preserve backend-mediated open microphone, explicit manual Live activity boundaries, and immediate barge-in playback clearing.
- Microphone PCM remains the only raw conversational audio sent to Gemini Live.
- Captured-tab PCM remains isolated to Cloud Speech-to-Text and is never sent to Gemini Live.
- Keep `connected` as the protocol-v2 WebSocket handshake acknowledgement.
- Use the existing `provider_health` message for Live readiness; do not add or change protocol messages.
- Never automatically replay typed text, narration, microphone PCM, tool calls, or activity boundaries after an ambiguous provider failure.
- A failed answer completes exactly once with `retryable: true`; a failed narration completes exactly once with `retryable: false`.
- Do not add dependencies, expose credentials, persist raw audio/transcripts, or alter origin and payload policy.
- Automated success does not establish physical Chrome/provider acceptance; preserve pending cases honestly.

---

## Planned File Structure

### Production files to modify

- `chrome-extension/src/sidepanel/realtime/voiceActivity.ts` — make the adaptive detector safe at the production 20 ms packet cadence.
- `ai-voice-realtime/src/gemini/liveSession.js` — make turn-bearing writes generation-owned and route ambiguous rejection through a non-resumable reconnect.
- `ai-voice-realtime/src/stt/googleSpeechTranscriber.js` — reset consecutive retry state only after current-stream provider evidence.
- `chrome-extension/src/sidepanel/realtime/typedQuestion.ts` — define production-used readiness, copy, draft-retention, retry notice, and delayed-dispatch helpers.
- `chrome-extension/src/sidepanel/realtime/types.ts` — export the Live provider-state type used by provider health and typed-question helpers.
- `chrome-extension/src/sidepanel/realtime/useRealtimeSession.ts` — gate question admission/send and settle retryable answer failures visibly.
- `chrome-extension/src/sidepanel/components/QuestionSection.tsx` — preserve refused drafts and render reason-aware Q&A copy.
- `chrome-extension/src/sidepanel/App.tsx` — propagate the boolean admission result and Q&A availability.

### Test files to modify or create

- `chrome-extension/test/voiceActivity.test.ts`
- `chrome-extension/test/mediaAudio.test.ts`
- `ai-voice-realtime/test/liveSession.test.js`
- `ai-voice-realtime/test/googleSpeechTranscriber.test.js`
- `chrome-extension/test/typedQuestion.test.ts`

No new protocol variant or dependency is required.

---

### Task 1: Make microphone VAD production-cadence safe

**Files:**
- Modify: `chrome-extension/test/voiceActivity.test.ts`
- Modify: `chrome-extension/test/mediaAudio.test.ts`
- Modify: `chrome-extension/src/sidepanel/realtime/voiceActivity.ts:64-76`
- Track: `docs/superpowers/specs/2026-08-05-realtime-integration-critical-fixes-design.md`
- Track: `docs/superpowers/plans/2026-08-05-realtime-integration-critical-fixes.md`

**Interfaces:**
- Consumes: `AdaptiveVoiceActivityDetector.push(pcm: Int16Array, timestampMs: number): VadEvent[]` and the existing 20 ms `Float32Array` worklet messages.
- Produces: The same `speech_start`, `speech_audio`, and `speech_end` events with unchanged fields, 300 ms pre-roll, 120 ms opening threshold, and 500 ms end hangover.

- [ ] **Step 1: Add a failing 20 ms sustained-speech regression**

Add this test beside the existing 40 ms detector tests:

```ts
test("opens sustained speech at the production 20 ms worklet cadence", () => {
  const detector = new AdaptiveVoiceActivityDetector();
  const events = [
    ...pushFrames(detector, pcm(500, 0.002), 0, 20),
    ...pushFrames(detector, pcm(300, 0.32), 500, 20),
    ...pushFrames(detector, new Int16Array(9_600), 800, 20),
  ];
  const starts = events.filter((event) => event.type === "speech_start");
  const ends = events.filter((event) => event.type === "speech_end");

  assert.equal(starts.length, 1);
  assert.equal(starts[0].preRoll.reduce((total, frame) => total + frame.length, 0), 4_800);
  assert.deepEqual(ends.map((event) => event.timestampMs), [1_300]);
});
```

- [ ] **Step 2: Add 20 ms false-positive and natural-onset regressions**

Add tests using `pushFrames(..., 20)` that assert:

```ts
assert.equal(pushFrames(new AdaptiveVoiceActivityDetector(), pcm(2_000, 0.002), 0, 20)
  .some((event) => event.type === "speech_start"), false);

const spikeDetector = new AdaptiveVoiceActivityDetector();
const spikeEvents = [
  ...pushFrames(spikeDetector, pcm(500, 0.002), 0, 20),
  ...pushFrames(spikeDetector, pcm(40, 0.6), 500, 20),
  ...pushFrames(spikeDetector, pcm(400, 0.002), 540, 20),
];
assert.equal(spikeEvents.some((event) => event.type === "speech_start"), false);
```

For the natural-onset case, use:

```ts
const rampDetector = new AdaptiveVoiceActivityDetector();
const rampEvents = pushFrames(rampDetector, pcm(500, 0.002), 0, 20);
let rampAtMs = 500;
for (const amplitude of [0.02, 0.04, 0.08, 0.16, 0.24, 0.32, 0.32, 0.32]) {
  rampEvents.push(...pushFrames(rampDetector, pcm(20, amplitude), rampAtMs, 20));
  rampAtMs += 20;
}
assert.equal(rampEvents.filter((event) => event.type === "speech_start").length, 1);
```

Keep the existing 40 ms tests unchanged to guard their established behavior while the explicit 20 ms cases prove safety at the production cadence. This task does not make below-threshold noise smoothing invariant across arbitrary frame durations.

- [ ] **Step 3: Convert echo/barge-in coverage to production-sized frames**

Change `pushMicrophoneFrames` to accept `frameMs = 40` and use `(frameMs * SAMPLE_RATE) / 1_000` instead of the fixed 640-sample frame. The default preserves every existing three-argument caller. For both `tab` and `model` reference cases, pass `frameMs = 20` explicitly for the leakage-only and leakage-plus-independent-speech assertions. Leakage must emit no start; independent near-end speech must emit exactly one start.

- [ ] **Step 4: Add the real media-boundary regression**

In `mediaAudio.test.ts`, emit actual worklet blocks instead of one 200-300 ms array:

```ts
let nowMs = 1_000;
const media = fixture({ now: () => nowMs });
await startBoth(media);
const microphone = sineFloats(300, 0.32, 220, 48_000);
for (let offset = 0; offset < microphone.length; offset += 960) {
  media.context.worklets[1].emit(microphone.slice(offset, offset + 960));
  nowMs += 20;
}
for (let index = 0; index < 30; index += 1) {
  media.context.worklets[1].emit(new Float32Array(960));
  nowMs += 20;
}
assert.deepEqual(media.userEvents, ["start", "end"]);
assert.ok(media.micPackets.length > 0);
```

Also split the existing scheduled-model leakage/barge-in fixture into 960-sample blocks and preserve its no-leakage/one-independent-start assertions. Give each fixture a mutable clock and advance it by 20 ms after every emitted leakage or mixed-speech block:

```ts
let echoNowMs = 1_080;
const echo = fixture({ now: () => echoNowMs });
await startBoth(echo);
for (let offset = 0; offset < leakage.length; offset += 960) {
  echo.context.worklets[1].emit(leakage.slice(offset, offset + 960));
  echoNowMs += 20;
}
```

Use a separate mutable clock for the independent-speech fixture so both reference correlations advance monotonically through the production-sized blocks.

- [ ] **Step 5: Run the focused tests and verify RED**

Run:

```bash
cd chrome-extension
node --experimental-strip-types --test test/voiceActivity.test.ts test/mediaAudio.test.ts
```

Expected: at least the sustained 20 ms detector test and 20 ms media/barge-in boundary test fail because no `speech_start` is emitted.

- [ ] **Step 6: Apply the minimal detector correction**

Replace the closed-state adaptation block in `AdaptiveVoiceActivityDetector.push()` with:

```ts
if (!this.open) {
  if (speechLike) {
    this.candidateMs += frameDurationMs;
  } else {
    this.candidateMs = 0;
    this.noiseRms += (frameRms - this.noiseRms) * NOISE_SMOOTHING;
  }
  if (this.candidateMs < VAD_MIN_SPEECH_MS) return [];

  this.open = true;
  this.candidateMs = 0;
  this.lastSpeechEndMs = frameEndMs;
  return [{ type: "speech_start", timestampMs, preRoll: this.preRoll.map(clonePcm) }];
}
```

Do not modify `pcm-capture-worklet.js`, the resampler, thresholds, pre-roll, or hangover.

- [ ] **Step 7: Run focused and full extension tests and verify GREEN**

Run:

```bash
cd chrome-extension
node --experimental-strip-types --test test/voiceActivity.test.ts test/mediaAudio.test.ts
npm test
```

Expected: all focused tests pass and the full extension suite has zero failures.

- [ ] **Step 8: Commit the VAD repair**

```bash
git add chrome-extension/src/sidepanel/realtime/voiceActivity.ts chrome-extension/test/voiceActivity.test.ts chrome-extension/test/mediaAudio.test.ts docs/superpowers/specs/2026-08-05-realtime-integration-critical-fixes-design.md docs/superpowers/plans/2026-08-05-realtime-integration-critical-fixes.md
git commit -m "fix: detect speech at production audio cadence"
```

---

### Task 2: Poison ambiguous Gemini Live generations

**Files:**
- Modify: `ai-voice-realtime/test/liveSession.test.js`
- Modify: `ai-voice-realtime/src/gemini/liveSession.js:155-213`
- Modify: `ai-voice-realtime/src/gemini/liveSession.js:265-281`
- Modify: `ai-voice-realtime/src/gemini/liveSession.js:527-617`

**Interfaces:**
- Consumes: Existing turn records from `#createTurn(turnId, mode)` and generation-fenced `#sendRealtime(payload, expectedGeneration)`.
- Produces: `#sendRealtimeTurn(turn, text)`, a private turn-owned queued write helper, and `#reconnect({ allowResumption?: boolean })` with `allowResumption` defaulting to `true`.
- Preserves: Existing `onPlaybackClear`, `onTurnComplete`, provider-health, and single-flight reconnect callback contracts.

- [ ] **Step 1: Add a rejecting fake connection**

Extend the test fixture with:

```js
class RejectingLiveConnection extends FakeLiveConnection {
  constructor(rejectAt) {
    super();
    this.rejectAt = rejectAt;
    this.writeCount = 0;
  }

  sendRealtimeInput(payload) {
    this.realtimeInputs.push(payload);
    this.writeCount += 1;
    return this.writeCount === this.rejectAt
      ? Promise.reject(new Error("outbound rejected"))
      : Promise.resolve();
  }
}
```

- [ ] **Step 2: Add table-driven typed-write failure tests**

For `rejectAt` values 1, 2, and 3, start with a rejecting connection followed by a healthy replacement, call `askTyped("failed", "What happened?")`, and flush the promise queue. Assert:

```js
assert.deepEqual(h.clears, [{ turnId: "failed", reason: "reconnect" }]);
assert.deepEqual(h.completions, [{
  turnId: "failed",
  mode: "answer",
  interrupted: true,
  retryable: true,
}]);
assert.equal(rejecting.closed, 1);
assert.deepEqual(h.configs[1].config.sessionResumption, {});
```

Before submitting the failed turn, deliver `{ sessionResumptionUpdate: { resumable: true, newHandle: "old-resume" } }` through the original callback. Assert the replacement configuration contains `sessionResumption: {}` rather than `{ handle: "old-resume" }`. Deliver model audio through the stale callback and assert it is dropped. Submit a fresh turn on the replacement, deliver fresh audio, and assert it is attributed only to the fresh turn. Assert the failed text and activity boundaries are never replayed to the replacement.

Structure the cases as independent tests so fake connection and ownership state never leak between rejection positions:

```js
for (const rejectAt of [1, 2, 3]) {
  test(`retires a typed turn when outbound write ${rejectAt} rejects`, async () => {
    const rejecting = new RejectingLiveConnection(rejectAt);
    const replacement = new FakeLiveConnection();
    const h = makeHarness({ connections: [rejecting, replacement] });
    await h.live.start();
    h.callbacks[0].onmessage({
      sessionResumptionUpdate: { resumable: true, newHandle: "old-resume" },
    });
    h.live.askTyped("failed", "What happened?");
    await flush();
    await flush();

    assert.deepEqual(h.completions, [{
      turnId: "failed", mode: "answer", interrupted: true, retryable: true,
    }]);
    assert.equal(replacement.realtimeInputs.length, 0);
  });
}
```

- [ ] **Step 3: Add narration, queued-owner, and activity-boundary tests**

Add focused tests asserting:

- Rejection at narration write positions 1, 2, and 3 clears once and completes once with `retryable: false`.
- A second turn queued behind a rejected first turn is completed by the poisoned-generation settlement even if its first write never executes.
- Rejected microphone `activityStart` and `activityEnd` each produce one retryable completion, no boundary replay, and one reconnect.
- A rejected microphone PCM write remains exactly-once and reconnects without using the old resumption handle.

Seed `old-resume` before every narration, activity-boundary, and PCM failure and assert each replacement uses `sessionResumption: {}`. Use `h.lifecycle` to assert `playback_clear` precedes `turn_complete` for every affected turn.

Table narration exactly like typed input:

```js
for (const rejectAt of [1, 2, 3]) {
  test(`retires narration when outbound write ${rejectAt} rejects`, async () => {
    const rejecting = new RejectingLiveConnection(rejectAt);
    const replacement = new FakeLiveConnection();
    const h = makeHarness({ connections: [rejecting, replacement] });
    await h.live.start();
    h.callbacks[0].onmessage({
      sessionResumptionUpdate: { resumable: true, newHandle: "old-resume" },
    });
    h.live.speakNarration("narration-failed", "Goal scored.");
    await flush();
    await flush();
    assert.deepEqual(h.configs[1].config.sessionResumption, {});
  });
}
```

For each narration case, the terminal assertions are:

```js
assert.deepEqual(h.lifecycle, [
  { type: "playback_clear", turnId: "narration-failed", reason: "reconnect" },
  {
    type: "turn_complete",
    turnId: "narration-failed",
    mode: "narration",
    interrupted: true,
    retryable: false,
  },
]);
```

For two queued answer owners, compare sorted turn IDs from `h.completions` with `["first", "second"]` and assert every completion is interrupted and retryable.

- [ ] **Step 4: Add reconnect and close race tests**

Add a reject-capable deferred:

```js
function rejectableDeferred() {
  let resolve;
  let reject;
  const promise = new Promise((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}
```

Have a controllable connection return this promise for one selected write. In one test, trigger GoAway before calling `reject(new Error("late rejection"))`; assert one provider close, one reconnect, and one completion. In another, begin `close()` before rejecting; assert no replacement connection, no provider revival, and no duplicate callbacks.

Add a delayed-reconnect admission test: hold the reconnect sleep on a deferred promise, trigger GoAway so `session === null` and `reconnectPromise` is active, then assert `askTyped`, `speakNarration`, and `startUserActivity` each throw synchronously without creating ownership or emitting a completion. Resolve reconnect and prove a fresh turn is admitted normally.

- [ ] **Step 5: Run the Live tests and verify RED**

Run:

```bash
cd ai-voice-realtime
node --test test/liveSession.test.js
```

Expected: the rejected typed/narration and activity-boundary tests fail because the generic queue only publishes degraded health and leaves ownership behind.

- [ ] **Step 6: Make typed and narration writes turn-owned**

Add `#assertReadyForTurn()` and call it before `#createTurn()` in `askTyped`, `speakNarration`, and `startUserActivity`:

```js
#assertReadyForTurn() {
  if (!this.session || this.reconnectPromise || this.closing) {
    throw new Error("Gemini Live is not ready for a new turn");
  }
}
```

Retain the turn returned by `#createTurn` and pass it to `#sendRealtimeTurn`:

```js
const turn = this.#createTurn(turnId, "answer");
this.#sendRealtimeTurn(turn, text);
```

Use the equivalent narration form. Change `#sendRealtimeTurn` to queue all three writes under the captured turn and generation. Before the first write, throw into the owned failure path if the session is absent rather than silently returning.

- [ ] **Step 7: Add a private turn-owned queue helper**

Implement a helper with these guards and semantics:

```js
#enqueueOwnedTurn(turn, operation) {
  const generation = this.generation;
  return this.#enqueue(async () => {
    if (turn.failed || turn.completed || this.closing || generation !== this.generation) return;
    try {
      if (!this.session) throw new Error("Gemini Live session is unavailable");
      await operation(generation);
    } catch {
      if (turn.failed || turn.completed || this.closing || generation !== this.generation) return;
      void this.#reconnect({ allowResumption: false });
    }
  });
}
```

Use it for typed/narration `activityStart`/text/`activityEnd` as one operation and for microphone `activityStart` and `activityEnd`. Do not send later parts after an earlier part rejects.

- [ ] **Step 8: Add non-resumable reconnect mode**

Change the reconnect signature to:

```js
async #reconnect({ allowResumption = true } = {}) {
  if (!allowResumption) this.resumptionHandle = null;
  // retain existing single-flight behavior
}
```

Ensure the handle is cleared before checking `reconnectPromise`, so a current-generation hard failure can strengthen a reconnect request already being created. Keep ordinary `start`, GoAway, `onerror`, and `onclose` callers resumable. Change the rejected microphone PCM caller to `#reconnect({ allowResumption: false })`.

Keep `#runReconnect()` responsible for synchronously incrementing `generation`, detaching `session`, calling `#completeOwnedTurnsForReconnect()`, clearing ownership, and publishing `connecting` before its first provider-cleanup await.

- [ ] **Step 9: Run focused and full backend tests and verify GREEN**

Run:

```bash
cd ai-voice-realtime
node --test test/liveSession.test.js test/clientSession.test.js
npm run check
```

Expected: all selected tests and the full backend check pass with zero failures; no old-generation input appears on a replacement connection.

- [ ] **Step 10: Commit the Live lifecycle repair**

```bash
git add ai-voice-realtime/src/gemini/liveSession.js ai-voice-realtime/test/liveSession.test.js
git commit -m "fix: retire rejected live turn generations"
```

---

### Task 3: Reset Cloud STT retries only after provider stability

**Files:**
- Modify: `ai-voice-realtime/test/googleSpeechTranscriber.test.js`
- Modify: `ai-voice-realtime/src/stt/googleSpeechTranscriber.js:157-187`
- Modify: `ai-voice-realtime/src/stt/googleSpeechTranscriber.js:283-344`

**Interfaces:**
- Consumes: Current stream records, raw stream `metadata`/`data` events, and the existing 250/500/1000 ms retry schedule.
- Produces: A private `#markStable(record)` operation and per-record `stable: boolean` state.
- Preserves: Existing public health, write, transcript, rotation, discontinuity, and close APIs.

- [ ] **Step 1: Add the isolated-failure recovery regression**

Add a test that performs four stable-then-fail cycles:

```js
test("stable replacement streams start a fresh bounded retry schedule", async () => {
  const timers = new FakeTimers();
  const { transcriber } = makeTranscriber({ timers });
  await transcriber.start();

  for (let incident = 0; incident < 4; incident += 1) {
    const streams = FakeSpeechClient.instances[0].streams;
    const active = streams.at(-1);
    active.emit("metadata", {});
    active.emit("error", new Error(`isolated-${incident}`));
    const count = streams.length;
    timers.advance(249);
    assert.equal(streams.length, count);
    timers.advance(1);
    assert.equal(streams.length, count + 1);
  }

  await transcriber.close();
});
```

- [ ] **Step 2: Protect bounded consecutive failure behavior**

Keep the existing `retries provider failures at 250, 500, and 1000 milliseconds then remains degraded` test without emitting `metadata` or `data`. It must still create four total streams and leave no pending retry after the fourth failure.

- [ ] **Step 3: Add a stale-record stability regression**

Use a short `rotateAfterMs` to create a replacement and retain the old fake emitter. Fail the current replacement once, emit `metadata` and `data` from the retiring old stream, open the retry after 250 ms, then fail the next stream without stability evidence. Assert that its next retry still waits 500 ms, proving stale evidence did not reset the counter.

The timing assertions are:

```js
timers.advance(100);
const streams = FakeSpeechClient.instances[0].streams;
const retiring = streams[0];
const replacement = streams[1];
replacement.emit("error", new Error("first pre-stability failure"));
retiring.emit("metadata", {});
retiring.emit("data", { results: [] });
timers.advance(250);
assert.equal(streams.length, 3);
streams[2].emit("error", new Error("second pre-stability failure"));
timers.advance(499);
assert.equal(streams.length, 3);
timers.advance(1);
assert.equal(streams.length, 4);
```

- [ ] **Step 4: Run the focused STT tests and verify RED**

Run:

```bash
cd ai-voice-realtime
node --test test/googleSpeechTranscriber.test.js
```

Expected: the fourth isolated incident schedules no replacement because `#retryAttempt` remains exhausted across stable recoveries.

- [ ] **Step 5: Add per-record stability state and events**

Add `stable: false` to every record created by `#openStream()`. Register provider evidence before normal response processing:

```js
stream.once("metadata", () => this.#markStable(record));
stream.on("data", (response) => {
  this.#markStable(record);
  this.#handleResponse(record, response);
});
```

Implement:

```js
#markStable(record) {
  if (
    this.#closed ||
    record !== this.#active ||
    record.retiring ||
    record.destroyed ||
    record.stable
  ) return;
  record.stable = true;
  this.#retryAttempt = 0;
}
```

Do not reset `#retryAttempt` in `#openStream()`, `#setHealth("ready")`, rotation setup, or a configuration write/drain callback.

- [ ] **Step 6: Run focused and full backend tests and verify GREEN**

Run:

```bash
cd ai-voice-realtime
node --test test/googleSpeechTranscriber.test.js test/clientSession.test.js
npm run check
```

Expected: isolated stable failures each restart at 250 ms, consecutive pre-stability failures remain bounded, stale records cannot reset the budget, and the full backend check passes.

- [ ] **Step 7: Commit the STT recovery repair**

```bash
git add ai-voice-realtime/src/stt/googleSpeechTranscriber.js ai-voice-realtime/test/googleSpeechTranscriber.test.js
git commit -m "fix: reset stt retries after provider recovery"
```

---

### Task 4: Gate and settle typed questions with Live readiness

**Files:**
- Create: `chrome-extension/src/sidepanel/realtime/typedQuestion.ts`
- Create: `chrome-extension/test/typedQuestion.test.ts`
- Modify: `chrome-extension/src/sidepanel/realtime/types.ts`
- Modify: `chrome-extension/src/sidepanel/realtime/useRealtimeSession.ts:71-130`
- Modify: `chrome-extension/src/sidepanel/realtime/useRealtimeSession.ts:522-540`
- Modify: `chrome-extension/src/sidepanel/realtime/useRealtimeSession.ts:595-613`
- Modify: `chrome-extension/src/sidepanel/realtime/useRealtimeSession.ts:648-705`
- Modify: `chrome-extension/src/sidepanel/components/QuestionSection.tsx`
- Modify: `chrome-extension/src/sidepanel/App.tsx`

**Interfaces:**
- Produces: `LiveProviderState = "connecting" | "ready" | "degraded" | "closed"`.
- Produces: `QuestionAvailability = "stopped" | "connecting" | "ready" | "degraded"` and `questionAvailabilityFor(...)`.
- Produces: Production-used helpers `canAskRealtime(...)`, `questionCopyFor(...)`, `voiceQuestionStatusFor(...)`, `draftAfterAdmission(...)`, `retryableAnswerNotice(...)`, and `dispatchTypedQuestion(...)`.
- Produces: One shared local turn-completion callback used for backend `turn_complete` messages and locally cancelled pre-send questions.
- Produces: `QuestionSection.onAsk(question): boolean`; a synchronous refusal preserves the draft.
- Preserves: Existing protocol messages, chat message shape, speech coordinator behavior, and typed-question payload.

- [ ] **Step 1: Add failing production-helper tests**

Create `typedQuestion.test.ts` and import every helper from the production module that the hook and component will use. Add readiness and reason-aware copy coverage:

```ts
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
  assert.equal(canAskRealtime("connected", true, "ready"), true);
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
```

Add a deferred dispatch test against the production helper:

```ts
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
```

- [ ] **Step 2: Run the focused readiness test and verify RED**

Run:

```bash
cd chrome-extension
node --experimental-strip-types --test test/typedQuestion.test.ts
```

Expected: FAIL because `typedQuestion.ts` and its production helpers do not exist.

- [ ] **Step 3: Implement the production typed-question helpers**

Export `LiveProviderState` from `types.ts` and reuse it in the `provider_health` server-message variant. Create `typedQuestion.ts` with:

```ts
import type { LiveProviderState, RealtimeStatus, TurnMode, VoiceStatus } from "./types.ts";

export type QuestionAvailability = "stopped" | "connecting" | "ready" | "degraded";

export function questionAvailabilityFor(
  status: RealtimeStatus,
  helloAccepted: boolean,
  liveState: LiveProviderState,
): QuestionAvailability {
  if (status === "idle" || status === "error") return "stopped";
  if (status !== "connected" || !helloAccepted || liveState === "connecting") return "connecting";
  return liveState === "ready" ? "ready" : "degraded";
}

export function canAskRealtime(
  status: RealtimeStatus,
  helloAccepted: boolean,
  liveState: LiveProviderState,
): boolean {
  return questionAvailabilityFor(status, helloAccepted, liveState) === "ready";
}

export function questionCopyFor(availability: QuestionAvailability) {
  if (availability === "connecting") return {
    placeholder: "Gemini is connecting…",
    statusText: "Gemini is connecting — questions will unlock when ready",
  };
  if (availability === "degraded") return {
    placeholder: "Gemini is reconnecting…",
    statusText: "Gemini is reconnecting — questions are temporarily paused",
  };
  return availability === "ready"
    ? { placeholder: "Ask a question...", statusText: null }
    : { placeholder: "Start StreamSense to ask a question", statusText: null };
}

export function voiceQuestionStatusFor(
  voiceStatus: VoiceStatus,
  availability: QuestionAvailability,
): string | null {
  const availabilityText = questionCopyFor(availability).statusText;
  if (availabilityText) return availabilityText;
  return {
    off: null,
    listening: "Mic open — ask a question",
    user_speaking: "Listening to you…",
    gemini_speaking: "Gemini is replying…",
    degraded: "Voice unavailable — typed questions still work",
  }[voiceStatus];
}

export function draftAfterAdmission(draft: string, accepted: boolean): string {
  return accepted ? "" : draft;
}

export function retryableAnswerNotice(
  mode: TurnMode,
  retryable: boolean,
  settledActiveTurn: boolean,
): string | null {
  return settledActiveTurn && mode === "answer" && retryable
    ? "Gemini could not complete this answer. Ask again when Live is ready."
    : null;
}

export async function dispatchTypedQuestion(options: {
  waitForFrame: () => Promise<void>;
  isReady: () => boolean;
  send: () => void;
  onUnavailable: () => void;
}): Promise<boolean> {
  await options.waitForFrame();
  if (!options.isReady()) {
    options.onUnavailable();
    return false;
  }
  options.send();
  return true;
}
```

- [ ] **Step 4: Make Live readiness render-driving and synchronously readable**

In `useRealtimeSession`, add paired state/ref storage:

```ts
const [liveProviderState, setLiveProviderState] = useState<LiveProviderState>("closed");
const liveProviderStateRef = useRef<LiveProviderState>("closed");

const publishLiveProviderState = useCallback((state: LiveProviderState) => {
  liveProviderStateRef.current = state;
  setLiveProviderState(state);
}, []);
```

Set it from every Live `provider_health` message. Set it to `connecting` when a new hello is accepted and to `closed` during resource release/stop. Continue updating `VoiceStatusState` for the microphone status line; typed readiness must not depend on the derived `VoiceStatus` string because microphone denial may leave that string unchanged while Live becomes ready.

Derive once per render:

```ts
const questionAvailability = questionAvailabilityFor(
  status,
  voiceStateRef.current.helloAccepted,
  liveProviderState,
);
```

- [ ] **Step 5: Extract one local completion path**

Move the existing `turn_complete` case body into a `settleTurnComplete(message)` callback that:

1. calls `speechCoordinator.turnComplete(message)`;
2. computes `settledActiveTurn` from `activeTurnRef.current?.turnId === message.turnId`;
3. only when `settledActiveTurn` is true, updates active/settling refs, retains the existing 15-second late-transcript settlement timer, and applies `descriptionAfterTurnComplete`;
4. leaves the newer turn's refs, description, and error unchanged when `settledActiveTurn` is false;
5. calls `retryableAnswerNotice(message.mode, message.retryable, settledActiveTurn)` and sets the returned nonfatal message without changing the session status to `error`.

The WebSocket message handler must call this callback for backend completions. A late completion for a displaced turn may reach the coordinator's stale-turn guard but must not change active/settling refs, description, or error copy. Clear the nonfatal error when a later `ask()` is successfully admitted.

- [ ] **Step 6: Guard admission and delayed dispatch**

At the beginning of `ask()`, require the current socket/coordinator plus:

```ts
if (!canAskRealtime(
  statusRef.current,
  voiceStateRef.current.helloAccepted,
  liveProviderStateRef.current,
)) return false;
```

Replace the inline forced-frame async closure with the production `dispatchTypedQuestion` helper. Its `waitForFrame` performs the existing forced capture/deadline race. Its `isReady` checks socket identity, `WebSocket.OPEN`, and the same readiness predicate. Its `send` emits the existing `typed_question` payload. Its `onUnavailable` calls `settleTurnComplete` locally with:

```ts
{
  type: "turn_complete",
  turnId,
  mode: "answer",
  interrupted: true,
  retryable: true,
}
```

Do not send the backend command, delete the user's chat message, reuse the UUID, or set global session status to `error`.

Return `canAsk` as:

```ts
canAsk: questionAvailability === "ready",
questionAvailability,
```

- [ ] **Step 7: Preserve refused drafts and render reason-aware copy**

Change `QuestionSectionProps` to consume `questionAvailability` instead of a generic `disabled` flag and make `onAsk` return `boolean`:

```ts
type QuestionSectionProps = {
  messages: ChatMessage[];
  onAsk: (question: string) => boolean;
  questionAvailability: QuestionAvailability;
  voiceStatus?: VoiceStatus;
  tabContextStatus?: "absent" | "connecting" | "ready" | "degraded";
};
```

Use the production draft helper so a synchronous refusal does not erase user input:

```ts
function handleSubmit() {
  const question = draft.trim();
  if (!question || questionAvailability !== "ready") return;
  const accepted = onAsk(question);
  setDraft((current) => draftAfterAdmission(current, accepted));
}
```

Derive `disabled` and placeholder from `questionCopyFor(questionAvailability)`. Render the combined Q&A/voice line with `voiceQuestionStatusFor(voiceStatus, questionAvailability)`, ensuring Live connecting/degraded copy overrides the microphone-only `typed questions still work` message.

In `App.tsx`, return the hook's boolean result and pass availability through:

```ts
const handleAsk = useCallback(
  (question: string) => session.ask(question),
  [session],
);

<QuestionSection
  messages={session.messages}
  onAsk={handleAsk}
  questionAvailability={session.questionAvailability}
  voiceStatus={session.voiceStatus}
  tabContextStatus={session.tabContextStatus}
/>
```

- [ ] **Step 8: Run focused extension tests and verify GREEN**

Run:

```bash
cd chrome-extension
node --experimental-strip-types --test test/typedQuestion.test.ts test/sessionLifecycle.test.ts test/protocolContract.test.ts
```

Expected: all selected tests pass, including production-helper coverage for draft retention, reason-aware copy, retryable notice, and readiness loss during the deferred send window. Existing turn-state and coordinator tests continue to cover matching-turn settlement, old-turn isolation, watchdog cancellation, and tab-gain restoration.

- [ ] **Step 9: Run the full extension gate**

```bash
cd chrome-extension
npm test
npm run build
```

Expected: zero test failures, successful TypeScript compilation, successful Vite build, and successful extension zip creation.

- [ ] **Step 10: Commit the readiness repair**

```bash
git add chrome-extension/src/sidepanel/realtime/typedQuestion.ts chrome-extension/src/sidepanel/realtime/types.ts chrome-extension/src/sidepanel/realtime/useRealtimeSession.ts chrome-extension/src/sidepanel/components/QuestionSection.tsx chrome-extension/src/sidepanel/App.tsx chrome-extension/test/typedQuestion.test.ts
git commit -m "fix: gate questions on live readiness"
```

---

### Task 5: Verify the integrated repair and obtain independent review

**Files:**
- Modify only if observed evidence changes: `docs/verification/2026-08-04-gemini-live-voice-acceptance.md`
- Read: All files modified by Tasks 1-4

**Interfaces:**
- Consumes: The four independently committed repairs.
- Produces: Fresh automated evidence, targeted regression evidence, independent review verdicts, and an honest physical-acceptance status.

- [ ] **Step 1: Run fresh complete automated gates**

Run each command independently and retain its exit status and test count:

```bash
cd ai-voice-realtime
npm run check

cd ../chrome-extension
npm test
npm run build

cd ..
git diff --check
git status --short
```

Expected: backend and extension commands exit zero, `git diff --check` emits nothing, and status contains only the intended changes plus any pre-existing unrelated untracked files.

- [ ] **Step 2: Re-run the original four targeted failure scenarios**

Verify all of these outcomes with committed tests or temporary read-only repro scripts under `/private/tmp`:

1. One second of production-cadence sustained speech emits exactly one start.
2. Rejection of each typed Live write completes the failed owner retryably, drops stale output, and gives fresh output to a fresh owner.
3. Four stable-separated STT incidents each receive a new 250 ms retry while four pre-stability failures remain bounded.
4. Connected-plus-Live-connecting cannot send a typed question; Live-ready can; readiness loss before delayed send settles locally without sending.

- [ ] **Step 3: Dispatch two read-only verification agents in parallel**

Agent A reviews the complete diff against `docs/superpowers/specs/2026-08-05-realtime-integration-critical-fixes-design.md`, with special attention to generation fencing, exactly-once completion, replay prevention, and source-separated audio. Agent B independently runs the focused regressions, backend check, extension tests, and extension build, reporting exact commands, exit statuses, and counts. Neither agent may edit files, stage changes, create commits, or change branches.

- [ ] **Step 4: Resolve every Critical or Important review finding**

For each accepted finding, add a failing regression, run it RED, apply the minimal correction, run it GREEN, rerun the affected full package gate, and commit the correction separately. Reject a finding only with exact code and test evidence.

- [ ] **Step 5: Perform relevant physical Chrome/provider acceptance**

Run and record at minimum acceptance cases 3, 4, 8, 9, 10, and 12: user voice question, interruption, forced STT failure, Live reconnect, STT rotation, and acoustic isolation. Record only sanitized Chrome version/platform/timestamp, visible state, gain behavior, and teardown evidence. If any case cannot be observed, leave it `PENDING` or mark it `BLOCKED` with the exact sanitized reason.

- [ ] **Step 6: Commit observed acceptance evidence if it changed**

If the acceptance record changed:

```bash
git add docs/verification/2026-08-04-gemini-live-voice-acceptance.md
git commit -m "docs: record critical integration acceptance"
```

If no physical case was observed, do not create an evidence commit and do not change the release disposition.

- [ ] **Step 7: Run the final fresh gate after all review corrections**

Repeat Task 5 Step 1 after the last code or documentation change. Report automated checks as passing only from this final output, and report physical acceptance separately from automated status.
