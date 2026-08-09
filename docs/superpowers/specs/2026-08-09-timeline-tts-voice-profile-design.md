# Timeline TTS Voice Profile Design

## Goal

Make automatic timeline narration sound calmer and less high-pitched without
changing narration timing, tab-audio mixing, question priority, or Gemini Live
answer speech.

The existing Chrome timeline TTS design deliberately left voice selection,
language, rate, and pitch to Chrome and the operating system. On the target
macOS demo environment, that allows Chrome to choose an unsuitable fallback
voice. This design adds a fixed, portable timeline-speech profile owned only by
the side panel.

## Product behavior

Every automatic timeline utterance uses:

- language `en-US`;
- rate `0.9`;
- pitch `0.9`; and
- Chrome's default full TTS volume.

The extension inspects installed Chrome/OS voices once per side-panel realtime
session. Among voices that can report both `start` and `end`, it chooses in this
order:

1. an English voice named `Alex`;
2. an English voice named `Samantha`;
3. another local `en-US` voice;
4. another `en-US` voice;
5. another local English voice; or
6. another English voice.

Name matching is case-insensitive. A voice without a name cannot be selected.
If voice discovery fails or no eligible English voice exists, the extension
omits `voiceName` and lets Chrome choose a compatible voice while retaining the
explicit language, rate, and pitch.

This change adds no user-facing voice selector and no new stored preference.
The three Voice narration modes and the `N` shortcut remain unchanged.

## Architecture

`createChromeTimelineTtsPort` owns lazy voice discovery and the fixed speech
profile. Voice ranking is a pure helper so it can be tested independently of
Chrome.

The port begins one `chrome.tts.getVoices()` request when it is created and
reuses the result for the session. `speak` waits for that request, selects the
voice, and calls `chrome.tts.speak` with the fixed profile plus the existing
lifecycle options. A discovery failure becomes an empty voice list rather than
a narration failure.

Because discovery is asynchronous, the port keeps a generation number. Each
`speak` captures its generation. `stop` advances the generation before calling
`chrome.tts.stop`. If a question, mode change, or teardown stops narration
while voice discovery is pending, that stale `speak` returns without starting
an utterance. Existing `TimelineNarrator` lifecycle tokens continue to ignore
late Chrome callbacks after speech has started.

## Boundaries

- The fixed profile applies only to automatic timeline narration through
  `chrome.tts`.
- Gemini Live question answers and Deep Research voice keep their provider
  voice unchanged.
- Captured-tab gain targets remain 100%, 40%, or muted according to the current
  Voice narration mode and speech owner.
- Timeline descriptions remain exact recorded event text.
- No backend protocol or persistence change is required.

## Failure behavior

- Voice discovery rejection falls back to Chrome voice selection with the
  explicit language, rate, and pitch.
- A selected voice must advertise both required lifecycle events; otherwise it
  is skipped.
- A pending discovery cannot start speech after `stop` invalidates it.
- Existing Chrome `speak` and `stop` failures remain bounded by the current
  narration error handling.

## Testing

Focused extension tests will prove that:

- `Alex` wins over `Samantha` and generic English voices;
- `Samantha` wins when `Alex` is absent;
- local `en-US` and broader English fallbacks are deterministic;
- voices missing `start` or `end` are not selected;
- every utterance receives `en-US`, rate `0.9`, pitch `0.9`, and the selected
  `voiceName` when available;
- discovery rejection still speaks with the fixed profile and no `voiceName`;
- stopping during pending discovery prevents late speech; and
- existing narration lifecycle and mode tests remain passing.

Run the focused timeline narrator tests and extension build while iterating,
then run the repository-root `npm run check`. A physical Chrome/macOS smoke
test after reloading the unpacked extension remains required to judge the
subjective voice quality.

## Documentation

Update the root README, `docs/architecture.md`, and the extension README to
replace the claim that Chrome always chooses the default voice. Document the
fixed English voice preference and calm rate/pitch as side-panel-only timeline
TTS behavior.
