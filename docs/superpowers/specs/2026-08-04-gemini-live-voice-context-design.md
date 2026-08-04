# StreamSense Gemini Live Voice and Tab Context Design

## Context

StreamSense currently captures changed JPEG frames from an authorized Chrome tab, sends them to a loopback Node.js backend, analyzes one frozen frame at a time with Gemini Interactions, and speaks completed narration and answers with browser `speechSynthesis`. Questions are typed. Captured-tab audio and microphone audio are not part of the active architecture.

The new experience must keep the microphone open while a StreamSense session is active, let the user ask spoken questions, answer with Gemini's native voice, understand the captured tab's spoken content without confusing it for the user, and continue grounded automatic visual narration. The design must also behave well for continuously changing and continuously narrated sources such as sports broadcasts.

## Goals

- Keep one backend-owned Gemini Live session available throughout each StreamSense session.
- Send changed screen frames to Gemini Live at no more than one frame per second, including while the user is silent.
- Keep the user's microphone open locally and send only locally detected user-speech turns to Gemini Live.
- Disable Gemini's automatic VAD and bracket microphone turns with explicit `activityStart` and `activityEnd` signals.
- Capture tab audio, preserve its local playback, and stream a PCM copy to a dedicated Speech-to-Text service.
- Keep captured-tab audio out of Gemini Live's conversational audio input.
- Expose recent captured-tab transcripts to Gemini Live only through a clearly labeled synchronous tool response.
- Retain the existing atomic one-frame vision analysis as the authority that decides whether a visual change is worth narrating.
- Use Gemini Live native audio for user answers and approved narration; remove browser TTS from the normal path.
- Never play automatic narration while the captured tab is speaking.
- Allow user-requested answers while the tab is speaking by fading only local tab playback to 30 percent until the user turn and Gemini playback are complete.
- Support interruption, bounded buffering, long-running Live sessions, and safe teardown.

## Non-goals

- Sending full-frame-rate video to Gemini.
- Sending raw captured-tab audio to Gemini Live.
- Treating captured-tab transcript text as user input.
- Persisting microphone audio, captured-tab audio, or captured-tab transcripts.
- Replacing the existing atomic vision analyzer with an autonomous proactive-audio feature.
- Implementing speaker diarization for the captured tab.
- Adding WebRTC, LiveKit, or multi-party media transport.
- Guaranteeing word-for-word audio rendering when Gemini Live may make small delivery changes; the atomic narration text remains canonical in the UI.

## Considered Approaches

### 1. Mixed microphone and tab audio in one Live input

This would give Gemini the richest raw audio, but it would make user-turn ownership ambiguous. Tab dialogue could trigger answers, interrupt the user, or be interpreted as the user's instruction. It is rejected.

### 2. Two Gemini Live audio sessions

One session could transcribe tab audio while another handles the user. This separates raw sources, but it doubles Live lifecycle and cost, and still requires an application-owned transcript bridge. It is rejected.

### 3. Gemini Live conversation plus dedicated tab STT (chosen)

One Gemini Live session receives sampled frames and user microphone audio. Captured-tab audio goes to Google Cloud Speech-to-Text V2 with Chirp 3. Final, timestamped transcript segments remain in a bounded in-memory buffer and are returned to Gemini only through a `get_recent_tab_transcript` tool. This preserves source identity and keeps speech arbitration deterministic.

## Architecture

```text
Authorized Chrome tab
  video track -> changed JPEG sampler (<= 1 FPS) ----------------------+
  audio track -> PCM capture -> binary WebSocket -> Cloud STT V2       |
              -> GainNode -> local speakers (100% or user-Q&A 30%)     |
                                                                       v
Open microphone -> local PCM + local VAD -> binary WebSocket -> Gemini Live
                                                     ^            |
STT final transcript -> bounded labeled buffer -> transcript tool  |
Atomic frame analysis -> narration candidate -> speech policy -----+

Gemini Live PCM output -> extension playback queue -> speakers
```

The existing loopback WebSocket remains the only extension-to-backend connection. JSON messages carry control, frame, state, and server-output events. Small binary packets carry PCM input so continuous audio does not pay base64 overhead.

## Source Ownership Invariant

The implementation must preserve this invariant at every boundary:

> Microphone PCM represents the user and is the only raw audio sent to Gemini Live. Captured-tab PCM represents media context and is sent only to the dedicated STT adapter. The two PCM sources are never mixed or reclassified.

Binary packets use distinct type tags, backend routing is exhaustive, and integration tests assert that tab PCM never reaches the Live adapter and microphone PCM never reaches the STT adapter.

