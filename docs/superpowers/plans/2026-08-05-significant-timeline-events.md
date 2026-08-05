# Significant Timeline Events Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Record significant page-section transitions and dynamic on-screen events with higher visual recall, grounded transition evidence, bounded retry, and a five-second duplicate window.

**Architecture:** The extension replaces sparse center-pixel sampling with a pure 96-column area-averaged signature and commits signatures only after a frame is sent or retained. The backend extends the Gemini Interactions structured result with visible state and event evidence, validates transition claims against a bounded state cache, retries one failed immutable snapshot once, and shares one five-second dedupe default.

**Tech Stack:** TypeScript, React, Chrome tab capture, Node.js, Zod, Gemini Interactions REST API, `node:test`, SQLite via `better-sqlite3`.

## Global Constraints

- Keep capture and provider admission at no more than one frame per second.
- Preserve single-flight latest-frame coalescing and WebSocket backpressure behavior.
- Do not add content scripts, DOM/scroll instrumentation, Chrome permissions, or Timeline UI changes.
- Describe observed visual state, never an inferred click or scroll action.
- Record timeline events independently from spoken narration eligibility.
- Preserve `store: false`, the Interactions structured-output contract, abort propagation, and the configured Gemini vision model.
- Keep microphone, Gemini Live, captured-tab STT, Q&A, and speech policy unchanged.
- Use test-driven development: every production behavior starts with an observed failing test.
- Stage and commit only files named by the current task; preserve the existing unrelated Live/audio working-tree changes.

---

## File Structure

- `chrome-extension/src/sidepanel/realtime/frameCapture.ts`: frame dimensions, JPEG encoding, area-averaged signatures, and pure visual-change comparison.
- `chrome-extension/src/sidepanel/realtime/useRealtimeSession.ts`: canvas/session orchestration and transactional signature commit after send or latest-frame retention.
- `chrome-extension/test/frameCapture.test.ts`: synthetic raster, threshold, adjacency, scheduler, and commit-order coverage.
- `ai-voice-realtime/src/gemini/visualState.js`: strict visible-state/evidence schemas, normalization, bounded cache, and deterministic evidence validation.
- `ai-voice-realtime/src/gemini/vision.js`: Interactions response schema and grounded prompt/request input.
- `ai-voice-realtime/test/vision.test.js`: prompt, JSON Schema, response validation, and prior-state request contract.
- `ai-voice-realtime/src/session/clientSession.js`: prior-state snapshot handoff, evidence-gated event recording, cache ownership, and retry scheduling.
- `ai-voice-realtime/test/clientSession.test.js`: real browser-message-path state, evidence, coalescing, and retry tests.
- `ai-voice-realtime/src/events/deduplicate.js`: shared five-second default.
- `ai-voice-realtime/src/events/eventStore.js`: import and use the shared default.
- `ai-voice-realtime/test/eventStore.test.js`: exact five-second and greater-than-five-second boundaries.
- `ai-voice-realtime/test/eventSchema.test.js`: direct standalone deduplicator default coverage if that file remains the closest existing unit-test home; otherwise create `ai-voice-realtime/test/deduplicate.test.js`.

---

### Task 1: Area-Averaged Visual-Change Admission

**Files:**
- Modify: `chrome-extension/src/sidepanel/realtime/frameCapture.ts`
- Modify: `chrome-extension/src/sidepanel/realtime/useRealtimeSession.ts`
- Modify: `chrome-extension/test/frameCapture.test.ts`

**Interfaces:**
- Produces: `FrameSignature = { columns: number; rows: number; luminance: Uint8Array }`.
- Produces: `createFrameSignature(pixels: Uint8ClampedArray, width: number, height: number): FrameSignature`.
- Produces: `hasMeaningfulVisualChange(previous: FrameSignature | null, current: FrameSignature): boolean`.
- Uses exact thresholds: 96 columns, changed-cell difference `18`, changed-cell ratio `0.008`, mean difference `4`, localized adjacent-cell difference `24`.

- [ ] **Step 1: Add failing synthetic-raster signature tests**

Add helpers that build RGBA rasters and paint rectangular patches. Assert that area-averaged signatures detect patches placed both over and between the old 48-column center sample locations:

```ts
const base = solidRgba(192, 108, 0);
const changed = base.slice();
paintRect(changed, 192, { x: 25, y: 9, width: 8, height: 8, value: 255 });

const before = createFrameSignature(base, 192, 108);
const after = createFrameSignature(changed, 192, 108);
assert.equal(hasMeaningfulVisualChange(before, after), true);
```

Add separate assertions for first/incompatible signatures, `0.8%` distributed changes, mean difference `4`, horizontal adjacency, vertical adjacency, row-wrap rejection, one isolated strong cell, and sub-threshold noise.

- [ ] **Step 2: Run the focused test and verify RED**

