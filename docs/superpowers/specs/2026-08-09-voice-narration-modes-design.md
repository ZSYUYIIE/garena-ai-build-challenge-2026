# Voice Narration Modes Design

## Goal

Add a persistent **Voice narration** setting to StreamSense Live without
changing the existing **Narration level** setting. Voice narration controls
when automatic timeline narration may speak and how captured-tab audio is
played locally.

The setting has three modes:

| Wire value | UI label | Automatic timeline narration | Local tab playback |
| --- | --- | --- | --- |
| `smart` | Smart narration | Preserve the existing commentary-silence policy. | 100% normally. Existing question behavior is unchanged. |
| `over_audio` | Narrate over audio | Narrate each newly recorded eligible timeline event without waiting for tab speech to stop. | 40% only while automatic narration is audible; otherwise 100%. |
| `narration_only` | Narration only | Narrate each newly recorded eligible timeline event without waiting for tab speech to stop. | Muted for the entire active capture session. |

`smart` is the first-use and compatibility default.

## Non-goals

- Do not replace or redesign the existing Narration level selector.
- Do not change microphone capture, tab-audio capture, Cloud Speech-to-Text,
  Gemini prompts, frame admission, visual grounding, event validation, event
  persistence, or question-answer generation.
- Do not make the dashboard a realtime client or add this control to the
  dashboard.
- Do not replay older timeline events after a mode change.
- Do not build an unbounded or FIFO narration queue.

## Product rules

### Relationship to Narration level

Narration level controls description detail. Voice narration controls speech
timing and tab playback. The settings are independent except that the existing
`question_only` narration level disables all automatic timeline narration in
every voice mode.

### Eligible events

Automatic speech remains downstream of visual grounding and persistence. An
event cannot be spoken until the event store reports it as newly `recorded` and
the event has been published to the current-session timeline.

Smart mode preserves the current candidate requirements: the atomic analysis
must approve narration, identify a new semantic fact, not be covered by tab
speech, meet the importance threshold, and provide a description and semantic
key.

For `over_audio` and `narration_only`, every newly recorded timeline event is a
candidate when Narration level is not `question_only`. Its spoken text comes
from the recorded event description. These modes intentionally ignore tab
speech coverage, tab-speech activity, and tab-transcription health when deciding
whether to speak. They do not bypass frame freshness, evidence validation,
self-reference suppression, event-store deduplication, persistence, Live
availability, staleness expiry, or semantic cooldowns.

When an event does not provide the atomic analysis semantic key, the backend
derives a bounded stable key from the recorded event type and normalized
description. The admitted frame time is the candidate creation time.

### Latest-event coalescing

There is at most one pending narration candidate in addition to any active
speech turn.

- In Smart mode, preserve the current importance-aware replacement behavior.
- In the two always-narrate modes, a newer eligible event replaces the older
  pending event regardless of importance.
- A pending event expires under the existing narration TTL rather than being
  spoken late.
- User questions interrupt active narration, clear or supersede unsafe pending
  work, and retain priority in every mode.

## Ownership and data flow

### Shared configuration

Define a single three-value voice narration mode contract on each side of the
WebSocket boundary. Extend the existing strict `session_config` message with
`voiceNarrationMode`.

The extension sends the current mode immediately after connection and whenever
the user changes it. The backend starts in Smart mode. A missing field from an
older client defaults to Smart; an unknown value remains a protocol error.

`ClientSession` updates both its candidate-selection behavior and the injected
`SpeechPolicy`. It applies cancellation or start actions returned by the policy,
polls once after the transition, and reschedules the policy wake time.

### Backend speech policy

`SpeechPolicy` owns the mode-dependent timing gate:

- Smart requires Gemini Live readiness, non-degraded tab context, no local tab
  speech, no cloud tab speech, and the existing silence interval.
- The two always-narrate modes require Gemini Live readiness but do not wait on
  tab speech or tab-transcription health.

Candidates carry whether they satisfy Smart eligibility. Switching into Smart
drops or cancels work that is no longer Smart-eligible and applies the current
tab-speech and health gate. Switching from Smart to an always-narrate mode makes
an existing eligible pending candidate immediately pollable without replaying
any event that was never offered.

The policy continues to own reservation tokens, late-start rejection,
settlement replay protection, user-turn interruption, expiry, and bounded
semantic cooldown state.

### Extension audio coordinator

The extension owns only local playback mixing. Tab capture and its silent
processing branch continue at full input signal in all modes; changing local
gain must never disconnect captured-tab PCM from Cloud Speech-to-Text.

Replace scattered gain restoration decisions with one state-derived target:

1. Voice mode `narration_only`: 0%.
2. User is holding push-to-talk: 0%.
3. A normal answer is active after the user finishes speaking: existing 30%.
4. Automatic narration is active in `over_audio`: 40%.
5. Otherwise: 100%.

