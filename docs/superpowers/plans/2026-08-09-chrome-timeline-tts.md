# Chrome Timeline TTS Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move automatic recorded-event speech from Gemini Live to Chrome/OS TTS in the StreamSense Live side panel while preserving grounded event publication, question priority, source-separated capture, and the three narration modes.

**Architecture:** The backend remains the sole authority for analyzing, validating, recording, and publishing protocol-v2 timeline events, but no longer offers those events to Gemini Live. A dependency-injected `TimelineNarrator` in the extension accepts only newly inserted timeline events and owns Chrome TTS lifecycle, freshness, Smart silence, and bounded pending work. The existing `SpeechCoordinator` continues to own Gemini answer PCM and tab gain priority, with a small explicit input for Chrome timeline-TTS active state.

**Tech Stack:** TypeScript, React hooks, Manifest V3 `chrome.tts`, Node test runner, JavaScript backend, Gemini Live compatibility path.

## Global Constraints

- Keep microphone audio and captured-tab audio separate; timeline TTS must not alter captured-tab PCM or Cloud Speech-to-Text routing.
- Only a newly deduplicated event inserted into the side-panel timeline may be offered, using the exact recorded `event.description`.
- Use Manifest V3 permission `tts`; never add `ttsEngine`.
- Own at most one active utterance and one newest pending event; pending TTL is exactly `5000` ms and Smart silence is exactly `750` ms.
- `question_only` disables Chrome timeline TTS but never event recording or display.
- Typed and microphone question admission has priority over timeline TTS; events received while an answer owns speech remain visible and are not replayed.
- Keep Gemini Live questions/answers and the existing Deep Research voice behavior unchanged.
- Do not create or switch branches/worktrees, push, open a PR, or modify remote state.
- Before every commit, inspect staged paths and run `git diff --cached --check`.

---

### Task 1: Focused Chrome TTS controller and manifest contract

**Files:**
- Create: `chrome-extension/src/sidepanel/realtime/timelineNarrator.ts`
- Create: `chrome-extension/test/timelineNarrator.test.ts`
- Modify: `chrome-extension/extensionManifest.ts`
- Modify: `chrome-extension/test/manifest.test.ts`

**Interfaces:**
- Consumes: `VoiceNarrationMode` from `chrome-extension/src/sidepanel/voiceNarration.ts`.
- Produces: `TimelineNarrator`, `TimelineNarratorEvent`, `TimelineTtsPort`, and `createChromeTimelineTtsPort()`.
- `TimelineNarrator` operations: `offer(event)`, `setVoiceNarrationMode(mode)`, `setAutomaticNarrationEnabled(enabled)`, `setTabActivity(active)`, `interruptForQuestion()`, and `stop()`.
- Constructor options inject `tts`, `now`, `setTimeout`, `clearTimeout`, `onActiveChange`, and `onError`.

- [ ] **Step 1: Write failing controller tests**

Add literal behavior tests whose fake TTS port captures text and lifecycle callbacks:

```ts
test("speaks the exact text of one newly offered event and rejects duplicate IDs", () => {
  const f = fixture({ mode: "over_audio" });
  f.narrator.offer({ id: "event-1", description: "  Goal by Rivera.  " });
  f.tts.emit(0, "start");
  f.tts.emit(0, "end");
  f.narrator.offer({ id: "event-1", description: "Changed duplicate text" });
  assert.deepEqual(f.tts.spokenText, ["Goal by Rivera."]);
  assert.deepEqual(f.activeChanges, [true, false]);
});

test("Smart requires 750 ms of continuous local silence", () => {
  const f = fixture({ mode: "smart" });
  f.narrator.setTabActivity(true);
  f.narrator.offer({ id: "event-1", description: "The score changes." });
  f.narrator.setTabActivity(false);
  f.clock.advance(749);
  assert.deepEqual(f.tts.spokenText, []);
  f.narrator.setTabActivity(true);
  f.narrator.setTabActivity(false);
  f.clock.advance(750);
  assert.deepEqual(f.tts.spokenText, ["The score changes."]);
});
```

Cover both always-narrate modes, one active plus newest pending replacement, 5000 ms inclusive expiry, empty text, every terminal event, rejected/synchronously thrown `speak`, late callbacks, question interruption, mode changes, Question only, tab activity entering Smart, stop idempotence, and pending continuation after a terminal error.

- [ ] **Step 2: Run controller tests and verify RED**

Run: `npm test --workspace chrome-extension -- --test-name-pattern="TimelineNarrator|Chrome timeline"`

Expected: FAIL because `timelineNarrator.ts`, its exports, and the manifest `tts` permission do not exist.

