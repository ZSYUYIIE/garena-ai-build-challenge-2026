# Chrome Timeline TTS Design

## Goal

Move automatic timeline narration out of Gemini Live and into the StreamSense
Live side panel. The backend remains responsible for grounding, validating,
recording, and publishing timeline events. The extension reads each newly
published event description with `chrome.tts`.

This design supersedes the Gemini-Live speech ownership, backend narration
candidate selection, and backend mode-gating sections of
`2026-08-09-voice-narration-modes-design.md`. The existing three-mode UI,
local preference, `N` shortcut, event-before-speech ordering, tab-audio gain
targets, and question priority remain product requirements.

## Product rules

### Speech source

Only text received in a newly accepted protocol-v2 `event` message may enter
automatic timeline TTS. The spoken text is the recorded event's
`description`. The extension never asks Gemini Live to rephrase or synthesize
that event.

Gemini Live remains available for user questions, normal answers, and the
existing Deep Research voice path. It does not speak automatic timeline
events.

The extension uses the default voice selected by Chrome and the operating
system. This change does not add a voice, language, pitch, or rate preference.

### Voice narration modes

| Mode | When a new event may speak | Local captured-tab playback |
| --- | --- | --- |
| Smart narration | After the existing local tab-activity detector reports 750 ms of continuous silence. | 100% while timeline TTS is idle. |
| Narrate over audio | Immediately when no higher-priority user answer is active. | 40% only from the Chrome TTS `start` event through its terminal event. |
| Narration only | Immediately when no higher-priority user answer is active. | Muted for the entire active capture session. |

`question_only` under Narration level disables Chrome timeline TTS in all
three modes. Event recording and timeline display continue.

Changing Voice narration mode affects the active utterance, the one pending
event, and future events; it never replays an event that arrived before the
current side-panel session.

### Bounded pending work

The side panel owns at most one active Chrome TTS utterance and one pending
event. A newer event replaces the pending event. Pending work expires five
seconds after it was received, matching the existing automatic-narration
freshness window. Duplicate event IDs are displayed once and offered to TTS
once.

Smart narration keeps the newest pending event while tab speech is active. It
starts only after 750 ms of continuous local silence. The two always-narrate
modes do not wait for tab speech or Cloud Speech-to-Text health.

## Architecture and data flow

```text
admitted frame
  -> backend visual grounding and evidence validation
  -> event store records a new event
  -> backend publishes protocol-v2 event
  -> side panel deduplicates and inserts the event into its timeline
  -> side-panel TimelineNarrator offers event.description to chrome.tts
  -> Chrome/OS voice produces audible speech
```

Timeline insertion remains the boundary before speech. A rejected,
suppressed, duplicate, stale, or unpersisted event is never sent to Chrome TTS.

### TimelineNarrator

Add a focused side-panel controller that accepts an injected TTS port, clock,
and timers. Its public operations are:

- offer a newly inserted event;
- update Voice narration mode;
- update Narration level enablement;
- update local tab-speech activity;
- interrupt for a user question;
- stop and clear all work during session teardown.

The production TTS port wraps `chrome.tts.speak` and `chrome.tts.stop`. Each
utterance requests `start` and `end` lifecycle events. `end`, `interrupted`,
`cancelled`, `error`, a rejected `speak` promise, or explicit stop settles the
controller exactly once. Late events from an older utterance cannot change the
new utterance's state.

The controller reports active/idle transitions and bounded errors to the
realtime hook. The hook uses those transitions to update the existing audio
coordinator and visible error state.

### Audio coordination

Chrome TTS audio is produced by Chrome or the operating system, outside the
extension's Web Audio graph. The extension therefore controls only captured-tab
playback gain while TTS is active; it does not route or duplicate synthesized
PCM.

The existing gain priority remains:

1. Narration only: 0%.
2. Push-to-talk user speech: 0%.
3. Gemini answer playback: 30%.
4. Chrome timeline TTS in Narrate over audio: 40%.
5. Otherwise: 100%.