The coordinator tracks the last requested target to avoid redundant Web Audio
automation. Existing short mute, duck, and restore ramps remain, with 40% using
the normal narration duck ramp. `MediaAudio.setTabGain` accepts the additional
0.4 target.

The extension's local tab-activity signal cancels narration only in Smart mode.
The backend enforces the same policy authoritatively.

## UI, persistence, and keyboard behavior

Add a **Voice narration** selector in the existing header configuration area,
next to or directly below **Narration level**. Use human-readable option labels;
wire values must not be shown to users.

Persist the mode under a versioned extension-origin local-storage key. Reading
is synchronous so a saved `narration_only` choice is known before capture can
start, preventing a brief tab-audio leak. Missing, unavailable, or malformed
storage falls back to Smart without crashing the side panel. A write failure
does not block the in-memory mode change for the current panel lifetime.

An unmodified `N` key cycles:

```text
Smart narration -> Narrate over audio -> Narration only -> Smart narration
```

The shortcut:

- is scoped to the focused side panel;
- is ignored for `input`, `textarea`, `select`, and contenteditable targets;
- ignores modifiers and repeated keydown events;
- works whether capture is running or stopped;
- uses the same state update and persistence path as the selector; and
- announces the resulting human-readable label through an `aria-live` status.

The visible selector label or adjacent help text exposes the `N` shortcut so it
is discoverable.

## Live mode changes

Mode changes apply without restarting capture:

- Entering `narration_only` fades local tab playback to zero immediately.
- Entering `over_audio` uses 40% if automatic narration is active and 100%
  otherwise.
- Entering Smart restores its state-derived target. Active or reserved
  narration that conflicts with current Smart eligibility or current tab speech
  is cancelled by the backend; the extension also rejects local narration
  playback during detected tab speech.
- Leaving `narration_only` never unmutes above the target required by an active
  user question or answer.
- Only current pending policy work and future events are affected. Past timeline
  entries are not replayed.

## Failure behavior

- With no captured-tab audio track, visual narration continues and gain changes
  become harmless no-ops.
- Smart continues to pause when tab transcription is degraded. The two
  always-narrate modes continue because they intentionally do not depend on
  commentary silence.
- If Gemini Live is connecting or degraded, timeline persistence continues but
  narration cannot start. Pending work expires normally.
- A disconnected mode change persists locally and is sent after the next
  successful connection.
- Stale provider audio, cancelled turns, invalid protocol messages, and output
  backpressure retain their current fail-closed behavior.

## Testing

### Backend

- Protocol parsing accepts all three modes, defaults a missing field to Smart,
  and rejects unknown values.
- Smart behavior remains unchanged.
- Always-narrate modes ignore local/cloud tab speech and degraded tab context but
  still require Live readiness.
- Newly recorded timeline events become candidates only after publication.
- `question_only` suppresses automatic speech in all voice modes.
- Always-narrate coalescing keeps the newest pending event rather than a FIFO or
  importance-ranked backlog.
- Switching modes correctly starts, retains, drops, or cancels pending,
  reserved, and active narration.
- User turns, expiry, cooldown, late reservations, and reconnect behavior remain
  safe.

### Extension

- Preference parsing, fallback, persistence, labels, and cycling are isolated
  unit-testable helpers.
- `N` handles focus targets, modifiers, and key repeat correctly.
- Selector and shortcut follow one update path and emit an accessible status.
- Gain-state tests cover 0%, 30%, 40%, and 100%, including mid-turn mode
  transitions.
- Narration-only remains muted between turns and while answers complete.
- Tab PCM capture and activity reporting continue while local playback is muted.
- Existing push-to-talk, typed question, barge-in, playback ownership, timeout,
  and stop behavior remain passing.

### Repository verification

Run focused backend and extension tests while iterating, then run the repository
root `npm run check`. Record warnings separately from failures.

## Documentation

Update:

- `docs/architecture.md` for the new policy and audio-mixing flow;
- the root `README.md` for the new user-facing setting and `N` shortcut;
- `chrome-extension/README.md` for selector, persistence, shortcut, and local
  playback behavior; and
- `ai-voice-realtime/README.md` for protocol and backend speech-policy modes.

Do not describe dashboard behavior, durable session history, or account
preferences as changed.

## Review strategy

After implementation and focused verification, dispatch independent reviewers:

1. A backend reviewer checks protocol compatibility, event-before-speech
   ordering, policy transitions, bounded state, and question priority.
2. An extension reviewer checks persistence, keyboard accessibility, gain
   priority, capture separation, and stale audio rejection.

Address confirmed findings, rerun affected focused tests, then rerun the full
repository check before completion.