Run:

```bash
cd chrome-extension
node --experimental-strip-types --test test/frameCapture.test.ts
```

Expected: FAIL because `FrameSignature`, `createFrameSignature`, and `hasMeaningfulVisualChange` are not exported from `frameCapture.ts`.

- [ ] **Step 3: Implement the pure signature and comparison functions**

Compute rows with `Math.max(1, Math.round(96 * height / width))`. For each grid cell, average every source pixel in its floor-bounded rectangle, including clipped edge cells. Reject non-positive dimensions. Compare only signatures whose `columns`, `rows`, and luminance lengths match. Check horizontal neighbors only when `column + 1 < columns`; check vertical neighbors using `index + columns`.

- [ ] **Step 4: Verify the detector tests are GREEN**

Run the focused test again. Expected: all frame-capture tests pass.

- [ ] **Step 5: Add failing transactional signature-commit coverage**

Add a small exported helper that commits only after its retention callback completes:

```ts
export function commitRetainedFrame<T>(
  signature: FrameSignature,
  retain: () => T,
): { signature: FrameSignature; result: T }
```

Test that a throwing conversion/send callback produces no returned committed signature, while successful immediate send and latest-frame retention return the exact signature once. This makes the hook's mutation order observable without mounting React.

- [ ] **Step 6: Run the new commit tests and verify RED**

Expected: FAIL because `commitRetainedFrame` does not exist.

- [ ] **Step 7: Implement commit ordering in the helper and hook**

In `useRealtimeSession.ts`, replace local signature functions with imports. Convert the JPEG to base64 before retention. Wrap either `websocket.send(...)` or `latestFrameRef.current = frame` in `commitRetainedFrame`, then assign `lastFrameSignatureRef.current` from the returned signature. A thrown conversion or send must leave the previous signature unchanged.

- [ ] **Step 8: Run focused and full extension tests**

```bash
cd chrome-extension
node --experimental-strip-types --test test/frameCapture.test.ts
npm test
```

Expected: all tests pass.

- [ ] **Step 9: Commit Task 1 only**

```bash
git add chrome-extension/src/sidepanel/realtime/frameCapture.ts \
  chrome-extension/src/sidepanel/realtime/useRealtimeSession.ts \
  chrome-extension/test/frameCapture.test.ts
git commit -m "feat: detect compact visual changes"
```

---

### Task 2: Structured Visible State and Event Evidence

**Files:**
- Create: `ai-voice-realtime/src/gemini/visualState.js`
- Modify: `ai-voice-realtime/src/gemini/vision.js`
- Modify: `ai-voice-realtime/test/vision.test.js`

**Interfaces:**
- Produces: `visibleStateSchema` with strict `{ domain, identity, value, summary }` limits `80/160/160/300`.
- Produces: `eventEvidenceSchema` with `basis: "current_frame" | "state_transition"` and nullable `previousState`.
- Produces: `normalizeVisibleStateKey(state): string` using trimmed, collapsed, lowercased domain and identity.
- `analyzeVisionFrame` consumes `priorVisibleStates: VisibleState[]` and returns `visibleState` plus `eventEvidence`.

- [ ] **Step 1: Extend vision tests with the wished-for result contract**

Update provider fixtures to include:

```js
visibleState: {
  domain: "sports_score",
  identity: "Team A vs Team B",
  value: "2-1",
  summary: "Team A leads Team B 2-1.",
},
eventEvidence: {
  basis: "state_transition",
  previousState: {
    domain: "sports_score",
    identity: "Team A vs Team B",
    value: "1-1",
    summary: "The score is 1-1.",
  },
},
```

Assert both fields are required by the Interactions JSON Schema; `event`/`eventEvidence` presence matches; transition evidence requires previous state; current-frame evidence requires `previousState: null`; state string limits and snake-case domain are enforced.

- [ ] **Step 2: Add prompt/prior-state tests**

Call `buildAnalysisPrompt` with a prior-state array. Assert the prompt includes material section transitions, goals/scores, observed-state-only wording, compatible domain+identity rules, static-score restrictions, routine-motion rejection, and serialized bounded prior states.

- [ ] **Step 3: Run vision tests and verify RED**

```bash
cd ai-voice-realtime
node --test test/vision.test.js
```

Expected: FAIL because the schema and prompt do not include visible state or evidence.

- [ ] **Step 4: Implement strict schemas and the Interactions JSON Schema**

Create `visualState.js` with reusable Zod schemas and normalization. Import them into `vision.js`, add the nullable fields to `visionAnalysisSchema`, and inline equivalent lower-case JSON Schema objects in `analysisResponseSchema`. Preserve `response_format`, `store: false`, `thinking_level: "minimal"`, abort propagation, and model-output parsing confirmed by the official Gemini documentation.

- [ ] **Step 5: Update grounded prompt construction**

