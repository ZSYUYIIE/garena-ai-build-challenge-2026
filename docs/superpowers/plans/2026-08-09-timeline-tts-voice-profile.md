# Timeline TTS Voice Profile Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give side-panel timeline narration a calm, deterministic English Chrome/OS voice profile instead of leaving every speech option to Chrome.

**Architecture:** Extend the production Chrome TTS port with one lazily cached `getVoices()` request, a pure deterministic voice selector, and a generation guard that prevents delayed discovery from speaking after stop. Keep `TimelineNarrator`, the backend protocol, the three narration modes, and Gemini-owned answer audio unchanged.

**Tech Stack:** TypeScript 5.9, Chrome Manifest V3 `chrome.tts`, Node test runner, Vite.

## Global Constraints

- Apply the profile only to automatic side-panel timeline narration.
- Use `lang: "en-US"`, `rate: 0.9`, `pitch: 0.9`, and default full TTS volume.
- Prefer lifecycle-capable English voices in this order: Alex, Samantha, local `en-US`, any `en-US`, local English, any English.
- Require selected voices to advertise both `start` and `end`; otherwise let Chrome select a compatible voice.
- A failed `getVoices()` request must not prevent narration.
- `stop()` must invalidate any `speak()` still waiting for voice discovery.
- Do not add UI, storage, backend, protocol, Gemini Live, or tab-audio changes.
- Preserve the exact recorded event description as spoken text.

---

### Task 1: Select and apply the calm Chrome TTS voice profile

**Files:**
- Modify: `chrome-extension/src/sidepanel/realtime/timelineNarrator.ts`
- Test: `chrome-extension/test/timelineNarrator.test.ts`

**Interfaces:**
- Consumes: existing `TimelineTtsPort`, Chrome `getVoices`, `speak`, and `stop` operations.
- Produces: exported `TimelineTtsVoice`, `ChromeTimelineSpeakOptions`,
  `ChromeTimelineTtsApi`, and `selectTimelineVoiceName(voices)` plus the
  existing `createChromeTimelineTtsPort(api?)` with optional API injection for
  boundary tests.

- [ ] **Step 1: Write failing voice-selection and speech-profile tests**

Import `createChromeTimelineTtsPort`, `selectTimelineVoiceName`, and
`TimelineTtsVoice`. Add literal voice fixtures whose complete relevant fields
include `voiceName`, `lang`, `remote`, and `eventTypes`.

```ts
const lifecycle = ["start", "end"];
const voice = (
  voiceName: string,
  lang: string,
  remote: boolean,
  eventTypes = lifecycle,
): TimelineTtsVoice => ({ voiceName, lang, remote, eventTypes });

const chromeTtsApiFixture = (options: {
  voices?: TimelineTtsVoice[];
  getVoices?: () => Promise<TimelineTtsVoice[]>;
  onSpeak?: (text: string, options: ChromeTimelineSpeakOptions) => void;
} = {}): ChromeTimelineTtsApi => ({
  getVoices: options.getVoices ?? (() => Promise.resolve(options.voices ?? [])),
  speak: (text, speakOptions) => options.onSpeak?.(text, speakOptions),
  stop: () => {},
});

test("selects Alex before Samantha and generic English voices", () => {
  assert.equal(selectTimelineVoiceName([
    voice("Generic US", "en-US", false),
    voice("Samantha", "en-US", false),
    voice("Alex", "en-US", false),
  ]), "Alex");
});

test("applies the calm profile to the selected installed voice", async () => {
  const calls: Array<{ text: string; options: ChromeTimelineSpeakOptions }> = [];
  const api = chromeTtsApiFixture({
    voices: [voice("Alex", "en-US", false)],
    onSpeak: (text, options) => calls.push({ text, options }),
  });
  const port = createChromeTimelineTtsPort(api);

  await port.speak("Goal by Rivera.", () => {});

  assert.equal(calls[0]?.text, "Goal by Rivera.");
  assert.equal(calls[0]?.options.lang, "en-US");
  assert.equal(calls[0]?.options.rate, 0.9);
  assert.equal(calls[0]?.options.pitch, 0.9);
  assert.equal(calls[0]?.options.voiceName, "Alex");
});
```

Add separate tests for Samantha fallback, deterministic local/remote language
fallbacks, missing lifecycle events, discovery rejection without `voiceName`,
and stop while discovery is unresolved.

