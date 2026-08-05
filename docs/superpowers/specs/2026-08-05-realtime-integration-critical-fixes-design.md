# StreamSense Critical Realtime Integration Fixes Design

**Status:** Approved on 2026-08-05 after independent read-only review of the VAD, Gemini Live, and Cloud STT/readiness boundaries.

## Scope

Repair the four P0/P1 integration failures found in the current Chrome-extension-to-backend flow:

1. Production 20 ms microphone packets can prevent local VAD from opening a user turn.
2. A rejected turn-bearing Gemini Live write can leave ownership attached to a poisoned provider generation.
3. Cloud STT retry attempts accumulate across otherwise stable recoveries.
4. The extension admits typed questions after the WebSocket handshake but before Gemini Live is ready, and retryable answer failures are silent.

The P2 input-length, question-rate, and frame-rate-limit findings remain outside this change.

## Invariants

- Keep the existing backend-mediated, open-microphone architecture.
- Microphone PCM remains the only raw conversational audio sent to Gemini Live.
- Captured-tab PCM remains isolated to Cloud Speech-to-Text.
- Keep Gemini automatic activity detection disabled and retain explicit `activityStart` and `activityEnd` boundaries.
- Keep `connected` as the protocol-v2 WebSocket handshake acknowledgement.
- Use the existing `provider_health` message as the dynamic Live readiness signal.
- Never automatically replay typed text, narration text, microphone PCM, tool calls, or activity boundaries after an ambiguous provider failure.
- Do not add a WebSocket message type or a dependency.
- Do not claim physical Chrome/provider acceptance from automated tests alone.

## Chosen Approach

Apply surgical state-machine repairs at the four existing ownership boundaries. Do not buffer VAD input into a different cadence, redefine `connected`, reset STT retries on local stream construction, or introduce a common provider framework.

### Production-Cadence VAD

`AdaptiveVoiceActivityDetector` will retain its existing absolute floor, multiplier, 120 ms minimum speech duration, 300 ms pre-roll, and 500 ms end hangover. While the detector is closed:

- An above-threshold frame advances `candidateMs` without changing `noiseRms`.
- A below-threshold frame resets `candidateMs` and updates `noiseRms` with the existing smoothing constant.

This freezes the pre-candidate baseline long enough for six real 20 ms worklet packets to open a turn. The worklet, resampler, media graph, timestamp mapping, and echo-reference cadence remain unchanged.

### Gemini Live Outbound Ownership

Every turn-bearing outbound operation will capture both its owning turn and the current provider generation. A rejection of `activityStart`, text, `activityEnd`, or microphone PCM makes delivery ambiguous and poisons that generation.

New turns are rejected synchronously before ownership is created whenever the Live session is absent, closing, or already reconnecting. This prevents a turn admitted after reconnect settlement from becoming orphaned behind the existing reconnect promise.

The failure path will:

1. Verify that the turn and generation are still current.
2. Clear the session-resumption handle for this reconnect only.
3. Enter the existing single-flight reconnect path, which synchronously fences the old generation before awaiting provider cleanup.
4. Clear playback and complete every distinct old-generation owner exactly once.
5. Mark answers retryable and narration non-retryable.
6. Clear all ownership and tool queues without replaying them.

Ordinary GoAway and provider-close recovery remains resumable. Rejected microphone PCM retains its immediate exact-turn failure behavior, but its following reconnect becomes non-resumable because delivery is also ambiguous.

### Cloud STT Recovery Budget

`retryAttempt` will mean consecutive failures before the replacement stream proves provider stability. Each stream record gains a one-shot `stable` flag.

The current, non-retiring record becomes stable on its first provider `metadata` or `data` event. That event resets `retryAttempt` to zero. Local `_streamingRecognize()` construction and the initial configuration write do not reset it because both can succeed before a rapid asynchronous provider failure.

Provider evidence from a retired, rotated, replaced, or closed record is ignored. Thus persistent pre-stability failures still exhaust the bounded 250/500/1000 ms schedule, while later isolated failures start a fresh schedule.

### Extension Readiness and Retryable Answers

The extension will track Live provider state as render-driving state plus a synchronous ref. A small production-used typed-question helper owns readiness classification, reason-aware copy, the post-frame-wait dispatch decision, retryable-answer notice text, and draft retention after an admission result. Typed-question admission requires all of:

- extension status is `connected`;
- the protocol hello has been accepted;
- Live provider state is `ready`.

The same predicate is checked when `ask()` starts and again after the forced-frame wait immediately before `WebSocket.send()`. If readiness disappears during that wait, the local turn is completed retryably, playback/gain coordination is restored, the user question remains visible, and no backend command is sent.

A synchronous admission refusal leaves the input draft unchanged. A retryable answer completion received from the backend uses the same local settlement path and displays a nonfatal instruction to ask again after Live recovers. Reason-aware placeholder/status copy distinguishes stopped capture, Live connection, Live reconnection, and ready Q&A. It does not set the entire capture session to `error`, automatically resend the question, or reuse the old turn UUID. Microphone or tab-STT degradation alone does not disable typed questions while Live remains ready.

## Error and Race Semantics

- Reconnect remains single-flight.
- Generation and terminal-turn guards make late rejection, GoAway, close, and stale callbacks idempotent.
- Playback clearing precedes turn completion and occurs at most once per turn.
- A queued turn that never reaches its first provider write is still settled when its generation is poisoned.
- `close()` owns teardown and prevents a late rejection from reconnecting.
- A retryable completion is keyed by turn ID and cannot settle a newer turn.
- A dropped pre-send typed question uses a new UUID if the user later asks it again.

## Test Strategy

### Extension

- Exercise `AdaptiveVoiceActivityDetector` with explicit 20 ms frames for sustained speech, natural ramp, noise, spike rejection, pre-roll, hangover, echo rejection, and barge-in.
- Exercise `RealtimeMediaAudio` with the actual 960-sample/48 kHz worklet packet size.
- Test the pure typed-question readiness predicate for handshake, connecting, ready, degraded, and recovery states.
- Test the retryable-answer notice and reuse the same completion settlement for backend and local pre-send failures.

### Backend

- Table-test rejection of the first, second, and third typed/narration Live writes.
- Test rejected microphone activity boundaries and PCM.
- Test queued owners, stale callbacks, close races, and GoAway races for exactly-once settlement.
- Preserve bounded STT exhaustion without provider evidence.
- Prove that provider evidence resets the STT schedule and that stale records cannot reset it.

### Release Gate

- Backend `npm run check`.
- Extension `npm test` and `npm run build`.
- Fresh targeted reproductions for all four original failures.
- Independent read-only review of the resulting diff and independent rerun of all gates.
- Update the physical acceptance record honestly; unresolved real Chrome/provider cases remain pending.

## Alternatives Rejected

### Buffer VAD into 40 ms Frames

This would hide the current failure but add barge-in latency, complicate timestamp/reference alignment, and leave the detector cadence-dependent.

### Reset STT Retries When a Stream Opens

Local stream creation is not provider stability. Resetting there permits an unbounded 250 ms retry loop when every newly constructed stream fails asynchronously.

### Delay or Redefine `connected`

This conflates transport negotiation with dynamic provider state and weakens reconnect reporting. The existing `provider_health` contract already expresses the required state.

### Automatically Replay Failed Questions

Outbound failure is delivery-ambiguous. Automatic replay can duplicate provider work or produce two answers, so the user must deliberately ask again with a new turn ID.