Replace the single previous-description argument with a bounded `priorVisibleStates` array. Explain that the exact current frame remains authoritative; cached state may prove a transition only on normalized domain+identity match; static scores use `score_visible`; explicit current-frame announcements use `current_frame`; routine motion remains null. Keep captured-tab transcript explicitly untrusted.

- [ ] **Step 6: Run vision tests and verify GREEN**

Run `node --test test/vision.test.js`. Expected: all pass.

- [ ] **Step 7: Commit Task 2 only**

```bash
git add ai-voice-realtime/src/gemini/visualState.js \
  ai-voice-realtime/src/gemini/vision.js \
  ai-voice-realtime/test/vision.test.js
git commit -m "feat: structure visual event evidence"
```

---

### Task 3: Grounded-State Cache and Evidence-Gated Recording

**Files:**
- Modify: `ai-voice-realtime/src/gemini/visualState.js`
- Modify: `ai-voice-realtime/src/session/clientSession.js`
- Modify: `ai-voice-realtime/test/clientSession.test.js`

**Interfaces:**
- Produces: `GroundedVisibleStateCache({ maxEntries = 8, maxAgeMs = 120_000 })`.
- Produces: `list(nowMs): VisibleState[]`, `findMatching(state, nowMs): VisibleState | null`, `update(state, observedAtMs, frameSequence): void`, and `clear(): void`.
- Produces: `validateEventEvidence(analysis, cache, nowMs): { valid: boolean; reason?: string }`.

- [ ] **Step 1: Add failing cache unit behavior through client-session tests**

Use the real `video_frame` browser-message path and sequential fake analyses to prove:

- `1-1 -> null routine frame -> 2-1` retains compatible score history;
- a different match identity cannot supply previous evidence;
- cache expiry after `120_000` ms prevents transition evidence;
- nine identities evict the oldest and keep eight;
- closing the session clears the cache.

- [ ] **Step 2: Add failing evidence-gate tests**

Assert a valid same-domain, same-identity, different-value `score_changed` event is persisted and published. Assert static score transition claims, equal-value transitions, incompatible identity, stale previous state, `event`/evidence mismatch, and `current_frame` with non-null previous state are rejected with telemetry and no database record. Assert `score_visible` with valid current-frame evidence records even when `shouldNarrate` is false.

- [ ] **Step 3: Run focused session tests and verify RED**

```bash
cd ai-voice-realtime
node --test --test-name-pattern="visible state|transition evidence|static score|state cache" test/clientSession.test.js
```

Expected: FAIL because cache and deterministic evidence validation do not exist.

- [ ] **Step 4: Implement the bounded cache and validator**

In `visualState.js`, prune expired entries before every list/find/update, key by normalized domain+identity, reject older frame-sequence updates, refresh insertion order on a valid newer update, and evict oldest entries above eight. Validate `state_transition` by matching cached previous state, compatible current identity, and different normalized values. Require `score_changed` to use `state_transition`; require `current_frame` to carry no previous state.

- [ ] **Step 5: Integrate prior-state ownership into ClientSession**

Instantiate the cache in the constructor. Snapshot `list(this.elapsedMilliseconds)` into every analysis request. In `recordGroundedAnalysis`, validate evidence before recording or cache mutation; invalid evidence emits bounded telemetry and returns without recording/updating. Valid results update current state chronologically, then preserve the existing semantic narration state and speech-offer rules. Clear the cache during close.

- [ ] **Step 6: Update existing analysis fixtures**

Make `suppressedAnalysis`, `approvedAnalysis`, and `semanticAnalysis` emit valid default `visibleState`/`eventEvidence` pairs. For tests specifically exercising fallback narration, use `event: null` and `eventEvidence: null`. Keep each existing test's intended semantic-key behavior unchanged.

- [ ] **Step 7: Run focused and complete backend tests**

```bash
cd ai-voice-realtime
node --test test/clientSession.test.js test/vision.test.js
npm run check
```

Expected: all tests pass.

- [ ] **Step 8: Commit Task 3 only**

```bash
git add ai-voice-realtime/src/gemini/visualState.js \
  ai-voice-realtime/src/session/clientSession.js \
  ai-voice-realtime/test/clientSession.test.js
git commit -m "feat: validate grounded visual transitions"
```

---

### Task 4: One Bounded Retry per Immutable Frame Sequence

**Files:**
- Modify: `ai-voice-realtime/src/session/clientSession.js`
- Modify: `ai-voice-realtime/test/clientSession.test.js`

**Interfaces:**
- `startAtomicNarration(initial, snapshot, userTurnEpoch, { retryAttempted = false } = {})` owns retry state on the active record.
- A retry timer is owned by the session and canceled by newer accepted frames or close.
- The hash confirms the snapshot remains current; `frameSequence` owns the retry budget.

