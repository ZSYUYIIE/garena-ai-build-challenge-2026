# Voice Narration Modes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add persistent Smart, Narrate over audio, and Narration only voice modes with an accessible side-panel `N` shortcut, backend-owned narration timing, and safe local tab-audio mixing.

**Architecture:** A strict `voiceNarrationMode` field travels in the existing `session_config` message. The backend uses the mode to select recorded timeline events and gate speech, while the extension independently derives local playback gain from mode and turn state. A small extension preference module and a small backend candidate-selection module keep persistence, shortcuts, and event eligibility independently testable.

**Tech Stack:** TypeScript, React 19, Chrome Manifest V3, Web Audio, Node.js ESM, Zod, `node:test`, Gemini Live integration.

## Global Constraints

- Keep microphone audio and captured-tab audio separate.
- A timeline event must be grounded, recorded, and published before automatic speech.
- `smart` preserves the current silence, commentary, importance, and health gates.
- `over_audio` uses 40% tab playback only while automatic narration is audible.
- `narration_only` keeps local tab playback muted for the entire active capture session.
- `question_only` Narration level disables automatic narration in every voice mode.
- Keep only the newest eligible pending event in always-narrate modes; never add a FIFO backlog.
- Questions and push-to-talk retain priority over automatic narration.
- The `N` shortcut is side-panel-only and ignored for editable targets, modifiers, and key repeat.
- Missing or malformed persisted and wire values fall back to `smart`; unknown explicit wire values are rejected.
- Do not change Gemini prompts, VAD, media capture, transcript handling, raw-media storage, dashboard behavior, or account persistence.

---

## File map

### New files

- `chrome-extension/src/sidepanel/voiceNarration.ts`: extension mode type, labels, persistence, cycling, and shortcut predicate.
- `chrome-extension/test/voiceNarration.test.ts`: pure preference and keyboard tests.
- `ai-voice-realtime/src/protocol/voiceNarrationMode.js`: backend mode constants and validation shared by protocol and policy.
- `ai-voice-realtime/src/session/narrationCandidate.js`: pure conversion from a persisted timeline event and atomic analysis to a mode-aware speech candidate.
- `ai-voice-realtime/test/narrationCandidate.test.js`: event eligibility and recorded-text tests.

### Modified files

- `chrome-extension/src/sidepanel/context/ConfigurationContext.tsx`: initialize and persist voice mode through one setter.
- `chrome-extension/src/sidepanel/components/ConfigurationSection.tsx`: render the selector, handle `N`, and announce changes.
- `chrome-extension/src/sidepanel/App.tsx`: pass voice mode into the realtime hook.
- `chrome-extension/src/sidepanel/realtime/useRealtimeSession.ts`: send mode over WebSocket and update local audio coordination live.
- `chrome-extension/src/sidepanel/realtime/speechCoordinator.ts`: compute gain from mode and turn state.
- `chrome-extension/src/sidepanel/realtime/mediaAudio.ts`: accept the 0.4 gain target.
- `chrome-extension/test/speechCoordinator.test.ts`: verify mode-aware cancellation and gain transitions.
- `chrome-extension/test/mediaAudio.test.ts`: verify the new gain value is applied without changing the capture branch.
- `chrome-extension/test/protocolContract.test.ts`: require the new outbound session configuration value.
- `ai-voice-realtime/src/protocol/browserMessages.js`: parse/default the new field.
- `ai-voice-realtime/src/session/speechPolicy.js`: add mode-aware gates, replacement, and transition behavior.
- `ai-voice-realtime/src/session/clientSession.js`: store mode, configure policy, and offer recorded events.
- `ai-voice-realtime/test/browserMessages.test.js`: cover compatibility defaults and invalid modes.
- `ai-voice-realtime/test/speechPolicy.test.js`: cover all policy modes and transitions.
- `ai-voice-realtime/test/clientSession.test.js`: cover configuration, ordering, and question-only behavior.
- `README.md`, `docs/architecture.md`, `chrome-extension/README.md`, `ai-voice-realtime/README.md`: document the implemented setting and shortcut.

---

### Task 1: Extension preference, labels, selector, and shortcut

**Files:**
- Create: `chrome-extension/src/sidepanel/voiceNarration.ts`
- Create: `chrome-extension/test/voiceNarration.test.ts`
- Modify: `chrome-extension/src/sidepanel/context/ConfigurationContext.tsx`
- Modify: `chrome-extension/src/sidepanel/components/ConfigurationSection.tsx`

