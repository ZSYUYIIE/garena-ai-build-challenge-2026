# StreamSense Realtime Integration Review Findings 1-4 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Repair review findings 1-4 without changing StreamSense's backend-mediated Live architecture or source-separated audio contract.

**Architecture:** Centralize local microphone ownership transitions at the extension boundary, allocate Gemini input-audio transcript ownership only to microphone turns, route actual generic provider-write rejections through the existing generation-fenced reconnect, and make Cloud STT readiness depend on current-provider evidence. Every production change follows a focused RED/GREEN regression cycle.

**Tech Stack:** TypeScript 5.9, React 19, Chrome Manifest V3, Node.js ESM and built-in test runner, `@google/genai` 2.15.0, `@google-cloud/speech` 7.5.0

## Global Constraints

- Do not implement the typed-question length or cooldown mismatch.
- Preserve microphone PCM as Gemini Live's only raw conversational input.
- Preserve captured-tab PCM exclusively for Cloud Speech-to-Text.
- Do not add dependencies or protocol message types.
- Never replay ambiguous tool responses, typed text, narration, microphone PCM, or activity boundaries.
- Preserve only latest-frame behavior across a replacement Live generation.
- Report physical Chrome/provider acceptance as pending unless it is actually observed.

---

### Task 1: Race-safe extension microphone retirement

**Files:**
- Modify: `chrome-extension/src/sidepanel/realtime/sessionLifecycle.ts`
- Modify: `chrome-extension/src/sidepanel/realtime/useRealtimeSession.ts`
- Test: `chrome-extension/test/sessionLifecycle.test.ts`
- Test: `ai-voice-realtime/test/clientSession.test.js`

**Interfaces:**
- Produces: a local microphone owner with exact-turn `open`, `retire`, and current-owner guards.
- Consumes: existing `createMediaSocketProtocol.cancelUserActivity()`, VAD enable/reset behavior, backend `turn_complete`, and Live `provider_health`.

- [ ] Add extension tests that name the break: typed admission retires pending/open microphone ownership, stale packet/end callbacks cannot act, matching backend completion and health loss retire ownership, and a later turn opens fresh.
- [ ] Run `node --experimental-strip-types --test test/sessionLifecycle.test.ts` in `chrome-extension` and confirm the new tests fail because the ownership helper does not exist.
- [ ] Add a backend integration regression showing the safe `user_activity_end` then `typed_question` sequence accepts later stale local PCM suppression without browser policy closure.
- [ ] Run the focused backend test and confirm the regression fails against the unsafe sequence fixture.
- [ ] Implement the minimal ownership helper and wire one synchronous retirement transition into typed admission, matching completion, and non-ready Live health.
- [ ] Re-run both focused test files and confirm they pass.

### Task 2: Microphone-only input-audio transcript ownership

**Files:**
- Modify: `ai-voice-realtime/src/gemini/liveSession.js`
- Test: `ai-voice-realtime/test/liveSession.test.js`

**Interfaces:**
- Produces: `inputOwners` entries only for turns created by `startUserActivity()`.
- Preserves: response and output transcript FIFO ownership for typed, microphone, and narration turns.

- [ ] Replace the existing typed late-input assumption with failing typed-to-microphone and narration-to-microphone attribution regressions.
- [ ] Run the focused Live tests and confirm input transcription is missing or attributed to the text-only predecessor.
- [ ] Add a microphone-input flag to turn creation, enqueue only microphone turns in `inputOwners`, and filter settling input candidates by that flag.
- [ ] Re-run the focused Live tests and confirm correct microphone attribution with no text-only queue blockage.

### Task 3: Recover rejected generic Live writes

**Files:**
- Modify: `ai-voice-realtime/src/gemini/liveSession.js`
- Test: `ai-voice-realtime/test/liveSession.test.js`

**Interfaces:**
- Consumes: existing `generation`, `session`, `#reconnect({ allowResumption: false })`, `latestFrame`, and single-flight reconnect promise.
- Produces: generation-fenced recovery for rejected `sendRealtimeInput({video})` and `sendToolResponse(...)` writes.

- [ ] Add a failing rejected-video test that expects one hard reconnect, latest-frame delivery to the replacement, and a successful fresh typed turn.
- [ ] Add a failing rejected-tool-response test that expects one hard reconnect, no old response on the replacement, and a successful fresh microphone turn.
- [ ] Run the focused tests and confirm health remains degraded without a replacement connection.
- [ ] Implement one generic provider-write enqueue/recovery path with captured session/generation checks and non-resumable single-flight reconnect.
- [ ] Re-run focused tests, including late-rejection/GoAway/close races, and confirm one reconnect with no unsafe replay.

### Task 4: Provider-evidenced STT readiness

**Files:**
- Modify: `ai-voice-realtime/src/stt/googleSpeechTranscriber.js`
- Test: `ai-voice-realtime/test/googleSpeechTranscriber.test.js`
- Test: `ai-voice-realtime/test/clientSession.test.js`

**Interfaces:**
- Produces: connecting health after local stream construction; ready only after current-stream `metadata` or `data`.
- Preserves: provider-evidence retry reset and the existing bounded retry schedule.

- [ ] Update/add failing tests for initial connect, retry recovery, and rotation so ready is absent before evidence and published after current metadata/data.
- [ ] Run the focused STT tests and confirm they fail because `#openStream()` publishes ready immediately.
- [ ] Move ready publication into the existing exact-record `#markStable()` transition and publish connecting for rotation.
- [ ] Re-run STT and ClientSession focused tests and confirm the evidence boundary controls both readiness and retry reset.

### Task 5: Integrated verification and commit

**Files:**
- Review: every file changed by Tasks 1-4
- Update only with observed physical evidence: `docs/verification/2026-08-04-gemini-live-voice-acceptance.md`

- [ ] Run `npm run check` in `ai-voice-realtime`.
- [ ] Run `npm test` in `chrome-extension`.
- [ ] Run `npm run build` in `chrome-extension`.
- [ ] Run `git diff --check` and inspect `git diff --stat` plus `git status --short` from the repository root.
- [ ] Review every diff hunk against findings 1-4, source separation, no replay, exactly-once settlement, and the excluded P2 issue.
- [ ] Leave the physical Chrome/provider acceptance matrix pending unless observed during this task.
- [ ] Commit the scoped implementation and report changed files, exact verification evidence, commit hash, and remaining risks.