- [ ] **Step 1: Add failing fake-timer retry tests**

Cover: one non-abort failure schedules a retry at `1_000` ms; the retry uses the same immutable frame/timestamp/sequence; success records once; a second failure does not schedule again; a newer frame cancels the retry; close cancels it; an abort does not retry; and the same image hash after a different frame receives a fresh retry budget.

- [ ] **Step 2: Run focused tests and verify RED**

```bash
cd ai-voice-realtime
node --test --test-name-pattern="analysis retry|stable frame|same image hash" test/clientSession.test.js
```

Expected: FAIL because analysis errors only publish `analysis_error`.

- [ ] **Step 3: Implement retry ownership**

Add `atomicRetryTimer` to session state. On non-abort failure, publish the existing recoverable error and schedule once only when the record's snapshot sequence/hash still matches `latestFrame` and no newer pending analysis exists. Timer callback rechecks ownership before starting the same snapshot with `retryAttempted: true`. `sendVideo` cancels an older retry when accepting a newer sequence. `close` clears the timer.

- [ ] **Step 4: Run retry, session, and backend suites**

```bash
cd ai-voice-realtime
node --test test/clientSession.test.js
npm run check
```

Expected: all tests pass without leaked timers.

- [ ] **Step 5: Commit Task 4 only**

```bash
git add ai-voice-realtime/src/session/clientSession.js \
  ai-voice-realtime/test/clientSession.test.js
git commit -m "fix: retry one stable visual analysis"
```

---

### Task 5: Shared Five-Second Duplicate Window and Final Verification

**Files:**
- Modify: `ai-voice-realtime/src/events/deduplicate.js`
- Modify: `ai-voice-realtime/src/events/eventStore.js`
- Modify: `ai-voice-realtime/test/eventStore.test.js`
- Create or modify: `ai-voice-realtime/test/deduplicate.test.js`

**Interfaces:**
- Produces: `DEFAULT_DUPLICATE_WINDOW_SECONDS = 5` exported from `deduplicate.js`.
- `findDuplicateEvent` and `EventStore.record` both consume that exact default.

- [ ] **Step 1: Add failing boundary tests**

Directly test `findDuplicateEvent` without an explicit window and test `EventStore.record` at exactly `5.000` seconds (duplicate) and `5.001` seconds (recorded). Preserve coverage that distinct event types and meaningfully different descriptions record inside the window.

- [ ] **Step 2: Run event tests and verify RED**

```bash
cd ai-voice-realtime
node --test test/deduplicate.test.js test/eventStore.test.js
```

Expected: FAIL because both defaults are 12 seconds or the direct test file does not yet exist.

- [ ] **Step 3: Implement the shared constant**

Export `DEFAULT_DUPLICATE_WINDOW_SECONDS = 5` from `deduplicate.js`; use it in the deduplicator options and import it as the `EventStore.record` default. Do not change the existing `0.78` similarity threshold or database schema.

- [ ] **Step 4: Run event and full project verification**

```bash
cd ai-voice-realtime
node --test test/deduplicate.test.js test/eventStore.test.js
npm run check

cd ../chrome-extension
npm test
npm run build

cd ..
git diff --check
```

Expected: backend and extension suites pass, production extension build succeeds, and the diff has no whitespace errors.

- [ ] **Step 5: Perform sanitized provider verification**

Run one real Gemini Interactions smoke using the configured vision model and schema without printing credentials. Verify a schema-valid response contains `visibleState` and matching `eventEvidence` nullability. This proves provider compatibility only; it does not replace physical Chrome acceptance.

- [ ] **Step 6: Report manual acceptance separately**

If an interactive Chrome run is available, reload the built unpacked extension and verify the approved comments-section and known sports-event cases. If it is not available, report them as unverified instead of inferring success from automated tests.

- [ ] **Step 7: Commit Task 5 only**

```bash
git add ai-voice-realtime/src/events/deduplicate.js \
  ai-voice-realtime/src/events/eventStore.js \
  ai-voice-realtime/test/deduplicate.test.js \
  ai-voice-realtime/test/eventStore.test.js
git commit -m "fix: shorten timeline duplicate window"
```

---

## Completion Gate

- [ ] Every new production function was introduced by a failing focused test.
- [ ] Extension frame tests cover real synthetic rasters, not only hand-built signatures.
- [ ] Backend tests distinguish deterministic evidence validation from provider semantic behavior.
- [ ] Cache size, age, incompatible identity, interstitial null state, and chronological ownership are covered.
- [ ] Retry is bounded per frame sequence and canceled by replacement/close.
- [ ] Both dedupe defaults use and test the shared five-second constant.
- [ ] Backend `npm run check`, extension `npm test`, extension `npm run build`, and `git diff --check` pass freshly.
- [ ] Physical Chrome/provider results are labeled observed or unverified.