**Interfaces:**
- Produces: `VoiceNarrationMode = "smart" | "over_audio" | "narration_only"`.
- Produces: `DEFAULT_VOICE_NARRATION_MODE`, `VOICE_NARRATION_MODE_LABELS`, `readVoiceNarrationMode`, `writeVoiceNarrationMode`, `nextVoiceNarrationMode`, and `isVoiceNarrationShortcut`.
- Produces: `ConfigurationOptions.voiceNarrationMode` and `setVoiceNarrationMode(mode)`.
- Consumes: existing `isEditableShortcutTarget(target)` from `realtime/typedQuestion.ts`.

- [ ] **Step 1: Write failing pure helper tests**

```ts
import test from "node:test";
import assert from "node:assert/strict";
import {
  DEFAULT_VOICE_NARRATION_MODE,
  isVoiceNarrationShortcut,
  nextVoiceNarrationMode,
  readVoiceNarrationMode,
  writeVoiceNarrationMode,
} from "../src/sidepanel/voiceNarration.ts";

test("voice narration cycles in the product order", () => {
  assert.equal(nextVoiceNarrationMode("smart"), "over_audio");
  assert.equal(nextVoiceNarrationMode("over_audio"), "narration_only");
  assert.equal(nextVoiceNarrationMode("narration_only"), "smart");
});

test("stored voice narration mode defaults safely", () => {
  const storage = { getItem: () => "broken" };
  assert.equal(readVoiceNarrationMode(storage), DEFAULT_VOICE_NARRATION_MODE);
});

test("voice narration writes the versioned value", () => {
  const writes: [string, string][] = [];
  const storage = { setItem: (key: string, value: string) => writes.push([key, value]) };
  assert.equal(writeVoiceNarrationMode("narration_only", storage), true);
  assert.deepEqual(writes, [["streamsense.voiceNarrationMode.v1", "narration_only"]]);
});

test("unmodified non-repeating N is the shortcut", () => {
  assert.equal(isVoiceNarrationShortcut({ code: "KeyN", repeat: false, altKey: false, ctrlKey: false, metaKey: false, shiftKey: false }), true);
  assert.equal(isVoiceNarrationShortcut({ code: "KeyN", repeat: true, altKey: false, ctrlKey: false, metaKey: false, shiftKey: false }), false);
  assert.equal(isVoiceNarrationShortcut({ code: "KeyN", repeat: false, altKey: false, ctrlKey: false, metaKey: false, shiftKey: true }), false);
});
```

- [ ] **Step 2: Run the helper test and verify it fails because the module does not exist**

Run: `node --experimental-strip-types --test chrome-extension/test/voiceNarration.test.ts`

Expected: FAIL with module-not-found for `voiceNarration.ts`.

- [ ] **Step 3: Implement the pure mode module**

```ts
export const VOICE_NARRATION_MODES = ["smart", "over_audio", "narration_only"] as const;
export type VoiceNarrationMode = (typeof VOICE_NARRATION_MODES)[number];
export const DEFAULT_VOICE_NARRATION_MODE: VoiceNarrationMode = "smart";
export const VOICE_NARRATION_STORAGE_KEY = "streamsense.voiceNarrationMode.v1";
export const VOICE_NARRATION_MODE_LABELS: Record<VoiceNarrationMode, string> = {
  smart: "Smart narration",
  over_audio: "Narrate over audio",
  narration_only: "Narration only",
};

export function nextVoiceNarrationMode(mode: VoiceNarrationMode): VoiceNarrationMode {
  const index = VOICE_NARRATION_MODES.indexOf(mode);
  return VOICE_NARRATION_MODES[(index + 1) % VOICE_NARRATION_MODES.length];
}
```

Implement guarded storage reads/writes and a shortcut predicate matching only unmodified, non-repeating `KeyN`. Storage helpers accept narrow injected `getItem`/`setItem` objects so Node tests do not require a browser.

- [ ] **Step 4: Run the helper tests and verify they pass**

Run: `node --experimental-strip-types --test chrome-extension/test/voiceNarration.test.ts`

Expected: all voice-narration helper tests PASS.

- [ ] **Step 5: Add the persisted mode to configuration context**