## Extension Media Pipeline

### Captured tab

The existing one-use tab stream ID will be consumed with both `video` and `audio` constraints. Chrome stops ordinary local playback after tab capture, so the side panel will create an `AudioContext`, connect the tab audio track to a `GainNode`, and connect that gain to the default destination.

The tab source also connects to a bundled `AudioWorklet`. The worklet emits `Float32Array` blocks to the side-panel controller. A streaming resampler converts them to 16 kHz, signed 16-bit, mono PCM and batches them into 100 ms tab-audio packets for the backend. The STT branch is taken before the playback gain, so STT always receives full-level audio even when local playback is ducked.

If the tab has no audio track, the video path and microphone Q&A still work. The backend marks tab speech as inactive and does not create an STT stream.

### Open microphone

Starting StreamSense requests microphone access from the side panel with `echoCancellation`, `noiseSuppression`, and `autoGainControl` enabled. The microphone remains open until the StreamSense session stops, capture changes, or the side panel closes.

The same worklet/resampler boundary produces 16 kHz PCM. A local adaptive energy VAD uses a 300 ms pre-roll, start hysteresis, a minimum speech duration, and a 500 ms end hangover. Gemini automatic VAD is disabled.

When local VAD detects speech:

1. The extension fades tab playback to 30 percent.
2. It sends `user_activity_start`.
3. It sends the buffered pre-roll followed by live microphone PCM in 20-40 ms binary packets.
4. After the end hangover, it sends `user_activity_end`.
5. It keeps tab playback at 30 percent until the answer's Gemini audio queue is empty or the turn fails.

Acoustic echo cancellation is the primary defense against tab or Gemini playback leaking back into the open microphone. Headphones remain the recommended test setup. A visible microphone state tells the user when the session is listening, detecting user speech, or recovering from a permission failure.

## Binary Audio Contract

Each client-to-server binary message contains a 10-byte header followed by little-endian PCM16:

- Byte 0: protocol version `1`.
- Byte 1: source kind, `1` for microphone and `2` for captured tab.
- Bytes 2-5: unsigned little-endian sequence number.
- Bytes 6-9: unsigned little-endian session-relative timestamp in milliseconds.
- Remaining bytes: non-empty, even-length PCM16 payload.

Microphone packets contain at most 40 ms of 16 kHz mono PCM. Tab packets contain at most 100 ms. The backend rejects unknown versions, unknown source kinds, non-monotonic sequence numbers, odd payloads, and oversized audio packets without routing them to a provider.

The extension checks `WebSocket.bufferedAmount`: noncritical tab audio and routine frames may be dropped under backpressure, but microphone overflow aborts the current user turn and surfaces a retryable error rather than silently truncating a question.

## Dedicated Captured-Tab Transcription

The backend uses `@google-cloud/speech` V2 and Chirp 3 through Application Default Credentials. Required runtime configuration is:

- `GOOGLE_CLOUD_PROJECT`
- `GOOGLE_CLOUD_SPEECH_LOCATION`, default `us`
- `GOOGLE_APPLICATION_CREDENTIALS` only when ADC is not otherwise available

The recognizer path is `projects/{project}/locations/{location}/recognizers/_`. Streaming recognition uses explicit LINEAR16 decoding at 16 kHz, one channel, `languageCodes: ["auto"]`, `model: "chirp_3"`, automatic punctuation, interim results, and voice-activity events.

The adapter emits:

- tab speech active/inactive state from Speech-to-Text activity events;
- interim transcript text for diagnostics only;
- final timestamped transcript segments for context.

Cloud STT streaming sessions rotate before the five-minute provider limit. The adapter keeps a small PCM bridge buffer during rotation and deduplicates the overlap. Provider failure is retried with bounded exponential backoff. If STT cannot establish or repeatedly fails, automatic narration is disabled for that StreamSense session because the application can no longer guarantee that it will not talk over the video. User-requested Q&A remains available with screen context.

## Transcript Buffer and Gemini Tool

Final tab transcript segments are stored only in memory and carry start/end timestamps, detected language, and text. The buffer evicts entries older than two minutes and caps stored text at 12,000 characters.

Gemini Live receives a synchronous `get_recent_tab_transcript` function declaration. The model may request 5-120 seconds of context; the backend defaults to 45 seconds and returns at most 4,000 characters. The tool response is explicitly labeled:

```json
{
  "source": "captured_tab_audio_transcript",
  "representsUserSpeech": false,
  "segments": [
    { "startMs": 12000, "endMs": 14800, "text": "...", "languageCode": "en-US" }
  ]
}
```

