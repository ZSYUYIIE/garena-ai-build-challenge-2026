# StreamSense Realtime Integration Review Findings 1-4 Design

**Status:** Approved by the delegated implementation request on 2026-08-05.

## Scope

Repair four review findings in the backend-mediated Gemini Live integration:

1. Typed admission must synchronously retire any local microphone activity so later PCM cannot outlive backend microphone ownership, and backend completion or Live reconnect must also clear stale local ownership.
2. Only microphone turns may own Gemini input-audio transcription; typed and narration turns must not enter or block that queue.
3. Rejected video and tool-response provider writes must trigger one generation-fenced, bounded hard reconnect. Only the latest frame is safe to send on a replacement generation; old tool responses are never replayed.
4. Cloud STT must remain connecting until the current provider stream emits metadata or data, including initial connection, retry recovery, and rotation.

The separate typed-question length and cooldown mismatch remains out of scope.

## Invariants

- The backend owns the Gemini Live connection and provider credentials.
- Microphone PCM is the only raw conversational audio sent to Gemini Live.
- Captured-tab PCM remains source-separated and goes only to Cloud Speech-to-Text.
- Gemini automatic activity detection stays disabled; user activity boundaries remain explicit.
- A retired microphone generation cannot send buffered or later PCM.
- Reconnect remains single-flight and bounded by the existing 250, 500, and 1000 millisecond delays.
- Delivery-ambiguous text, PCM, activity boundaries, and tool responses are never replayed.
- The immutable latest video frame remains the only explicitly safe provider-write replay.
- Automated gates do not establish physical Chrome/provider acceptance.

## Chosen Design

### Extension microphone ownership

Introduce a focused local ownership controller used by `useRealtimeSession`. It owns the current microphone turn plus the media-protocol activity boundary and exposes three atomic transitions:

- open a pending microphone turn;
- retire the matching microphone turn, clearing queued PCM, resetting local VAD/activity state, and closing the media-protocol activity when it has opened;
- query whether a microphone turn is still current before delayed start, packet flush, or end handling.

Typed `ask()` retires local microphone ownership synchronously before it allocates the typed turn. A Live health transition away from ready and a matching backend `turn_complete` also retire the local microphone turn. Re-enabling microphone activity resets VAD state, allowing a later speech onset to allocate a fresh UUID and activity boundary. WebSocket send ordering guarantees `user_activity_end` precedes `typed_question` when the old activity had reached the backend.

### Live input-transcript ownership

Turn creation records whether the turn contains microphone input audio. Only `startUserActivity()` adds a turn to `inputOwners`; typed and narration turns still own response and output-transcript queues. Settling fallback for input transcripts filters to microphone-audio owners, preventing completed text turns from receiving late input-audio transcription.

### Generic provider-write recovery

Video and tool-response writes capture the current provider generation and session. A rejected write may start recovery only while both are still current and the adapter is not closing. Recovery clears resumption state and enters the existing single-flight reconnect, which synchronously fences the old generation and uses the existing bounded connect schedule.

Queued old-generation tool responses fail their generation/session guard and are discarded. Replacement connection setup may queue the current immutable `latestFrame`; no other generic operation is replayed. Late rejection after GoAway, another rejection, or close is ignored by the generation/closing guards.

### Provider-evidenced Cloud STT readiness

Local `_streamingRecognize()` construction and configuration write establish only a connecting stream. The current non-retiring stream becomes stable on its first `metadata` or `data` event. That transition resets the consecutive retry counter and publishes ready exactly once. Retry attempts and proactive rotation publish connecting while the new stream awaits evidence. Evidence from stale, retired, destroyed, ended, or closed records is ignored.

## Alternatives Rejected

- Let the backend tolerate PCM after typed replacement: this hides a split-brain extension owner and weakens the explicit activity protocol.
- Keep typed turns in `inputOwners` but mark their transcripts disallowed: they would still grow and block the FIFO queue.
- Reconnect only from `ClientSession` health observation: the Live adapter owns the failed provider generation and must fence it at the rejection source.
- Mark STT ready after the configuration write: local stream acceptance is not provider evidence and repeats the review defect.

## Error and Race Semantics

- Microphone retirement is idempotent and exact-turn guarded.
- Delayed microphone start and PCM callbacks re-check ownership after typed admission, completion, or health loss.
- One rejected generic write yields one reconnect; subsequent stale failures cannot reconnect the replacement generation.
- Failed tool responses are not transferred to the replacement session.
- Provider metadata/data from an old STT record cannot reset retries or readiness.

## Test Strategy

- Extension unit tests prove pending and opened microphone ownership retire before typed dispatch, stale PCM/end callbacks are rejected, matching completion or health loss clears ownership, and a fresh microphone turn can open afterward.
- Backend session integration proves typed replacement followed by stale PCM does not close the browser when the required end boundary precedes typed admission.
- Live adapter tests prove typed-to-microphone and narration-to-microphone input transcript attribution, rejected video/tool writes cause exactly one hard reconnect, tool responses do not replay, latest frame does, and fresh turns work.
- STT tests prove initial, retry, and rotation streams remain connecting until current-provider metadata/data, with retry reset only at that same evidence boundary.
- Final gates are backend `npm run check`, extension `npm test`, extension `npm run build`, and `git diff --check`.