- [ ] **Step 3: Implement the minimal controller and Chrome adapter**

Implement the following contracts without browser globals in the controller core:

```ts
export type TimelineNarratorEvent = { id: string; description: string };
export type TimelineTtsEvent = {
  type: "start" | "end" | "interrupted" | "cancelled" | "error" | string;
  errorMessage?: string;
};
export type TimelineTtsPort = {
  speak(text: string, onEvent: (event: TimelineTtsEvent) => void): void | Promise<void>;
  stop(): void | Promise<void>;
};
```

Use an utterance token/generation so only the current lifecycle callback can settle state. Keep one `active` ownership record and one `pending` event with `receivedAtMs`; a newer offer replaces pending. Only `start` calls `onActiveChange(true)`, and all terminal paths settle at most once, restore idle if needed, then evaluate the newest unexpired pending item. Explicit interruption invalidates callbacks before calling `tts.stop()` and clears pending. Smart cancels/reschedules one 750 ms timer on every local activity transition. Trim text and reject blank descriptions.

Implement `createChromeTimelineTtsPort()` with `chrome.tts.speak(text, { enqueue: false, requiredEventTypes: ["start", "end"], onEvent })` and `chrome.tts.stop()`. Treat returned promises as early admission acknowledgements, not completion.

Add `"tts"` to `permissions` in `extensionManifest.ts` and assert the permission list includes `tts` while excluding `ttsEngine`.

- [ ] **Step 4: Run focused tests and verify GREEN**

Run: `npm test --workspace chrome-extension -- --test-name-pattern="TimelineNarrator|Chrome timeline|permissions"`

Expected: all focused tests pass with zero failures.

- [ ] **Step 5: Review and commit Task 1**

Run:

```bash
git add chrome-extension/src/sidepanel/realtime/timelineNarrator.ts chrome-extension/test/timelineNarrator.test.ts chrome-extension/extensionManifest.ts chrome-extension/test/manifest.test.ts
git diff --cached --name-only
git diff --cached --check
git commit -m "feat: add Chrome timeline TTS controller"
```

---

### Task 2: Side-panel timeline, question priority, and tab-gain integration

**Files:**
- Modify: `chrome-extension/src/sidepanel/realtime/speechCoordinator.ts`
- Modify: `chrome-extension/src/sidepanel/realtime/useRealtimeSession.ts`
- Modify: `chrome-extension/test/speechCoordinator.test.ts`
- Create: `chrome-extension/test/timelineEventAdmission.test.ts`
- Create or modify helper near the hook: `chrome-extension/src/sidepanel/realtime/timelineEventAdmission.ts`
- Test lifecycle integration through the focused controller/admission/coordinator seams.

**Interfaces:**
- Consumes: Task 1 `TimelineNarrator` and `createChromeTimelineTtsPort()`.
- Produces: `SpeechCoordinator.setTimelineNarrationActive(active: boolean)` and `SpeechCoordinator.answerOwnsSpeech(): boolean`.
- Produces: `admitTimelineEvent(current, event, options)` returning `{ events, inserted }`, where `inserted` is the exact event only when its ID was not already present.

- [ ] **Step 1: Write failing admission and coordinator tests**

Add a real helper test proving insertion precedes the returned speech offer boundary:

```ts
test("returns the exact event only after a new ID is inserted", () => {
  const event = { id: "event-1", timestamp: "00:03", eventType: "goal", description: "Rivera scores." };
  const first = admitTimelineEvent([], event);
  assert.deepEqual(first.events, [event]);
  assert.equal(first.inserted, event);
  const duplicate = admitTimelineEvent(first.events, event);
  assert.equal(duplicate.inserted, null);
  assert.deepEqual(duplicate.events, [event]);
});
```

Extend `speechCoordinator.test.ts` to prove Chrome timeline activity, independent of model PCM, yields 40% only in `over_audio`, remains 0% throughout `narration_only`, yields to an answer, restores according to current priority, and reports answer ownership from question admission through fail/playback-idle settlement.

- [ ] **Step 2: Run focused tests and verify RED**

Run: `npm test --workspace chrome-extension -- --test-name-pattern="timeline event|Chrome timeline|answer ownership"`

Expected: FAIL because admission and coordinator APIs do not exist.

- [ ] **Step 3: Implement minimal admission and gain APIs**

Implement `admitTimelineEvent` as a pure bounded deduplication operation retaining the newest 100 events. Add a `timelineNarrationActive` boolean to `SpeechCoordinator`; make desired gain priority exactly narration-only 0, user speaking 0, answer 0.3, active over-audio timeline TTS 0.4, otherwise 1. `setTimelineNarrationActive` must only update gain and must be safe after stop. `answerOwnsSpeech()` returns true only for the current `answer` turn.