The transcript is never continuously injected into the Live conversation as new user text. The Live system instruction states that microphone audio is the user and tool transcript text is quoted media context only.

## Gemini Live Conversation Session

The backend owns `@google/genai` and the Gemini API key. The extension never receives Gemini credentials.

Each browser session opens `gemini-3.1-flash-live-preview` with:

- audio response modality;
- automatic activity detection disabled;
- input and output audio transcription enabled;
- context-window compression with a sliding window;
- session resumption enabled;
- the recent-tab-transcript tool;
- a system instruction that defines source ownership and the two allowed speech triggers.

Accepted changed JPEG frames are sent to Live immediately, at no more than one frame per second, whether or not the user is speaking. The latest frame is also retained by the existing atomic analyzer. Starting a user question forces an immediate fresh frame when the capture pipeline is ready.

The backend forwards microphone PCM only between `user_activity_start` and `user_activity_end`, translating those events to Live `activityStart`, audio inputs, and `activityEnd`. Input transcripts update the user chat entry. All audio parts in each Live server message are forwarded to the extension as 24 kHz PCM output tagged with the active turn ID and turn kind.

The backend retains the latest session-resumption handle in memory. It reconnects on `GoAway` or recoverable connection closure, passing the handle and latest frame into the replacement connection. A user turn lost during reconnect is ended with a retryable error instead of being replayed ambiguously.

## Atomic Narration and Semantic Gating

The pixel-signature comparison remains only a bandwidth filter. It is not a narration decision.

The existing atomic Gemini Interactions request continues to analyze a frozen latest frame on a periodic cadence. It receives the previous grounded visual state and a clearly separated recent-tab transcript excerpt. Visual descriptions must remain grounded in the exact frame; transcript text may suppress duplication or corroborate event significance but may not justify an unseen visual claim.

The structured result includes a candidate description, semantic key, importance, whether it is new, whether recent tab speech already covered it, and an optional event. Routine motion, caption churn, and repeated states do not become narration candidates. Sports-specific meaningful changes include score changes, goals, penalties, cards, substitutions, period boundaries, and major replay transitions when supported by the frame.

An approved candidate is held for at most five seconds. A new user turn drops it. Duplicate semantic keys and cooldown rules prevent repeated narration.

## Speech Policy and Playback

Gemini has exactly two permitted speech triggers:

1. A user voice or typed question completes.
2. A fresh atomic narration candidate is approved while the tab is not speaking.

No frame arrival, STT interim result, final transcript, or tool result can independently authorize speech.

### User-requested answer

- User activity has highest priority.
- On user speech start, clear any current Gemini narration and pending narration candidate.
- Fade local tab playback to exactly 30 percent over about 150 ms.
- Keep it at 30 percent while the user speaks and while Gemini's answer audio remains queued.
- Restore it to 100 percent over about 250 ms when the answer playback queue becomes idle or the turn fails.
- Tab speech does not block or cancel a user-requested answer.

### Automatic narration

- Automatic narration never changes tab volume.
- It may begin only after tab speech has been inactive for at least 750 ms.
- If tab speech begins while automatic narration is playing, immediately clear that narration's local playback and discard later audio chunks for that turn.
- If no silent window occurs before the five-second candidate expiry, drop the candidate.
- Automatic narration is disabled while STT health is unavailable or unknown.

### Interruption

If local VAD detects the user while Gemini is speaking, the extension clears its audio queue immediately and sends `user_activity_start`. The backend marks the previous Live turn interrupted. Stale audio chunks are rejected by turn ID. Tab volume follows the new user-Q&A rule and remains at 30 percent until the replacement answer finishes.

## Browser Playback

Browser `speechSynthesis` is removed from the normal path. A dedicated PCM playback queue owns scheduled `AudioBufferSourceNode` objects, turn IDs, queue timing, cancellation, and an `onIdle` callback. Playback queue emptiness, not provider generation completion alone, controls restoration of tab volume.

The extension displays the canonical atomic narration text and Live input/output transcripts. Gemini is instructed to read approved narration verbatim, but small spoken paraphrases do not replace the canonical UI text.

## Protocol Evolution

The WebSocket handshake becomes protocol version 2. New client commands include user activity boundaries and binary PCM packets. New server messages include tagged model audio, playback cancellation, Live/STT health, and speech state. Backend and extension contract tests must enumerate every message type.