Initialize the configuration state synchronously:

```ts
const [options, setOptions] = useState<ConfigurationOptions>(() => ({
  narrationLevel: NarrationMode.Standard,
  voiceNarrationMode: readVoiceNarrationMode(),
}));

const setVoiceNarrationMode = useCallback((mode: VoiceNarrationMode) => {
  setOptions((current) => ({ ...current, voiceNarrationMode: mode }));
  writeVoiceNarrationMode(mode);
}, []);
```

Expose `setVoiceNarrationMode` from the context instead of making each caller persist separately.

- [ ] **Step 6: Add the selector and side-panel shortcut**

In `ConfigurationSection`, render the existing Narration level selector and a second labeled Voice narration selector. Add one `window.keydown` effect:

```ts
if (
  !isVoiceNarrationShortcut(event)
  || isEditableShortcutTarget(event.target)
) return;
event.preventDefault();
const next = nextVoiceNarrationMode(options.voiceNarrationMode);
setVoiceNarrationMode(next);
setAnnouncement(`Voice narration: ${VOICE_NARRATION_MODE_LABELS[next]}`);
```

Use the same `changeVoiceNarrationMode(mode)` callback for selector changes. Render the status in an `aria-live="polite"` element and expose `(N)` in visible label/help copy.

- [ ] **Step 7: Run extension tests and build**

Run: `npm run test --workspace chrome-extension`

Expected: all extension tests PASS.

Run: `npm run build --workspace chrome-extension`

Expected: TypeScript and Vite build PASS.

- [ ] **Step 8: Commit the preference and UI unit**

```bash
git add chrome-extension/src/sidepanel/voiceNarration.ts chrome-extension/test/voiceNarration.test.ts chrome-extension/src/sidepanel/context/ConfigurationContext.tsx chrome-extension/src/sidepanel/components/ConfigurationSection.tsx
git commit -m "feat: add persistent voice narration setting"
```

---

### Task 2: Protocol contract and backend speech-policy modes

**Files:**
- Create: `ai-voice-realtime/src/protocol/voiceNarrationMode.js`
- Modify: `ai-voice-realtime/src/protocol/browserMessages.js`
- Modify: `ai-voice-realtime/src/session/speechPolicy.js`
- Modify: `ai-voice-realtime/test/browserMessages.test.js`
- Modify: `ai-voice-realtime/test/speechPolicy.test.js`

**Interfaces:**
- Produces: `VOICE_NARRATION_MODES`, `VoiceNarrationMode`, and `isVoiceNarrationMode(value)` for backend modules.
- Produces: parsed `session_config.voiceNarrationMode`, defaulting to `smart` when omitted.
- Produces: `SpeechPolicy.setVoiceNarrationMode(mode): SpeechAction[]`.
- Extends narration candidates with optional `smartEligible`; omission means `true` for existing callers.

- [ ] **Step 1: Add failing protocol tests**

```js
assert.deepEqual(
  parseBrowserMessage('{"type":"session_config","narrationLevel":"standard","researchMode":"normal","voiceNarrationMode":"over_audio"}'),
  { type: "session_config", narrationLevel: "standard", researchMode: "normal", voiceNarrationMode: "over_audio" },
);
assert.equal(
  parseBrowserMessage('{"type":"session_config","narrationLevel":"standard"}').voiceNarrationMode,
  "smart",
);
assert.throws(
  () => parseBrowserMessage('{"type":"session_config","narrationLevel":"standard","voiceNarrationMode":"always"}'),
  /Invalid browser message/,
);
```

- [ ] **Step 2: Add failing policy tests for mode gates and replacement**

Add tests that demonstrate:

```js
fixture.policy.setVoiceNarrationMode("over_audio");
fixture.policy.setLocalTabSpeech(true);
fixture.policy.offerNarration(candidate("event:a", { createdAtMs: 10, smartEligible: false }));
assert.equal(fixture.policy.poll()[0].type, "start_narration");
```

Also assert that a newer lower-importance candidate replaces an older pending
candidate in `over_audio`, while Smart retains importance-aware replacement.
Add transition tests for entering Smart during tab speech, entering an
always-narrate mode with a pending candidate, and invalid mode rejection.

- [ ] **Step 3: Run focused backend tests and verify they fail**