- [ ] **Step 4: Run focused tests and verify GREEN**

Run: `npm test --workspace chrome-extension -- --test-name-pattern="timeline event|Chrome timeline|answer ownership"`

Expected: focused tests pass.

- [ ] **Step 5: Write failing hook-seam regressions**

Add seam-level assertions (pure helper or existing session lifecycle harness) proving:

- the hook calls `admitTimelineEvent` first and offers `inserted.description` only if no answer owns speech;
- typed admission, push-to-talk activity start, pagehide, capture target replacement, stop, and unmount call narrator interruption/stop before unsafe work can cross generations;
- narration-level and mode effects update the active narrator immediately;
- local `onTabActivity` updates both TimelineNarrator and the independent backend tab-activity protocol;
- model-audio and captured-tab PCM delivery code paths remain unchanged.

- [ ] **Step 6: Run the hook-seam regression and verify RED**

Run: `npm test --workspace chrome-extension -- --test-name-pattern="timeline TTS integration|question priority|session cleanup"`

Expected: FAIL because `useRealtimeSession` has no TimelineNarrator ownership.

- [ ] **Step 7: Wire TimelineNarrator into the realtime hook**

Create one narrator per capture generation after the audio coordinator exists. Register `narrator.stop()` with `SessionResourceLifecycle`; keep a ref only for the current generation. Feed local tab activity into both narrator and existing protocol. In the `event` message case, compute admission once, update state, then offer the inserted event only when `coordinator.answerOwnsSpeech()` is false. Use narrator `onActiveChange` to call `coordinator.setTimelineNarrationActive`, and bound `onError` to a concise side-panel error.

Call `interruptForQuestion()` before typed turn creation and before microphone activity claim. Call `stop()` through the existing release path for stop, pagehide, target replacement, track end, and unmount. Update mode and `narrationLevel !== "question_only"` through effects. Do not gate TimelineNarrator on Gemini or Cloud STT health. Keep `voiceNarrationMode` in session configuration only as temporary backend compatibility.

- [ ] **Step 8: Run extension suite and build**

Run:

```bash
npm test --workspace chrome-extension
npm run build --workspace chrome-extension
```

Expected: extension tests and TypeScript/Vite build pass; existing source-separated tab PCM tests remain green.

- [ ] **Step 9: Review and commit Task 2**

Run:

```bash
git add chrome-extension/src/sidepanel/realtime/speechCoordinator.ts chrome-extension/src/sidepanel/realtime/useRealtimeSession.ts chrome-extension/src/sidepanel/realtime/timelineEventAdmission.ts chrome-extension/test/speechCoordinator.test.ts chrome-extension/test/timelineEventAdmission.test.ts
git diff --cached --name-only
git diff --cached --check
git commit -m "feat: speak new timeline events in the side panel"
```

---

### Task 3: Remove automatic Gemini Live event speech

**Files:**
- Modify: `ai-voice-realtime/src/session/clientSession.js`
- Modify: `ai-voice-realtime/test/clientSession.test.js`
- Preserve normal question and Deep Research tests in existing files.

**Interfaces:**
- Consumes: recorded event publication from `recordNarrationEvent`, `recordVisionEvent`, and `publishEvent`.
- Produces: no automatic narration candidate dispatch from `processAtomicNarrationResult`; Gemini Live question/answer and explicit research voice entry points remain available.

- [ ] **Step 1: Write failing backend ownership tests**

Replace older automatic-Live expectations with a regression that uses a real approved frame analysis and a `FakeLiveSession` whose `speakNarration` call is observable:

```js
test("publishes a recorded automatic event without asking Gemini Live to narrate it", async (t) => {
  const live = new FakeLiveSession();
  const fixture = createFixture({
    analyzeFrame: async () => approvedAnalysis(),
    liveSessionFactory: () => live,
  });
  t.after(() => fixture.eventStore.close());
  await fixture.session.start();
  hello(fixture, "absent");
  await flushAsyncWork();
  sendFrame(fixture, 1, "frame");
  await flushAsyncWork();
  assert.equal(fixture.browser.messages.some((message) => message.type === "event"), true);
  assert.deepEqual(live.narrations, []);
});
```

Cover `question_only` recording/publication, event-store failure, duplicate persistence suppression, and event-before-any-speech ordering. Keep existing Normal typed question and Deep Research final-summary voice tests unchanged as compatibility evidence.

- [ ] **Step 2: Run backend focused tests and verify RED**

Run: `npm test --workspace ai-voice-realtime -- --test-name-pattern="without asking Gemini Live|Question only records|Deep Research"`