The existing origin check, two-megabyte WebSocket payload cap, strict JSON validation, frame rate limit, immutable frame snapshots, and abortable atomic turns remain in force. Audio receives separate packet-size, sequence, rate, and backpressure controls.

## Error Handling

- Microphone permission denied: preserve visual capture and typed questions, show a retryable microphone error, and do not claim that the mic is open.
- No tab audio track: continue screen and microphone behavior; STT remains idle and automatic narration is allowed because the tab has no captured audio source.
- STT unavailable with an audio track: disable automatic narration, keep Q&A, and surface degraded tab-context status.
- Live connection unavailable: keep capture and atomic event analysis, suppress voice output, retry with bounded backoff, and show a Live status error.
- Malformed or out-of-order binary audio: reject the packet or close the offending session according to protocol severity; never pass it to a provider.
- Extension stop, captured-tab change, WebSocket close, or side-panel unload: stop every media track, close worklet nodes and audio contexts, clear playback, restore no orphaned audio route, close provider streams, clear transcript buffers, and abort model work.

## Privacy and Security

- Gemini and Cloud STT credentials stay on the backend.
- Microphone and tab audio are processed only while StreamSense is running.
- Raw audio is never stored.
- Tab transcripts are memory-only and erased at session close.
- SQLite continues to store only validated visual event records under the existing retention policy.
- Status and telemetry messages never include credentials or raw audio.

## Testing Strategy

Implementation is test-driven and uses dependency-injected fake Audio/WebSocket/provider boundaries.

Backend unit tests cover binary packet validation, source routing, transcript eviction, STT configuration and five-minute rotation, Live manual activity boundaries, processing all audio/transcript parts, transcript tool responses, resumption handles, speech-policy state transitions, atomic narration suppression, and teardown.

Extension unit tests cover PCM conversion/resampling, binary packet encoding, VAD pre-roll and hysteresis, gain transitions, playback queue cancellation and idle notification, source cleanup, protocol coverage, and stale-turn rejection.

Real WebSocket tests cover valid binary mic/tab packets, malformed headers, payload bounds, rate limits, JSON/binary coexistence, and cross-session isolation.

Manual Chrome acceptance covers:

1. A silent slide or interface change produces one grounded Gemini narration at full tab volume.
2. A continuously narrated sports match produces no automatic Gemini narration.
3. A spoken user question during sports commentary fades the tab to 30 percent, produces one grounded Gemini answer, and restores the tab to 100 percent after local playback empties.
4. User barge-in clears Gemini audio and starts a replacement turn.
5. Tab STT context answers a question about words spoken by the video without treating those words as the user.
6. Microphone denial, missing tab audio, STT failure, and Live reconnect each enter the documented degraded state.
7. A session longer than ten minutes resumes Live context, and an STT stream longer than five minutes rotates without duplicate final transcript text.
8. Stop, tab change, and panel close leave no active capture, microphone, audio playback, provider stream, or retained transcript.

## Acceptance Criteria

- The screen continues to reach Gemini Live adaptively at no more than one frame per second while the user is silent.
- The microphone is open only during an active StreamSense session; only VAD-bounded microphone PCM reaches Gemini Live.
- Captured-tab PCM reaches Cloud STT and never Gemini Live.
- Recent tab transcript context is labeled, bounded, memory-only, and supplied only through the transcript tool.
- User voice, not tab speech, opens a conversational audio turn.
- User-requested answers duck local tab playback to exactly 30 percent until playback is actually complete.
- Automatic narration never ducks the tab and never plays while tab speech is active.
- Continuous visual motion does not by itself authorize narration.
- Browser TTS is absent from the normal narration and answer path.
- Barge-in clears stale playback and stale provider output cannot re-enter the queue.
- Live context compression, session resumption, and STT stream rotation support long sessions.
- All automated suites, builds, protocol tests, and the manual Chrome acceptance matrix pass without exposing credentials.

## Provider References

- Gemini Live capabilities and manual VAD: <https://ai.google.dev/gemini-api/docs/live-api/capabilities>
- Gemini Live session management: <https://ai.google.dev/gemini-api/docs/live-api/session-management>
- Gemini Live best practices: <https://ai.google.dev/gemini-api/docs/live-api/best-practices>
- Chrome tab capture and preserved local audio: <https://developer.chrome.com/docs/extensions/reference/api/tabCapture>
- Cloud Speech-to-Text Chirp 3: <https://cloud.google.com/speech-to-text/docs/models/chirp-3>
- Cloud Speech-to-Text quotas and streaming limits: <https://cloud.google.com/speech-to-text/docs/quotas>