Run: `node --test ai-voice-realtime/test/browserMessages.test.js ai-voice-realtime/test/speechPolicy.test.js`

Expected: FAIL because the mode contract and policy setter do not exist.

- [ ] **Step 4: Add the backend mode contract and protocol default**

```js
export const VOICE_NARRATION_MODES = ["smart", "over_audio", "narration_only"];
export const VoiceNarrationMode = Object.freeze({
  SMART: "smart",
  OVER_AUDIO: "over_audio",
  NARRATION_ONLY: "narration_only",
});
export function isVoiceNarrationMode(value) {
  return VOICE_NARRATION_MODES.includes(value);
}
```

Use `z.enum(VOICE_NARRATION_MODES).default("smart")` in the strict
`session_config` schema.

- [ ] **Step 5: Implement mode-aware speech policy**

Add a private mode initialized to Smart and validate all transitions. Preserve
existing candidate compatibility with:

```js
function copyCandidate(candidate) {
  return { ...candidate, smartEligible: candidate.smartEligible !== false };
}
```

Use a mode-aware readiness method:

```js
#canNarrate() {
  if (this.#liveState !== "ready") return false;
  if (this.#voiceNarrationMode !== VoiceNarrationMode.SMART) return true;
  return this.#tabAudioState !== "degraded"
    && !this.#localTabSpeech
    && !this.#cloudTabSpeech;
}
```

Apply the silence deadline only in Smart. In always-narrate modes, replace a
pending candidate whenever the new semantic key differs and `createdAtMs` is
newer, regardless of importance. Store candidate Smart eligibility with active
and reserved narration so entering Smart can invalidate ineligible work.
Local/cloud tab speech and degraded tab context cancel narration only while the
current mode is Smart.

- [ ] **Step 6: Run focused backend tests**

Run: `node --test ai-voice-realtime/test/browserMessages.test.js ai-voice-realtime/test/speechPolicy.test.js`

Expected: all focused protocol and policy tests PASS.

- [ ] **Step 7: Run the complete backend suite**

Run: `npm run test --workspace ai-voice-realtime`

Expected: all backend tests PASS.

- [ ] **Step 8: Commit the protocol and policy unit**

```bash
git add ai-voice-realtime/src/protocol/voiceNarrationMode.js ai-voice-realtime/src/protocol/browserMessages.js ai-voice-realtime/src/session/speechPolicy.js ai-voice-realtime/test/browserMessages.test.js ai-voice-realtime/test/speechPolicy.test.js
git commit -m "feat: add backend voice narration policy modes"
```

---

### Task 3: Recorded timeline event candidate integration

**Files:**
- Create: `ai-voice-realtime/src/session/narrationCandidate.js`
- Create: `ai-voice-realtime/test/narrationCandidate.test.js`
- Modify: `ai-voice-realtime/src/session/clientSession.js`
- Modify: `ai-voice-realtime/test/clientSession.test.js`

**Interfaces:**
- Consumes: backend `VoiceNarrationMode` contract and `SpeechPolicy.setVoiceNarrationMode`.
- Produces: `buildModeNarrationCandidate(input): NarrationCandidate | null`.
- Produces: `ClientSession.voiceNarrationMode`, default `smart`.
- Changes `recordVisionEvent` and `recordNarrationEvent` to return the event-store result object so the exact published event can supply spoken text.

- [ ] **Step 1: Write failing candidate-selection tests**

Test a shared fixture containing a recorded event and atomic analysis:

```js
const recordedEvent = {
  id: "event-1",
  eventType: "score_changed",
  description: "The score is now 2-1.",
  importance: 0.8,
};

assert.equal(buildModeNarrationCandidate({
  voiceNarrationMode: "smart",
  narrationLevel: "standard",
  persistenceStatus: "recorded",
  recordedEvent,
  analysis: { shouldNarrate: true, isNew: true, coveredByTabSpeech: true, importance: 0.8, description: "Score changed.", semanticKey: "score:2-1" },
  createdAtMs: 100,
}), null);

assert.deepEqual(buildModeNarrationCandidate({
  voiceNarrationMode: "over_audio",
  narrationLevel: "standard",
  persistenceStatus: "recorded",
  recordedEvent,
  analysis: { shouldNarrate: false, isNew: false, coveredByTabSpeech: false, importance: 0.2, description: "", semanticKey: null },
  createdAtMs: 100,
}), {
  description: "The score is now 2-1.",
  semanticKey: "score_changed:the-score-is-now-2-1",
  importance: 0.8,
  createdAtMs: 100,
  smartEligible: false,
});
```