Expected: the new ownership test fails because automatic handling still reaches `speakNarration`.

- [ ] **Step 3: Remove the automatic candidate handoff**

In `processAtomicNarrationResult`, retain evidence validation, suppression rules, event persistence/publication, visible-state advancement, and grounded semantic bookkeeping. Remove only the construction/offer of `buildModeNarrationCandidate` for recorded automatic events. Remove now-unused imports. Keep session-config parsing and old policy classes only where compatibility makes deletion riskier; no automatic frame/event path may call `handleNarrationCandidate` or `GeminiLiveSession.speakNarration`.

- [ ] **Step 4: Run focused tests, backend suite, and package check**

Run:

```bash
npm test --workspace ai-voice-realtime -- --test-name-pattern="without asking Gemini Live|Question only records|Deep Research"
npm test --workspace ai-voice-realtime
npm run check --workspace ai-voice-realtime
```

Expected: all backend tests/checks pass. Use the approved loopback test escalation if the sandbox returns `listen EPERM`.

- [ ] **Step 5: Review and commit Task 3**

Run:

```bash
git add ai-voice-realtime/src/session/clientSession.js ai-voice-realtime/test/clientSession.test.js
git diff --cached --name-only
git diff --cached --check
git commit -m "refactor: keep automatic events out of Gemini Live"
```

---

### Task 4: Documentation, full verification, and independent review

**Files:**
- Modify: `README.md`
- Modify: `docs/architecture.md`
- Modify: `chrome-extension/README.md`
- Modify: `ai-voice-realtime/README.md`
- Modify: this plan only for checkbox progress if useful; do not mix it into source commits unless staged intentionally.

**Interfaces:**
- Documents the implemented ownership boundary and physical-Chrome caveat; no new runtime interface.

- [ ] **Step 1: Update all four architecture/setup documents**

State consistently that protocol-v2 events are recorded and published by the backend, deduplicated/inserted by the side panel, and spoken verbatim by Chrome/OS TTS. Document the required `tts` permission, exact three-mode timing/gain behavior, `question_only`, question interruption, and that Gemini Live readiness is not a timeline-narration gate. Preserve Gemini Live ownership for Normal questions/answers and the existing Deep Research voice path. Remove claims that automatic event prose or transcript is synthesized by Gemini Live.

- [ ] **Step 2: Run documentation/source consistency review**

Search: `rg -n "automatic narration|speakNarration|Gemini Live|Chrome/OS|ttsEngine|permission" README.md docs/architecture.md chrome-extension/README.md ai-voice-realtime/README.md chrome-extension ai-voice-realtime/src`

Expected: no contradictory implemented-state claim; `ttsEngine` appears only in negative test/design language; production manifest has `tts` only.

- [ ] **Step 3: Run fresh package and repository verification**

Run:

```bash
npm test --workspace chrome-extension
npm run build --workspace chrome-extension
npm test --workspace ai-voice-realtime
npm run check --workspace ai-voice-realtime
npm run check
git diff --check
```

Expected: all tests, typechecks, and builds pass. Record non-blocking Vite/WebSocket warning output separately. Automated checks do not replace reloading the unpacked extension and performing a physical Chrome TTS smoke test.

- [ ] **Step 4: Commit documentation**

Run:

```bash
git add README.md docs/architecture.md chrome-extension/README.md ai-voice-realtime/README.md docs/superpowers/plans/2026-08-09-chrome-timeline-tts.md
git diff --cached --name-only
git diff --cached --check
git commit -m "docs: document Chrome-owned timeline narration"
```

- [ ] **Step 5: Request independent code review**

Use the requesting-code-review template with base `999b17b`, current HEAD, the authoritative design path, this plan path, and the full diff. Require the reviewer to classify Critical, Important, and Minor findings and explicitly check lifecycle-token safety, event-before-speech ordering, question priority, gain restoration, backend Gemini exclusion, and source-separated tab PCM preservation.

- [ ] **Step 6: Address Critical/Important findings test-first**

For every accepted finding, add a focused failing regression, verify RED, implement the smallest fix, verify GREEN, run affected package checks, inspect staged paths, run `git diff --cached --check`, and commit a logical `fix:` checkpoint. Document rejected findings with concrete code/test evidence.

- [ ] **Step 7: Perform final verification and branch handoff**

Run `npm run check` fresh after the review-fix commit, inspect `git status --short --branch`, and follow `superpowers:finishing-a-development-branch`. Because the user explicitly prohibited remote changes and asked to keep the current branch, preserve `feat/voice-narration-modes` and report local commit hashes rather than merging or pushing.