- [ ] **Step 2: Run the focused test and verify RED**

Run:

```bash
cd chrome-extension
node --experimental-strip-types --test test/timelineNarrator.test.ts
```

Expected: FAIL because the exported voice types, selector, API injection, and
calm profile do not exist.

- [ ] **Step 3: Implement the minimal voice selector and guarded Chrome port**

Add structural boundary types that are sufficient for production Chrome and
tests:

```ts
export type TimelineTtsVoice = {
  voiceName?: string;
  lang?: string;
  remote?: boolean;
  eventTypes?: string[];
};

export type ChromeTimelineSpeakOptions = {
  enqueue: boolean;
  lang: string;
  rate: number;
  pitch: number;
  voiceName?: string;
  requiredEventTypes: string[];
  onEvent: (event: TimelineTtsEvent) => void;
};

export type ChromeTimelineTtsApi = {
  getVoices(): Promise<TimelineTtsVoice[]>;
  speak(text: string, options: ChromeTimelineSpeakOptions): void | Promise<void>;
  stop(): void | Promise<void>;
};
```

Implement `selectTimelineVoiceName` with case-insensitive exact matching for
Alex and Samantha, then the ordered locale/local fallbacks. Filter out unnamed,
non-English, and lifecycle-incomplete voices before ranking.

Create and contain the discovery promise at port construction:

```ts
const voicesPromise = Promise.resolve()
  .then(() => ttsApi.getVoices())
  .catch((): TimelineTtsVoice[] => []);
```

In `speak`, capture the current generation, await discovery, return if stale,
then call `ttsApi.speak` with the exact fixed profile and optional selected
`voiceName`. In `stop`, increment the generation before calling
`ttsApi.stop()`.

- [ ] **Step 4: Run focused tests and extension build to verify GREEN**

Run:

```bash
cd chrome-extension
node --experimental-strip-types --test test/timelineNarrator.test.ts
npm run build
```

Expected: all timeline narrator tests pass and TypeScript/Vite build exits 0.

- [ ] **Step 5: Review and commit the behavior change**

Run:

```bash
git diff --check
git add chrome-extension/src/sidepanel/realtime/timelineNarrator.ts chrome-extension/test/timelineNarrator.test.ts
git diff --cached --name-status
git diff --cached --check
git commit -m "fix: configure calmer timeline TTS voice"
```

Expected: only the controller and its focused tests are staged.

---

### Task 2: Document and verify the fixed profile

**Files:**
- Modify: `README.md`
- Modify: `docs/architecture.md`
- Modify: `chrome-extension/README.md`
- Reference: `docs/superpowers/specs/2026-08-09-timeline-tts-voice-profile-design.md`

**Interfaces:**
- Consumes: Task 1's production behavior.
- Produces: current setup and architecture documentation plus repository-wide verification evidence.

- [ ] **Step 1: Update current documentation**

State in the three current documentation surfaces that automatic timeline TTS
uses installed Chrome/OS voices, prefers Alex then Samantha then compatible
English fallbacks, and always supplies `en-US`, rate `0.9`, and pitch `0.9`.
Keep Gemini Live answer voices explicitly outside this profile.

- [ ] **Step 2: Run focused and repository-wide verification**

Run:

```bash
npm test --workspace chrome-extension
npm run build --workspace chrome-extension
npm run check
```

Expected: orchestration, backend, extension, and dashboard tests/typechecks/
builds all pass. Record the known dashboard chunk-size warning separately.

- [ ] **Step 3: Review and commit documentation**

Run:

```bash
git diff --check
git add README.md docs/architecture.md chrome-extension/README.md
git diff --cached --name-status
git diff --cached --check
git commit -m "docs: describe timeline TTS voice profile"
```

Expected: only the three current documentation files are staged.

- [ ] **Step 4: Fast-forward local `dev` and verify the exact merged tree**

From the main checkout, run:

```bash
git merge --ff-only fix/timeline-tts-voice-profile
npm run check
```

Expected: local `dev` advances linearly to the fix branch, the main checkout is
clean, and the exact integrated tree passes the full check. Do not push.

- [ ] **Step 5: Record the physical acceptance caveat**

Report that the unpacked extension must be rebuilt/reloaded and one real
timeline event heard on macOS. Automated tests prove options and selection, but
subjective naturalness requires the physical Chrome/OS voice.