Add cases for `question_only`, duplicate/not-recorded results, invalid event
descriptions, Smart success, and `narration_only`.

- [ ] **Step 2: Run the candidate test and verify it fails**

Run: `node --test ai-voice-realtime/test/narrationCandidate.test.js`

Expected: FAIL with module-not-found for `narrationCandidate.js`.

- [ ] **Step 3: Implement the pure candidate builder**

Return `null` unless the event was recorded, candidate offering is allowed,
Narration level is not `question_only`, and the recorded event has safe bounded
text. Calculate Smart eligibility from the existing conditions. Smart returns
the atomic narration description and semantic key. Always-narrate modes return
the recorded event description and use a bounded normalized event-derived key
when the atomic semantic key is absent.

- [ ] **Step 4: Run candidate tests**

Run: `node --test ai-voice-realtime/test/narrationCandidate.test.js`

Expected: all candidate tests PASS.

- [ ] **Step 5: Write failing ClientSession integration tests**

Add tests proving that:

- `session_config` calls `setVoiceNarrationMode` and polls the policy;
- a recorded event is published before `offerNarration` is called;
- `over_audio` offers the persisted event description even when atomic
  `shouldNarrate` is false;
- Smart preserves current transcript-coverage suppression; and
- `question_only` records/publishes the event but never offers speech.

Use ordered spies such as:

```js
const order = [];
eventStore.record = () => ({ status: "recorded", event: recordedEvent });
browser.send = (payload) => {
  if (JSON.parse(payload).type === "event") order.push("published");
};
speechPolicy.offerNarration = () => {
  order.push("offered");
  return [];
};
assert.deepEqual(order, ["published", "offered"]);
```

- [ ] **Step 6: Integrate mode-aware candidates in ClientSession**

Initialize `voiceNarrationMode` to Smart. On `session_config`, update the local
mode, apply `speechPolicy.setVoiceNarrationMode?.(mode)`, poll, and reschedule.

Refactor event-record methods to return `{ status, event? }` while preserving
telemetry and error behavior. In `recordGroundedAnalysis`, publish the newly
recorded event first, then call `buildModeNarrationCandidate` and offer a
non-null result to the policy.

- [ ] **Step 7: Run ClientSession and full backend tests**

Run: `node --test ai-voice-realtime/test/clientSession.test.js ai-voice-realtime/test/narrationCandidate.test.js`

Expected: focused integration tests PASS.

Run: `npm run test --workspace ai-voice-realtime`

Expected: complete backend suite PASS.

- [ ] **Step 8: Commit the timeline integration unit**

```bash
git add ai-voice-realtime/src/session/narrationCandidate.js ai-voice-realtime/test/narrationCandidate.test.js ai-voice-realtime/src/session/clientSession.js ai-voice-realtime/test/clientSession.test.js
git commit -m "feat: narrate recorded timeline events by mode"
```

---

### Task 4: Extension WebSocket configuration and audio mixing

**Files:**
- Modify: `chrome-extension/src/sidepanel/App.tsx`
- Modify: `chrome-extension/src/sidepanel/realtime/useRealtimeSession.ts`
- Modify: `chrome-extension/src/sidepanel/realtime/speechCoordinator.ts`
- Modify: `chrome-extension/src/sidepanel/realtime/mediaAudio.ts`
- Modify: `chrome-extension/test/protocolContract.test.ts`
- Modify: `chrome-extension/test/speechCoordinator.test.ts`
- Modify: `chrome-extension/test/mediaAudio.test.ts`

**Interfaces:**
- Consumes: extension `VoiceNarrationMode` and persisted configuration.
- Changes: `useRealtimeSession(narrationLevel, voiceNarrationMode)`.
- Changes: `new SpeechCoordinator({ voiceNarrationMode, ... })` and `setVoiceNarrationMode(mode)`.
- Changes: `setTabGain(gain: 0 | 0.3 | 0.4 | 1, fadeMs)`.

- [ ] **Step 1: Write failing coordinator tests**

Extend the fixture to accept a voice mode and record gain calls. Add assertions:

```ts
const overAudio = createCoordinator({ voiceNarrationMode: "over_audio" });
assert.equal(overAudio.coordinator.modelAudio(narrationChunk("narration-1")), true);
assert.deepEqual(overAudio.gains.at(-1), [0.4, 150]);
overAudio.coordinator.turnComplete({ turnId: "narration-1", mode: "narration" });
overAudio.playback.finish("narration-1");
assert.deepEqual(overAudio.gains.at(-1), [1, 250]);

const only = createCoordinator({ voiceNarrationMode: "narration_only" });
assert.deepEqual(only.gains.at(-1), [0, 50]);
only.coordinator.typedQuestionStarted("answer-1");
only.coordinator.failTurn("answer-1", "failed");
assert.equal(only.gains.some(([gain]) => gain === 1), false);
```

Add tests for Smart cancellation on tab activity, always-narrate acceptance
during tab activity, and live mode transitions during narration and answers.

- [ ] **Step 2: Write failing protocol and media tests**

Require outbound session configuration to contain:

```ts
{
  type: "session_config",
  narrationLevel: "standard",
  researchMode: "normal",
  voiceNarrationMode: "over_audio",
}
```

Add a media test that calls `setTabGain(0.4, 150)` and verifies the playback
gain node reaches 0.4 while the separate worklet monitor remains at 0.

- [ ] **Step 3: Run focused extension tests and verify they fail**

Run: `node --experimental-strip-types --test chrome-extension/test/speechCoordinator.test.ts chrome-extension/test/mediaAudio.test.ts chrome-extension/test/protocolContract.test.ts`

Expected: FAIL because 0.4, the mode setter, and the wire field are missing.

- [ ] **Step 4: Refactor SpeechCoordinator to derive gain from state**

Track `voiceNarrationMode` and the last requested gain. Replace direct
duck/restore calls with a method that calculates:

```ts
private targetTabGain(): 0 | 0.3 | 0.4 | 1 {
  if (this.voiceNarrationMode === "narration_only") return 0;
  if (this.active?.mode === "answer") return this.active.userSpeaking ? 0 : 0.3;
  if (this.active?.mode === "narration" && this.voiceNarrationMode === "over_audio") return 0.4;
  return 1;
}
```

Choose 50 ms for muting, 150 ms for ducking, and 250 ms for restoring. Recompute
after every active-turn, user-speaking, mode, playback-idle, failure, and stop
transition. Reject/cancel tab-active narration only in Smart mode.

- [ ] **Step 5: Wire the mode through App and useRealtimeSession**

Pass `options.voiceNarrationMode` into the hook. Store it in a ref, include it in
every `session_config`, initialize `SpeechCoordinator` with it, and add an effect:

```ts
useEffect(() => {
  voiceNarrationModeRef.current = voiceNarrationMode;
  speechCoordinatorRef.current?.setVoiceNarrationMode(voiceNarrationMode);
  const websocket = websocketRef.current;
  if (websocket?.readyState === WebSocket.OPEN) {
    websocket.send(JSON.stringify({
      type: "session_config",
      narrationLevel: narrationLevelRef.current,
      researchMode: researchModeRef.current,
      voiceNarrationMode,
    }));
  }
}, [voiceNarrationMode]);
```

Update the existing narration-level and research-mode send sites so none can
omit the field and accidentally reset the backend to Smart.

- [ ] **Step 6: Extend MediaAudio gain typing**

Accept exactly `0 | 0.3 | 0.4 | 1`. Keep the same cancellation and ramp logic;
do not alter the worklet capture branch or monitor gain.

- [ ] **Step 7: Run focused and complete extension verification**

Run: `node --experimental-strip-types --test chrome-extension/test/voiceNarration.test.ts chrome-extension/test/speechCoordinator.test.ts chrome-extension/test/mediaAudio.test.ts chrome-extension/test/protocolContract.test.ts`

Expected: focused tests PASS.

Run: `npm run test --workspace chrome-extension`

Expected: complete extension tests PASS.

Run: `npm run build --workspace chrome-extension`

Expected: TypeScript and Vite build PASS.

- [ ] **Step 8: Commit extension realtime integration**