TimelineNarrator start/end callbacks mark automatic narration active/idle in
the audio coordinator. Entering Smart while tab speech is active interrupts an
active timeline utterance. Leaving Narration only never restores above a gain
required by an active user turn.

### Question priority and interruption

Starting a typed or microphone question stops the active Chrome timeline
utterance and clears its pending event before the question is admitted. Events
that arrive while a user answer owns speech are displayed but not offered to
timeline TTS. This preserves user-turn priority and avoids stale narration
after an answer.

Session stop, page hide, capture-target replacement, and side-panel unmount
call `chrome.tts.stop` only when TimelineNarrator owns an active utterance, then
clear its pending state. Late Chrome TTS callbacks are ignored.

### Backend compatibility

ClientSession must stop offering recorded events to Gemini Live narration.
Backend event analysis, persistence, publication, history archival, question
handling, and Deep Research voice remain unchanged.

The side panel no longer needs to send `voiceNarrationMode` for backend speech
decisions. The backend may continue accepting the field temporarily for
compatibility with an already built client, but it must not use the value to
start Gemini automatic narration. Removing obsolete backend policy code is
out of scope unless it is required to guarantee that invariant safely.

## Manifest and platform behavior

Add the non-optional Manifest V3 `tts` permission. Do not add `ttsEngine`;
StreamSense consumes Chrome/OS voices and does not provide a speech engine.

`chrome.tts.speak` resolves before speech finishes, so lifecycle state comes
from `onEvent`, not from the returned promise. The implementation requests the
events required for gain restoration and treats unsupported voices or synthesis
errors as bounded side-panel failures. Event descriptions remain far below the
Chrome TTS maximum utterance length, but the controller still trims and rejects
empty text.

## Failure behavior

- If Chrome TTS is unavailable or rejects an utterance, the timeline entry
  remains visible, tab gain is restored according to current state, and the
  side panel shows a bounded error.
- If a voice emits a terminal error event, the active utterance settles once
  and the newest unexpired pending event may proceed.
- If the tab has no captured audio track, gain changes are harmless no-ops and
  Chrome TTS still speaks.
- Cloud Speech-to-Text degradation does not block Chrome TTS. Smart uses the
  extension's local tab-activity detector; the other modes ignore tab speech.
- Gemini Live connecting or degraded does not block timeline TTS. It only
  affects questions and Gemini-owned answers.
- Stopping or switching capture cannot leave Chrome TTS or a muted/ducked tab
  owned by the old session.

## Testing

### Extension

- A newly deduplicated event is offered with its exact recorded description.
- Smart waits through tab activity and 750 ms of continuous silence.
- Always-narrate modes start without waiting for tab activity.
- There is at most one active and one newest pending event, with five-second
  expiry.
- Chrome TTS start and every terminal path update gain exactly once.
- Narrate over audio uses 40% only while TTS is active.
- Narration only remains muted before, during, and after TTS.
- Typed and microphone questions interrupt TTS and clear pending work.
- Events received during a user answer remain visible but are not spoken.
- Mode change, Question only, stop, page hide, target replacement, and unmount
  clear unsafe work and ignore stale callbacks.
- Manifest tests require `tts` and reject `ttsEngine`.
- Existing tab PCM capture and Cloud Speech-to-Text routing remain unchanged.

### Backend

- Recorded events are still published only after persistence.
- Automatic event handling never calls `GeminiLiveSession.speakNarration`.
- Timeline recording works while Narration level is `question_only`.
- Normal question and Deep Research voice tests remain passing.

### Repository

Run focused backend and extension tests during implementation, then run the
root `npm run check`. Automated tests do not replace a physical Chrome TTS
smoke test after reloading the unpacked extension.

## Documentation

Update the root README, `docs/architecture.md`, the extension README, and the
backend README so they state that:

- Chrome/OS TTS speaks timeline events in the side panel;
- Gemini Live does not synthesize automatic timeline narration;
- the three modes control client-side timing and tab playback;
- `tts` is a required extension permission; and
- Gemini Live availability is no longer a timeline-narration gate.

The dashboard remains a REST-only history surface with no realtime or TTS
ownership.