```bash
git add chrome-extension/src/sidepanel/App.tsx chrome-extension/src/sidepanel/realtime/useRealtimeSession.ts chrome-extension/src/sidepanel/realtime/speechCoordinator.ts chrome-extension/src/sidepanel/realtime/mediaAudio.ts chrome-extension/test/protocolContract.test.ts chrome-extension/test/speechCoordinator.test.ts chrome-extension/test/mediaAudio.test.ts
git commit -m "feat: apply voice narration audio modes"
```

---

### Task 5: Documentation and repository verification

**Files:**
- Modify: `README.md`
- Modify: `docs/architecture.md`
- Modify: `chrome-extension/README.md`
- Modify: `ai-voice-realtime/README.md`

**Interfaces:**
- Consumes: the completed wire values, UI labels, shortcut, policy, persistence,
  and gain behavior from Tasks 1-4.
- Produces: user and maintainer documentation matching verified behavior.

- [ ] **Step 1: Update user-facing documentation**

Document the two independent selectors, the three Voice narration labels,
Smart default, persistence across side-panel reopen, focused-side-panel `N`
cycle, editable-field protection, 40% narration duck, permanent local mute in
Narration only, continued tab capture/transcription, latest-event coalescing,
and question priority.

- [ ] **Step 2: Update architecture and backend contracts**

Document `session_config.voiceNarrationMode`, Smart compatibility default,
recorded-event-before-speech ordering, mode-specific tab-speech/health gates,
and the fact that no dashboard, persistence, prompt, VAD, or capture ownership
changed.

- [ ] **Step 3: Check documentation claims against code**

Run: `rg -n "Voice narration|Smart narration|Narrate over audio|Narration only|voiceNarrationMode|40%|KeyN|\bN\b" README.md docs/architecture.md chrome-extension/README.md ai-voice-realtime/README.md chrome-extension/src ai-voice-realtime/src`

Expected: every user-facing claim has a corresponding implemented code path and
wire values remain internal where appropriate.

- [ ] **Step 4: Run whitespace and focused verification**

Run: `git diff --check`

Expected: no whitespace errors.

Run: `npm run test --workspace ai-voice-realtime`

Expected: backend tests PASS.

Run: `npm run test --workspace chrome-extension`

Expected: extension tests PASS.

- [ ] **Step 5: Commit documentation**

```bash
git add README.md docs/architecture.md chrome-extension/README.md ai-voice-realtime/README.md
git commit -m "docs: explain voice narration modes"
```

- [ ] **Step 6: Run the full repository gate**

Run: `npm run check`

Expected: orchestration, backend, extension, and dashboard tests/typechecks/builds PASS. Record non-blocking warnings separately.

---

### Task 6: Independent review and final correction loop

**Files:**
- Review: every file changed after commit `dc959cd`
- Modify: only files required by confirmed review findings
- Test: focused suites for each corrected finding

**Interfaces:**
- Consumes: complete implementation and fresh verification evidence.
- Produces: independent backend and extension review reports with severity and exact file/line evidence.

- [ ] **Step 1: Dispatch the backend reviewer**

Ask an independent agent to inspect protocol compatibility, recorded-event-before-speech ordering, Smart parity, mode transitions, one-slot coalescing, bounded policy state, question priority, and tests. Require findings only, ordered by severity, with exact paths and line numbers.

- [ ] **Step 2: Dispatch the extension reviewer**

Ask an independent agent to inspect preference safety, `N` accessibility, selector semantics, all gain priorities, mid-turn mode changes, narration-only leakage, capture/playback separation, stale audio rejection, and tests. Require findings only, ordered by severity, with exact paths and line numbers.

- [ ] **Step 3: Triage every finding against the approved spec**

For each finding, reproduce or verify it with a focused test or direct code-path
trace. Reject suggestions that contradict product boundaries; implement only
confirmed issues.

- [ ] **Step 4: Correct confirmed findings test-first**

Add a regression test that fails for each confirmed issue, run it to observe the
failure, make the smallest scoped fix, and rerun the affected backend or
extension suite.

- [ ] **Step 5: Run final verification from fresh state**

Run: `git diff --check`

Expected: no whitespace errors.

Run: `npm run check`

Expected: every repository gate PASS; warnings are reported separately.

- [ ] **Step 6: Review final Git scope**

Run: `git status --short`

Run: `git diff --stat dc959cd..HEAD`

Run: `git diff --name-only dc959cd..HEAD`

Expected: only voice narration implementation, tests, plan/spec, and required
documentation are present; no dashboard/account or unrelated files changed.
