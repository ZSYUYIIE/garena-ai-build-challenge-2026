# Smart Narration Speech-Only Gating Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Smart narration speak over non-speech tab audio such as instrumental music, ambience, and effects while still blocking or interrupting narration when spoken or speech-like vocal audio is present.

**Architecture:** Replace the extension's RMS-only tab-activity decision with one extension-owned speech signal. A dedicated worker runs a pinned Silero V5 ONNX model on the existing 16 kHz mono captured-tab PCM, while a pure hysteresis state machine converts speech probabilities into a stable boolean. The current RMS gate continues in parallel as the conservative fallback during model startup or failure; the resulting boolean feeds all three existing consumers—the Chrome TTS scheduler, local speech coordinator, and backend `SpeechPolicy`—without changing microphone audio, Cloud STT, or Gemini Live inputs.

**Tech Stack:** TypeScript 5.9, Chrome Manifest V3, Web Workers, WebAssembly, ONNX Runtime Web `1.27.0`, `@ricky0123/vad-web` `0.0.30` for the pinned Silero V5 model asset, Web Audio 16 kHz PCM, Node `node:test`, existing Cloud Speech-to-Text V2 voice-activity events.

**Specs:** Treat `docs/superpowers/specs/2026-08-09-chrome-timeline-tts-design.md` as authoritative for user-visible automatic Chrome TTS, `docs/superpowers/specs/2026-08-09-voice-narration-modes-design.md` as authoritative for mode behavior, and `docs/superpowers/specs/2026-08-04-gemini-live-voice-context-design.md` as authoritative for captured-tab transcription, source separation, and the backend speech-safety policy.

## Global Constraints

- Keep microphone PCM and captured-tab PCM separate. Captured-tab audio remains commentary context and must never be reclassified as user input or sent to Gemini Live.
- Automatic narration remains grounded in an admitted visual frame, accepted into the timeline before Chrome TTS, and subject to the existing five-second freshness boundary.
- Change only the meaning of the fast local tab signal from “audible energy” to “detected speech”. Do not change Gemini prompts, microphone VAD, frame admission, transcript storage, or answer playback.
- Preserve Cloud STT `SPEECH_ACTIVITY_BEGIN` and `SPEECH_ACTIVITY_END` as an independent backend safety signal. The backend `SpeechPolicy` continues blocking Smart narration when local speech **or** Cloud speech is active; the Chrome TTS scheduler continues using the extension-local speech signal defined by the current Chrome TTS design.
- Preserve the current 750 ms quiet window in each existing scheduler: Chrome TTS applies it after local speech becomes inactive, while the backend policy applies it after both local and Cloud speech are inactive. Do not use this feature to reconcile or redesign the pre-existing narration owners.
- Preserve `over_audio`, `narration_only`, `question_only`, question interruption, and current gain behavior. Smart mode must not begin ducking tab audio as part of this change.
- Treat singing, chanting, and voice-like audio as speech when the model is uncertain. False negatives that talk over dialogue are more harmful than false positives that delay narration.
- Run the model entirely from packaged extension assets. Do not load JavaScript, WebAssembly, or model weights from a CDN or other remote origin.
- Keep raw audio ephemeral. Do not log, persist, archive, or include PCM in diagnostics.
- Use a single-threaded WASM execution provider in a dedicated worker. Never run model inference on the side-panel UI thread or the audio render thread.
- If model initialization, inference, ordering, or queue bounds fail, terminate the worker and use the existing RMS gate for the rest of that capture session. This preserves today's conservative behavior.
- Pin dependency versions exactly and record third-party license/source information.
- Preserve unrelated working-tree changes, including any pre-existing `package-lock.json` edits. Before each commit, review the staged file list and run `git diff --check`.
- If execution starts on a new branch, use the functionality-based name `smart-narration-speech-gating` without a `codex/` prefix. Do not push or open a pull request without separate user authorization.

---

## File Map

### New files

- `chrome-extension/src/sidepanel/realtime/tabSpeechDecision.ts`: pure probability hysteresis and monotonic-time validation.
- `chrome-extension/src/sidepanel/realtime/tabSpeechWorkerProtocol.ts`: strict main-thread/worker message types and guards.
- `chrome-extension/src/sidepanel/realtime/sileroV5.ts`: ONNX session/state ownership for one 512-sample speech-probability frame.
- `chrome-extension/src/sidepanel/realtime/tabSpeechWorkerRuntime.ts`: testable serialized command runner with injected model loading, clock, and event sink.
- `chrome-extension/src/sidepanel/realtime/tabSpeechWorker.ts`: serialized worker initialization and inference loop.
- `chrome-extension/src/sidepanel/realtime/tabSpeechGate.ts`: 16 kHz reframing, worker lifecycle, bounded in-flight work, model warm-up, and RMS fallback.
- `chrome-extension/test/tabSpeechDecision.test.ts`: pure hysteresis tests.
- `chrome-extension/test/sileroV5.test.ts`: tensor/state/disposal tests with a fake ONNX session.
- `chrome-extension/test/tabSpeechWorkerProtocol.test.ts`: strict message guard tests.
- `chrome-extension/test/tabSpeechWorkerRuntime.test.ts`: initialization, serialization, failure sanitization, generation, and close tests.
- `chrome-extension/test/tabSpeechGate.test.ts`: worker ordering, warm-up, fallback, and teardown tests.
- `chrome-extension/test/verifyVadAssets.test.ts`: build-verifier fixtures for asset counts, size bounds, CSP, and remote URL rejection.
- `chrome-extension/scripts/verify-vad-assets.mjs`: post-build local-asset and CSP verification.
- `chrome-extension/THIRD_PARTY_NOTICES.md`: ONNX Runtime, browser VAD package, and Silero model notices.
- `docs/verification/2026-08-21-smart-narration-speech-only-gating.md`: physical Chrome/provider acceptance matrix.

### Modified files

- `chrome-extension/package.json`, `package-lock.json`: exact runtime/model dependencies and post-build verifier.
- `chrome-extension/extensionManifest.ts`: enable packaged WebAssembly with `'wasm-unsafe-eval'` while retaining local-only script sources.
- `chrome-extension/src/sidepanel/realtime/voiceActivity.ts`: identify `TabActivityGate` as the conservative energy fallback rather than the primary speech detector.
- `chrome-extension/src/sidepanel/realtime/mediaAudio.ts`: create, feed, and stop `TabSpeechGate`; publish detected speech instead of raw energy.
- `chrome-extension/src/sidepanel/realtime/useRealtimeSession.ts`: route the speech boolean to the coordinator, Chrome TTS scheduler, and existing protocol command.
- `chrome-extension/src/sidepanel/realtime/timelineNarrator.ts`: rename the local API/state from tab activity to tab speech without changing timing.
- `chrome-extension/src/sidepanel/realtime/speechCoordinator.ts`: rename the local API/state from tab activity to tab speech without changing priorities or gain.
- `chrome-extension/test/voiceActivity.test.ts`, `chrome-extension/test/mediaAudio.test.ts`, `chrome-extension/test/timelineNarrator.test.ts`, `chrome-extension/test/speechCoordinator.test.ts`, `chrome-extension/test/manifest.test.ts`, `chrome-extension/test/protocolContract.test.ts`: regression coverage for the new semantics and packaged assets.
- `ai-voice-realtime/src/protocol/browserMessages.js`: document that protocol-v2 `tab_audio_activity.active` now carries detected local speech; retain the wire name for compatibility.
- `ai-voice-realtime/test/browserMessages.test.js`, `ai-voice-realtime/test/speechPolicy.test.js`, `ai-voice-realtime/test/clientSession.test.js`: assert the preserved local-speech/Cloud-speech OR policy.
- `README.md`, `docs/architecture.md`, `chrome-extension/README.md`, `ai-voice-realtime/README.md`: document speech-only Smart gating, fallback, local assets, and unchanged source ownership.

---

### Task 1: Pure speech-probability decision state machine

**Files:**
- Create: `chrome-extension/src/sidepanel/realtime/tabSpeechDecision.ts`
- Create: `chrome-extension/test/tabSpeechDecision.test.ts`

**Interfaces:**
- Produces: `TabSpeechDecisionResult = { active: boolean; changed: boolean; stableNonSpeechMs: number }`.
- Produces: `TabSpeechDecision.push(probability: number, frameEndMs: number): TabSpeechDecisionResult`.
- Produces: `TabSpeechDecision.reset(): void`.
- Uses exact initial constants: positive threshold `0.65`, negative threshold `0.35`, two positive frames in a rolling three-frame window, and `500` ms continuous negative evidence before speech end.

- [ ] **Step 1: Write failing decision tests**

```ts
import assert from "node:assert/strict";
import test from "node:test";
import { TabSpeechDecision } from "../src/sidepanel/realtime/tabSpeechDecision.ts";

test("requires two positive frames in a rolling three-frame window", () => {
  const decision = new TabSpeechDecision();
  assert.equal(decision.push(0.92, 32).active, false);
  assert.equal(decision.push(0.10, 64).active, false);
  assert.deepEqual(decision.push(0.81, 96), {
    active: true,
    changed: true,
    stableNonSpeechMs: 0,
  });
});

test("does not classify sustained low-probability music as speech", () => {
  const decision = new TabSpeechDecision();
  for (let frame = 1; frame <= 40; frame += 1) {
    assert.equal(decision.push(0.12, frame * 32).active, false);
  }
});

test("holds active through uncertainty and closes after 500 ms below 0.35", () => {
  const decision = new TabSpeechDecision();
  decision.push(0.80, 32);
  decision.push(0.76, 64);
  assert.equal(decision.push(0.50, 96).active, true);
  for (let frame = 4; frame < 19; frame += 1) {
    assert.equal(decision.push(0.10, frame * 32).active, true);
  }
  assert.deepEqual(decision.push(0.10, 19 * 32), {
    active: false,
    changed: true,
    stableNonSpeechMs: 512,
  });
});

test("rejects invalid probabilities and non-monotonic frame clocks", () => {
  const decision = new TabSpeechDecision();
  assert.throws(() => decision.push(Number.NaN, 32), /probability/i);
  decision.push(0.1, 64);
  assert.throws(() => decision.push(0.1, 63), /monotonic/i);
});
```

- [ ] **Step 2: Run the decision test and verify it fails because the module does not exist**

Run: `node --experimental-strip-types --test chrome-extension/test/tabSpeechDecision.test.ts`

Expected: FAIL with module-not-found for `tabSpeechDecision.ts`.

- [ ] **Step 3: Implement the bounded state machine**

Use a bounded three-element boolean queue, not an unbounded probability history:

```ts
export const TAB_SPEECH_POSITIVE_THRESHOLD = 0.65;
export const TAB_SPEECH_NEGATIVE_THRESHOLD = 0.35;
export const TAB_SPEECH_START_WINDOW_FRAMES = 3;
export const TAB_SPEECH_START_REQUIRED_FRAMES = 2;
export const TAB_SPEECH_END_HANGOVER_MS = 500;

export type TabSpeechDecisionResult = {
  active: boolean;
  changed: boolean;
  stableNonSpeechMs: number;
};

export class TabSpeechDecision {
  private active = false;
  private lastFrameEndMs: number | null = null;
  private negativeSinceMs: number | null = null;
  private positives: boolean[] = [];

  push(probability: number, frameEndMs: number): TabSpeechDecisionResult {
    if (!Number.isFinite(probability) || probability < 0 || probability > 1) {
      throw new RangeError("Speech probability must be between zero and one.");
    }
    if (!Number.isFinite(frameEndMs) || frameEndMs < 0) {
      throw new RangeError("Speech frame time must be finite and nonnegative.");
    }
    if (this.lastFrameEndMs !== null && frameEndMs <= this.lastFrameEndMs) {
      throw new RangeError("Speech frame time must be strictly monotonic.");
    }

    const priorFrameEndMs = this.lastFrameEndMs;
    this.lastFrameEndMs = frameEndMs;
    const wasActive = this.active;

    if (!this.active) {
      this.positives.push(probability >= TAB_SPEECH_POSITIVE_THRESHOLD);
      if (this.positives.length > TAB_SPEECH_START_WINDOW_FRAMES) this.positives.shift();
      if (probability <= TAB_SPEECH_NEGATIVE_THRESHOLD) {
        this.negativeSinceMs ??= priorFrameEndMs ?? frameEndMs;
      } else {
        this.negativeSinceMs = null;
      }
      if (this.positives.filter(Boolean).length >= TAB_SPEECH_START_REQUIRED_FRAMES) {
        this.active = true;
        this.negativeSinceMs = null;
        this.positives = [];
      }
    } else if (probability <= TAB_SPEECH_NEGATIVE_THRESHOLD) {
      this.negativeSinceMs ??= priorFrameEndMs ?? frameEndMs;
      if (frameEndMs - this.negativeSinceMs >= TAB_SPEECH_END_HANGOVER_MS) {
        this.active = false;
        this.positives = [];
      }
    } else {
      this.negativeSinceMs = null;
    }

    const stableNonSpeechMs = this.active || this.negativeSinceMs === null
      ? 0
      : frameEndMs - this.negativeSinceMs;
    return { active: this.active, changed: wasActive !== this.active, stableNonSpeechMs };
  }

  reset(): void {
    this.active = false;
    this.lastFrameEndMs = null;
    this.negativeSinceMs = null;
    this.positives = [];
  }
}
```

The inactive branch deliberately starts `negativeSinceMs` on the first low-probability interval. That makes `stableNonSpeechMs` usable for the worker warm-up handoff even when speech has never opened.

- [ ] **Step 4: Run the decision tests**

Run: `node --experimental-strip-types --test chrome-extension/test/tabSpeechDecision.test.ts`

Expected: all decision tests PASS.

- [ ] **Step 5: Commit the pure decision unit**

```bash
git add chrome-extension/src/sidepanel/realtime/tabSpeechDecision.ts chrome-extension/test/tabSpeechDecision.test.ts
git diff --cached --check
git commit -m "feat: add tab speech probability decision"
```

---

### Task 2: Pinned Silero model adapter and serialized worker

**Files:**
- Create: `chrome-extension/src/sidepanel/realtime/tabSpeechWorkerProtocol.ts`
- Create: `chrome-extension/src/sidepanel/realtime/sileroV5.ts`
- Create: `chrome-extension/src/sidepanel/realtime/tabSpeechWorkerRuntime.ts`
- Create: `chrome-extension/src/sidepanel/realtime/tabSpeechWorker.ts`
- Create: `chrome-extension/test/sileroV5.test.ts`
- Create: `chrome-extension/test/tabSpeechWorkerProtocol.test.ts`
- Create: `chrome-extension/test/tabSpeechWorkerRuntime.test.ts`
- Modify: `chrome-extension/package.json`
- Modify: `package-lock.json`

**Interfaces:**
- Consumes: 512-sample `Float32Array` frames normalized to `[-1, 1]` at exactly 16 kHz.
- Produces: `SileroSpeechModel.process(frame): Promise<number>` returning one finite probability in `[0, 1]`.
- Produces: `SileroV5Model(session, tensorFactory)` with injectable ONNX-compatible dependencies for disposal-focused unit tests; `loadSileroV5Model()` supplies the real ONNX Runtime implementations.
- Produces: strict worker commands `initialize`, `frame`, `reset`, and `close`.
- Produces: strict worker events `ready`, `probability`, and `failed`, each carrying a generation number; frame results also carry sequence and frame-end time.
- Produces: `createTabSpeechWorkerRuntime({ loadModel, postEvent, now, closeWorker })` so worker behavior is deterministic under Node tests.
- Pins: `onnxruntime-web@1.27.0` and `@ricky0123/vad-web@0.0.30`.

- [ ] **Step 1: Install exact dependencies from the repository root**

Run:

```bash
npm install --save-exact --workspace chrome-extension onnxruntime-web@1.27.0 @ricky0123/vad-web@0.0.30
```

Expected: `chrome-extension/package.json` contains exact versions without `^` or `~`; `package-lock.json` records package integrity values. Review the existing `package-lock.json` diff first and preserve unrelated user edits.

- [ ] **Step 2: Write failing model ownership tests**

Define these local test fakes before the tests so tensor creation and disposal are observable:

```ts
class FakeTensor {
  disposeCalls = 0;
  constructor(
    readonly data: ArrayLike<number | bigint>,
    readonly dims: readonly number[],
  ) {}
  dispose() { this.disposeCalls += 1; }
  get disposed() { return this.disposeCalls > 0; }
}

function fakeSileroFixture(probability: number) {
  const created: FakeTensor[] = [];
  const returnedOutput = new FakeTensor(new Float32Array([probability]), [1, 1]);
  const returnedState = new FakeTensor(new Float32Array(256), [2, 1, 128]);
  const tensorFactory = (
    _type: "float32" | "int64",
    data: ArrayLike<number | bigint>,
    dims: readonly number[],
  ) => {
    const tensor = new FakeTensor(data, dims);
    created.push(tensor);
    return tensor;
  };
  const session = {
    runCalls: 0,
    releaseCalls: 0,
    lastInputs: null as null | Record<string, FakeTensor>,
    async run(inputs: Record<string, FakeTensor>) {
      this.runCalls += 1;
      this.lastInputs = inputs;
      return {
        output: returnedOutput,
        stateN: returnedState,
      };
    },
    async release() { this.releaseCalls += 1; },
  };
  return {
    created,
    returnedOutput,
    returnedState,
    session,
    tensorFactory,
    initialState: () => created.find((tensor) => tensor.dims.join(",") === "2,1,128")!,
    sampleRate: () => created.find((tensor) => tensor.dims.join(",") === "1")!,
  };
}
```

Build a fake session whose first run returns probability `0.82` and a replacement state tensor. Assert these behaviors:

```ts
test("Silero V5 sends the fixed tensor contract and retains the returned state", async () => {
  const fixture = fakeSileroFixture(0.82);
  const model = new SileroV5Model(fixture.session, fixture.tensorFactory);
  const probability = await model.process(new Float32Array(512));

  assert.equal(probability, 0.82);
  assert.deepEqual(fixture.session.lastInputs!.input.dims, [1, 512]);
  assert.deepEqual(fixture.session.lastInputs!.state.dims, [2, 1, 128]);
  assert.deepEqual(Array.from(fixture.session.lastInputs!.sr.data), [16_000n]);
  assert.equal(fixture.initialState().disposed, true);
  assert.equal(fixture.returnedOutput.disposed, true);
  assert.equal(fixture.returnedState.disposed, false);
});

test("Silero V5 rejects the wrong frame length before inference", async () => {
  const fixture = fakeSileroFixture(0.2);
  const model = new SileroV5Model(fixture.session, fixture.tensorFactory);
  await assert.rejects(() => model.process(new Float32Array(640)), /512/);
  assert.equal(fixture.session.runCalls, 0);
});

test("Silero V5 releases session and owned tensors exactly once", async () => {
  const fixture = fakeSileroFixture(0.2);
  const model = new SileroV5Model(fixture.session, fixture.tensorFactory);
  await model.close();
  await model.close();
  assert.equal(fixture.session.releaseCalls, 1);
  assert.equal(fixture.initialState().disposeCalls, 1);
  assert.equal(fixture.sampleRate().disposeCalls, 1);
});
```

- [ ] **Step 3: Run the model test and verify it fails**

Run: `node --experimental-strip-types --test chrome-extension/test/sileroV5.test.ts`

Expected: FAIL because `sileroV5.ts` and its exports do not exist.

- [ ] **Step 4: Write failing strict-message and worker-runtime tests**

```ts
export type TabSpeechWorkerCommand =
  | { type: "initialize"; generation: number }
  | { type: "frame"; generation: number; sequence: number; frameEndMs: number; pcm: ArrayBuffer }
  | { type: "reset"; generation: number }
  | { type: "close"; generation: number };

export type TabSpeechWorkerEvent =
  | { type: "ready"; generation: number }
  | { type: "probability"; generation: number; sequence: number; frameEndMs: number; probability: number; inferenceMs: number }
  | { type: "failed"; generation: number; stage: "initialize" | "inference" };
```

Add runtime guards that reject arrays, unknown keys, non-safe sequence integers, non-monotonic-invalid numeric fields, non-`ArrayBuffer` PCM, and probabilities outside `[0, 1]`. Do not include exception strings or PCM in worker failure events.

Write table-driven tests in `tabSpeechWorkerProtocol.test.ts` covering every command/event variant plus null, arrays, extra keys, wrong generations, unsafe sequences, invalid probability/time values, and a non-2,048-byte frame buffer. Add worker-runtime tests proving initialization emits one `ready`; a deferred model never has two concurrent `process()` calls; probability events preserve sequence order; stale generations are ignored; initialization and inference failures emit only the sanitized stage; and `close` releases the model/worker exactly once.

Run:

```bash
node --experimental-strip-types --test chrome-extension/test/tabSpeechWorkerProtocol.test.ts chrome-extension/test/tabSpeechWorkerRuntime.test.ts
```

Expected: FAIL because the message guards and worker runtime do not exist yet.

- [ ] **Step 5: Implement the Silero V5 adapter**

`SileroV5Model` owns one ONNX session, a `[2, 1, 128]` float state tensor, and a `[1]` int64 sample-rate tensor. For each frame:

```ts
const input = this.tensorFactory("float32", frame, [1, 512]);
const previousState = this.state;
let outputs: Record<string, ort.Tensor> | undefined;
let adoptedState: ort.Tensor | undefined;
try {
  outputs = await this.session.run({ input, state: previousState, sr: this.sampleRate });
  const probability = Number(outputs.output?.data[0]);
  const nextState = outputs.stateN;
  if (!Number.isFinite(probability) || probability < 0 || probability > 1 || !nextState) {
    throw new Error("Silero returned an invalid result.");
  }
  if (nextState !== previousState) previousState.dispose();
  this.state = nextState;
  adoptedState = nextState;
  return probability;
} finally {
  input.dispose();
  for (const tensor of new Set(Object.values(outputs ?? {}))) {
    if (tensor !== adoptedState) tensor.dispose();
  }
}
```

Never dispose an adopted `stateN` in the `finally` block. Add a test whose fake session throws and assert that the input tensor is still disposed and the retained recurrent state is unchanged.

`reset()` disposes the current state and creates zeros with the same dimensions. `close()` is idempotent and releases the session and both retained tensors. `loadSileroV5Model()` configures the WASM provider before creating the session:

```ts
ort.env.wasm.numThreads = 1;
ort.env.wasm.proxy = false;
ort.env.wasm.wasmPaths = { wasm: options.wasmUrl, mjs: options.wasmModuleUrl };
const session = await ort.InferenceSession.create(options.modelUrl, {
  executionProviders: ["wasm"],
  graphOptimizationLevel: "all",
});
return new SileroV5Model(
  session,
  (type, data, dimensions) => new ort.Tensor(type, data, dimensions),
);
```

- [ ] **Step 6: Implement the worker with locally emitted asset URLs**

Put the serialized queue and all command behavior in `tabSpeechWorkerRuntime.ts`; keep `tabSpeechWorker.ts` as a thin adapter over `self`. Use Vite `?url` imports so the clean build emits only the needed model/runtime assets:

```ts
import * as ort from "onnxruntime-web/wasm";
import modelUrl from "@ricky0123/vad-web/dist/silero_vad_v5.onnx?url";
import wasmModuleUrl from "onnxruntime-web/ort-wasm-simd-threaded.mjs?url";
import wasmUrl from "onnxruntime-web/ort-wasm-simd-threaded.wasm?url";
```

Define `closeModel()` to idempotently release the current `SileroSpeechModel`, and define `postSafeFailure(stage)` to emit only `{ type: "failed", generation, stage }`. Maintain one promise chain so async inference cannot overlap or reorder:

```ts
export function createTabSpeechWorkerRuntime(dependencies: WorkerRuntimeDependencies) {
  let generation = 0;
  let model: SileroSpeechModel | null = null;
  let work = Promise.resolve();

  async function closeModel(): Promise<void> {
    const closing = model;
    model = null;
    if (closing) await closing.close();
  }

  function postSafeFailure(stage: "initialize" | "inference"): void {
    dependencies.postEvent({ type: "failed", generation, stage });
  }

  function receive(value: unknown): Promise<void> {
    work = work.then(async () => {
      let stage: "initialize" | "inference" = "inference";
      try {
        const command = parseTabSpeechWorkerCommand(value);
        stage = command.type === "initialize" ? "initialize" : "inference";
        await handleCommand(command);
      } catch {
        try { await closeModel(); } catch { /* worker is already failing closed */ }
        postSafeFailure(stage);
      }
    });
    return work;
  }

  return { receive };
}
```

The thin worker entrypoint creates this runtime with real dependencies and assigns `self.onmessage = (event) => { void runtime.receive(event.data); }`. It must contain no policy or queue logic of its own.

On a `frame` command, require exactly `512 * 4` bytes, reconstruct `Float32Array`, run inference, and post `probability` without echoing PCM. Measure `inferenceMs` with `performance.now()`. A generation mismatch is ignored. `reset` resets recurrent state; `close` releases the model and calls `self.close()`.

- [ ] **Step 7: Run the model tests and extension typecheck/build**

Run:

```bash
node --experimental-strip-types --test chrome-extension/test/sileroV5.test.ts chrome-extension/test/tabSpeechWorkerProtocol.test.ts chrome-extension/test/tabSpeechWorkerRuntime.test.ts
```

Expected: all Silero ownership, strict-message, serialization, generation, sanitized-failure, and lifecycle tests PASS.

Run: `npm run build --workspace chrome-extension`

Expected at this stage: TypeScript and Vite build PASS and emit the worker/model/WASM assets; runtime CSP verification is added in Task 5.

- [ ] **Step 8: Commit the model/worker unit**

```bash
git add chrome-extension/package.json package-lock.json chrome-extension/src/sidepanel/realtime/tabSpeechWorkerProtocol.ts chrome-extension/src/sidepanel/realtime/sileroV5.ts chrome-extension/src/sidepanel/realtime/tabSpeechWorkerRuntime.ts chrome-extension/src/sidepanel/realtime/tabSpeechWorker.ts chrome-extension/test/sileroV5.test.ts chrome-extension/test/tabSpeechWorkerProtocol.test.ts chrome-extension/test/tabSpeechWorkerRuntime.test.ts
git diff --cached --check
git commit -m "feat: add local Silero speech worker"
```

---

### Task 3: Bounded speech gate with conservative fallback

**Files:**
- Create: `chrome-extension/src/sidepanel/realtime/tabSpeechGate.ts`
- Create: `chrome-extension/test/tabSpeechGate.test.ts`
- Modify: `chrome-extension/src/sidepanel/realtime/voiceActivity.ts`
- Modify: `chrome-extension/test/voiceActivity.test.ts`

**Interfaces:**
- Consumes: 16 kHz mono `Int16Array` packets and their first-sample extension-session timestamp.
- Consumes: `TabSpeechDecision` from Task 1 and worker events from Task 2.
- Produces: `TabSpeechGate.push(pcm, firstSampleTimestampMs): void`.
- Produces: `TabSpeechGate.stop(): void`.
- Calls: `onSpeechChange(active)` only when the published boolean changes.
- Uses: worker frame size `512` samples/32 ms, warm-up requirement `500` ms stable model non-speech, initialization timeout `5_000` ms, and maximum `8` in-flight frames.

- [ ] **Step 1: Write failing gate tests with an injected fake worker**

Define a worker double and deterministic 512-sample packets in the test file:

```ts
class FakeWorker {
  onmessage: ((event: MessageEvent<unknown>) => void) | null = null;
  onerror: ((event: ErrorEvent) => void) | null = null;
  readonly sent: unknown[] = [];
  terminateCalls = 0;
  postMessage(message: unknown) { this.sent.push(message); }
  terminate() { this.terminateCalls += 1; }
  emit(data: unknown) { this.onmessage?.({ data } as MessageEvent<unknown>); }
}

const framePacket = (amplitude = 0.01) =>
  Int16Array.from({ length: 512 }, (_, index) =>
    Math.round(Math.sin(index * 0.17) * amplitude * 32_767));
const loudInstrumentalPacket = () => framePacket(0.20);

function createGateFixture() {
  const worker = new FakeWorker();
  const activity: boolean[] = [];
  const gate = new TabSpeechGate({
    onSpeechChange: (active) => activity.push(active),
    createWorker: () => worker,
  });
  let timestampMs = 0;
  const pushPcm = (pcm = framePacket()) => {
    gate.push(pcm, timestampMs);
    timestampMs += 32;
  };
  const pushProbability = (probability: number, pcm = framePacket()) => {
    pushPcm(pcm);
    const command = worker.sent.at(-1) as Extract<TabSpeechWorkerCommand, { type: "frame" }>;
    worker.emit({
      type: "probability",
      generation: command.generation,
      sequence: command.sequence,
      frameEndMs: command.frameEndMs,
      probability,
      inferenceMs: 1,
    });
  };
  return { activity, gate, pushPcm, pushProbability, worker };
}

function createReadyGateFixture() {
  const fixture = createGateFixture();
  fixture.worker.emit({ type: "ready", generation: 1 });
  for (let frame = 0; frame < 17; frame += 1) fixture.pushProbability(0.08);
  return fixture;
}
```

Cover all transitions explicitly:

```ts
test("uses energy fallback until model non-speech is stable for 500 ms", () => {
  const fixture = createGateFixture();
  fixture.pushPcm(loudInstrumentalPacket());
  assert.deepEqual(fixture.activity, [true]);

  fixture.worker.emit({ type: "ready", generation: 1 });
  for (let frame = 0; frame < 17; frame += 1) {
    fixture.pushProbability(0.08, loudInstrumentalPacket());
  }
  assert.deepEqual(fixture.activity, [true, false]);
});

test("publishes model speech and returns false only after end hysteresis", () => {
  const fixture = createReadyGateFixture();
  fixture.pushProbability(0.78);
  fixture.pushProbability(0.82);
  assert.equal(fixture.activity.at(-1), true);
  for (let frame = 0; frame < 15; frame += 1) fixture.pushProbability(0.10);
  assert.equal(fixture.activity.at(-1), true);
  fixture.pushProbability(0.10);
  assert.equal(fixture.activity.at(-1), false);
});

test("falls back to current energy state on worker failure", () => {
  const fixture = createReadyGateFixture();
  fixture.gate.push(loudInstrumentalPacket(), 1_000);
  fixture.worker.emit({ type: "failed", generation: 1, stage: "inference" });
  assert.equal(fixture.worker.terminateCalls, 1);
  assert.equal(fixture.activity.at(-1), true);
});

test("fails over when more than eight frames are unacknowledged", () => {
  const fixture = createReadyGateFixture();
  for (let frame = 0; frame < 9; frame += 1) {
    fixture.gate.push(loudInstrumentalPacket(), 2_000 + frame * 32);
  }
  assert.equal(fixture.worker.terminateCalls, 1);
  assert.equal(fixture.activity.at(-1), true);
});

test("ignores stale and out-of-order worker events after stop", () => {
  const fixture = createReadyGateFixture();
  const activityCount = fixture.activity.length;
  fixture.gate.stop();
  fixture.worker.emit({
    type: "probability",
    generation: 1,
    sequence: 99,
    frameEndMs: 9_999,
    probability: 0.99,
    inferenceMs: 1,
  });
  assert.equal(fixture.activity.length, activityCount);
});
```

Extend the fixture with injected fake timers and add separate tests for: five-second initialization timeout; `worker.onerror`; malformed and skipped-sequence events; a `ready` event from the wrong generation; idempotent `stop()`; and the two-packet sample-clock/discontinuity cases described below. Every failure test must assert one termination, one transition to fallback, and no worker retry in that capture session.

- [ ] **Step 2: Run the gate test and verify it fails**

Run: `node --experimental-strip-types --test chrome-extension/test/tabSpeechGate.test.ts`

Expected: FAIL because `tabSpeechGate.ts` does not exist.

- [ ] **Step 3: Mark the existing RMS gate as fallback-only**

Keep its thresholds and behavior unchanged. Add this documentation and rename its test descriptions from “speech-like” to “energy fallback”:

```ts
/**
 * Conservative energy-only fallback used while the neural tab-speech worker is
 * unavailable. It intentionally treats loud music and effects as active.
 */
```

Place that JSDoc immediately above the existing `export class TabActivityGate` declaration; do not alter the class body.

- [ ] **Step 4: Implement `TabSpeechGate` lifecycle and framing**

Create the worker through an injected factory so Node tests do not require a browser:

```ts
type WorkerPort = Pick<Worker, "postMessage" | "terminate"> & {
  onmessage: ((event: MessageEvent<unknown>) => void) | null;
  onerror: ((event: ErrorEvent) => void) | null;
};

export type TabSpeechGateOptions = {
  onSpeechChange: (active: boolean) => void;
  createWorker?: () => WorkerPort;
  setTimeout?: typeof globalThis.setTimeout;
  clearTimeout?: typeof globalThis.clearTimeout;
};
```

The default worker factory is:

```ts
() => new Worker(new URL("./tabSpeechWorker.ts", import.meta.url), {
  type: "module",
  name: "streamsense-tab-speech",
})
```

Use `PcmChunker(512)` to reframe existing 1,600-sample transport packets. Convert each frame to a new normalized `Float32Array`, increment a safe integer sequence, and transfer its buffer to the worker. Continue feeding every original packet to `TabActivityGate` so fallback state is always current.

The gate has exactly four modes: `fallback`, `warming`, `model`, and `stopped`.

- `fallback`: publish only `TabActivityGate` changes.
- `warming`: publish fallback state until model speech opens or model non-speech is stable for 500 ms.
- `model`: publish only `TabSpeechDecision.active` changes.
- `stopped`: ignore all PCM and worker callbacks.

The constructor starts in `warming`, creates generation `1`, posts `initialize`, and arms the five-second timeout. While waiting for `ready`, continue updating and publishing the fallback energy state but do not post model frames. After the matching `ready`, begin framing/posting model work and evaluating the 500 ms warm-up. `stop()` clears the timer, advances the generation, terminates the isolated worker context, drops all gate state, and publishes nothing further. Keep the worker's `close` command for orderly worker-level lifecycle tests, but do not delay capture teardown waiting for it.

The existing transport packet is 1,600 samples/100 ms. `TabSpeechGate` uses an internal `PcmChunker(512)` and a sample-derived clock: initialize `nextFrameEndMs` to `firstSampleTimestampMs + 32`, advance it exactly 32 ms per emitted frame, and carry the 64-sample remainder into the next transport packet. Track the expected next packet timestamp separately. A non-finite timestamp, a timestamp regression, or a gap larger than 1 ms fails over for the session rather than continuing recurrent inference on discontinuous audio. Add tests spanning two 1,600-sample packets to prove frame ends `32, 64, 96, 128, 160, 192` ms and remainder continuity, plus a discontinuity test that proves conservative fallback.

- [ ] **Step 5: Enforce ordering, timeout, and backpressure**

Track generation, last sent sequence, last accepted sequence, and in-flight count. Accept a probability only when generation matches and sequence is exactly `lastAccepted + 1`. A duplicate, gap, invalid message, worker error, five-second startup timeout, or ninth outstanding frame calls one idempotent `enterFallback()` method:

```ts
private enterFallback(): void {
  if (this.mode === "fallback" || this.mode === "stopped") return;
  this.mode = "fallback";
  this.clearStartupTimer();
  this.worker?.terminate();
  this.worker = null;
  this.decision.reset();
  this.publish(this.energyActive);
}
```

Do not retry a failed worker inside the same capture session. A fresh `RealtimeMediaAudio` session creates a fresh gate.

- [ ] **Step 6: Run gate and fallback tests**

Run:

```bash
node --experimental-strip-types --test chrome-extension/test/tabSpeechDecision.test.ts chrome-extension/test/tabSpeechGate.test.ts chrome-extension/test/voiceActivity.test.ts
```

Expected: all decision, gate, and fallback tests PASS.

- [ ] **Step 7: Commit the bounded gate unit**

```bash
git add chrome-extension/src/sidepanel/realtime/tabSpeechGate.ts chrome-extension/src/sidepanel/realtime/voiceActivity.ts chrome-extension/test/tabSpeechGate.test.ts chrome-extension/test/voiceActivity.test.ts
git diff --cached --check
git commit -m "feat: add resilient tab speech gate"
```

---

### Task 4: Route one speech boolean through every narration consumer

**Files:**
- Modify: `chrome-extension/src/sidepanel/realtime/mediaAudio.ts`
- Modify: `chrome-extension/src/sidepanel/realtime/useRealtimeSession.ts`
- Modify: `chrome-extension/src/sidepanel/realtime/timelineNarrator.ts`
- Modify: `chrome-extension/src/sidepanel/realtime/speechCoordinator.ts`
- Modify: `chrome-extension/test/mediaAudio.test.ts`
- Modify: `chrome-extension/test/timelineNarrator.test.ts`
- Modify: `chrome-extension/test/speechCoordinator.test.ts`
- Modify: `chrome-extension/test/protocolContract.test.ts`
- Modify: `ai-voice-realtime/src/protocol/browserMessages.js`
- Modify: `ai-voice-realtime/test/browserMessages.test.js`
- Modify: `ai-voice-realtime/test/speechPolicy.test.js`
- Modify: `ai-voice-realtime/test/clientSession.test.js`

**Interfaces:**
- Consumes: `TabSpeechGate` from Task 3.
- Renames extension-only callbacks to `onTabSpeechChange`, `setTabSpeechActive`, and `tabSpeechActive`.
- Produces: `createMediaSocketProtocol.sendTabSpeech(active)` while deliberately retaining the protocol-v2 JSON shape `{ type: "tab_audio_activity", active }`.
- Preserves backend behavior: Smart can narrate only when tab context is healthy, local speech is false, and Cloud speech is false.

- [ ] **Step 1: Write failing media integration tests**

Extend the existing `fixture()` helper with an optional injected gate factory. Use this exact fake:

```ts
class FakeTabSpeechGate {
  stopCalls = 0;
  private onSpeechChange: (active: boolean) => void;
  constructor(onSpeechChange: (active: boolean) => void) {
    this.onSpeechChange = onSpeechChange;
  }
  push(_pcm: Int16Array, _timestampMs: number) {}
  setCallback(callback: (active: boolean) => void) { this.onSpeechChange = callback; }
  emit(active: boolean) { this.onSpeechChange(active); }
  stop() { this.stopCalls += 1; }
}
```

Add `tabSpeechGate?: FakeTabSpeechGate` to the existing fixture options. When supplied, inject `createTabSpeechGate: ({ onSpeechChange }) => { options.tabSpeechGate!.setCallback(onSpeechChange); return options.tabSpeechGate!; }`; implement `setCallback` as the single assignment used by `emit`. Rename the fixture's existing `activity` array to `speech`, and rename `tabOptions.onTabActivity` to `onTabSpeechChange`.

Then prove one signal reaches the capture owner without changing PCM transport:

```ts
test("routes detected tab speech independently from captured PCM", async () => {
  const gate = new FakeTabSpeechGate(() => undefined);
  const f = fixture({ tabSpeechGate: gate });
  await f.audio.startTab(f.tabOptions);
  gate.emit(true);
  gate.emit(false);
  f.context.worklets[0].emit(sineFloats(80, 0.2, 440, 48_000));
  assert.deepEqual(f.speech, [true, false]);
  assert.ok(f.tabPackets.length > 0);
});

test("stops the tab speech worker exactly once with capture teardown", async () => {
  const gate = new FakeTabSpeechGate(() => undefined);
  const f = fixture({ tabSpeechGate: gate });
  await f.audio.startTab(f.tabOptions);
  await f.audio.stop();
  await f.audio.stop();
  assert.equal(gate.stopCalls, 1);
});
```

Add regression assertions that tab PCM still reaches `onTabPacket`, local tab playback stays connected, microphone PCM stays separate, and captured video ending still follows existing teardown.

- [ ] **Step 2: Run focused integration tests and verify they fail**

Run:

```bash
node --experimental-strip-types --test chrome-extension/test/mediaAudio.test.ts chrome-extension/test/timelineNarrator.test.ts chrome-extension/test/speechCoordinator.test.ts
```

Expected: FAIL because the new speech-named interfaces are absent.

- [ ] **Step 3: Replace direct RMS use in `RealtimeMediaAudio`**

Remove the primary `new TabActivityGate()` field. Create one `TabSpeechGate` after tab audio capture/worklet setup succeeds:

```ts
this.tabSpeechGate = this.dependencies.createTabSpeechGate({
  onSpeechChange: options.onTabSpeechChange,
});
```

In `handleTabSamples`, keep resampling and transport packetization unchanged, then feed the same packet to both the speech gate and existing consumers:

```ts
const timestampMs = this.takeTabPacketTimestamp(packet.length);
this.tabSpeechGate?.push(packet, timestampMs);
this.userVad.pushReference({
  source: "tab",
  pcm: packet,
  sampleRate: 16_000,
  firstSampleExtensionSessionMs: timestampMs,
});
options.onTabPacket(packet, timestampMs);
```

Stop and clear the gate from `degradeTab()` and normal `stop()` without changing the audio track, playback gain, STT stream, or microphone reference ring behavior.

- [ ] **Step 4: Rename extension-local tab activity APIs to tab speech APIs**

Make these exact renames:

- `TabOptions.onTabActivity` → `onTabSpeechChange`
- `TimelineNarrator.setTabActivity(active)` → `setTabSpeechActive(active)`
- `TimelineNarrator.tabActive` → `tabSpeechActive`
- `SpeechCoordinator.tabActivity(active)` → `setTabSpeechActive(active)`
- `SpeechCoordinator.tabActive` → `tabSpeechActive`
- `createMediaSocketProtocol.sendTabActivity(active)` → `sendTabSpeech(active)`

Retain the existing wire command for protocol-v2 compatibility:

```ts
sendTabSpeech(active: boolean) {
  if (!opened) return false;
  sendJson({ type: "tab_audio_activity", active });
  return true;
}
```

In `useRealtimeSession`, fan out the one callback in this order:

```ts
onTabSpeechChange: (active) => {
  callbackGate.run(() => {
    coordinator.setTabSpeechActive(active);
    timelineNarrator.setTabSpeechActive(active);
    safelySend(() => protocol.sendTabSpeech(active));
  });
},
```

- [ ] **Step 5: Preserve and clarify backend OR semantics**

Do not change the accepted protocol-v2 JSON shape. Add a comment beside its Zod schema stating that `active` is the extension's fast local **speech** decision and the historical command name is retained for compatibility. Update/add tests that prove:

```js
policy.setLocalTabSpeech(true);   // blocks/cancels Smart
policy.setCloudTabSpeech(true);   // independently blocks/cancels Smart
policy.setLocalTabSpeech(false);
policy.setCloudTabSpeech(false);  // starts the existing 750 ms quiet window
```

Assert neither source blocks a user-requested answer and neither source changes `over_audio` or `narration_only` behavior.

- [ ] **Step 6: Run extension and backend focused suites**

Run:

```bash
npm run test --workspace chrome-extension
```

Expected: all extension tests PASS with test names referring to tab speech rather than generic activity/silence where applicable.

Run:

```bash
node --test ai-voice-realtime/test/browserMessages.test.js ai-voice-realtime/test/speechPolicy.test.js ai-voice-realtime/test/clientSession.test.js
```

Expected: all focused backend protocol/session/policy tests PASS.

- [ ] **Step 7: Commit the end-to-end signal routing unit**

```bash
git add chrome-extension/src/sidepanel/realtime/mediaAudio.ts chrome-extension/src/sidepanel/realtime/useRealtimeSession.ts chrome-extension/src/sidepanel/realtime/timelineNarrator.ts chrome-extension/src/sidepanel/realtime/speechCoordinator.ts chrome-extension/test/mediaAudio.test.ts chrome-extension/test/timelineNarrator.test.ts chrome-extension/test/speechCoordinator.test.ts chrome-extension/test/protocolContract.test.ts ai-voice-realtime/src/protocol/browserMessages.js ai-voice-realtime/test/browserMessages.test.js ai-voice-realtime/test/speechPolicy.test.js ai-voice-realtime/test/clientSession.test.js
git diff --cached --check
git commit -m "feat: gate smart narration on detected speech"
```

---

### Task 5: Secure Manifest V3 packaging and third-party notices

**Files:**
- Create: `chrome-extension/scripts/verify-vad-assets.mjs`
- Create: `chrome-extension/test/verifyVadAssets.test.ts`
- Create: `chrome-extension/THIRD_PARTY_NOTICES.md`
- Modify: `chrome-extension/extensionManifest.ts`
- Modify: `chrome-extension/test/manifest.test.ts`
- Modify: `chrome-extension/package.json`

**Interfaces:**
- Produces: a production/development CSP containing `script-src 'self' 'wasm-unsafe-eval'` plus only the existing loopback development exceptions.
- Produces: `npm run verify:vad-assets --workspace chrome-extension`.
- Requires: one emitted Silero `.onnx`, one ONNX Runtime `.wasm`, and its paired `.mjs`; no built JavaScript may contain `cdn.jsdelivr.net`, `unpkg.com`, or an `http(s)` model/runtime URL.

- [ ] **Step 1: Add failing manifest assertions**

```ts
test("allows only packaged WebAssembly for extension pages", () => {
  const production = createExtensionManifest({ name: "test", version: "1.0.0" });
  const development = createExtensionManifest(
    { name: "test", version: "1.0.0" },
    { development: true },
  );
  for (const manifest of [production, development]) {
    const policy = manifest.content_security_policy?.extension_pages ?? "";
    assert.match(policy, /script-src[^;]*'self'[^;]*'wasm-unsafe-eval'/);
    assert.doesNotMatch(policy, /'unsafe-eval'/);
  }
});
```

- [ ] **Step 2: Run the manifest test and verify it fails**

Run: `node --experimental-strip-types --test chrome-extension/test/manifest.test.ts`

Expected: FAIL because `'wasm-unsafe-eval'` is absent.

- [ ] **Step 3: Add the minimum WebAssembly CSP token**

Construct `scriptSources` from `"'self'"`, `"'wasm-unsafe-eval'"`, and the existing loopback Vite origins only in development. Do not add remote origins to `script-src`, `worker-src`, or `connect-src`.

- [ ] **Step 4: Write failing post-build asset-verifier tests**

`verify-vad-assets.mjs` must:

1. Recursively enumerate `chrome-extension/dist`.
2. Require exactly one filename matching `silero_vad_v5*.onnx` with size between 2 MiB and 3 MiB.
3. Require exactly one `ort-wasm-simd-threaded*.wasm` between 10 MiB and 20 MiB and one paired `.mjs` under 100 KiB.
4. Parse the built `manifest.json` and require `'wasm-unsafe-eval'` while rejecting `https:` in production `script-src`.
5. Search emitted `.js` and `.mjs` text and fail on `cdn.jsdelivr.net`, `unpkg.com`, or remote `.onnx`/`.wasm` URLs.
6. Print only asset filenames and sizes; never print environment variables or credentials.

Create isolated temporary `dist` fixtures in `verifyVadAssets.test.ts` and prove: a valid fixture passes; zero or duplicate assets fail; every lower/upper size boundary is enforced; missing/remote CSP fails; each forbidden domain/remote model URL fails; and diagnostics contain filenames but no file contents or environment values.

Run: `node --experimental-strip-types --test chrome-extension/test/verifyVadAssets.test.ts`

Expected: FAIL because `scripts/verify-vad-assets.mjs` does not exist.

- [ ] **Step 5: Implement the post-build asset verifier**

Export the pure verification function for tests, and make direct execution return non-zero on any violation.

Use an implementation shaped like this, with unit tests against temporary directory fixtures for every success/failure branch:

```js
import { readFile, readdir, stat } from "node:fs/promises";
import path from "node:path";

async function collectFiles(root, directory = root) {
  const entries = await readdir(directory, { withFileTypes: true });
  const nested = await Promise.all(entries.map(async (entry) => {
    const absolute = path.join(directory, entry.name);
    return entry.isDirectory() ? collectFiles(root, absolute) : [absolute];
  }));
  return nested.flat();
}

function requireOne(files, pattern, label) {
  const matches = files.filter((file) => pattern.test(path.basename(file)));
  if (matches.length !== 1) throw new Error(`Expected exactly one ${label}; found ${matches.length}.`);
  return matches[0];
}

async function assertSize(file, minimum, maximum, label) {
  const { size } = await stat(file);
  if (size < minimum || size > maximum) {
    throw new Error(`${label} has unexpected size ${size}.`);
  }
  return size;
}

export async function verifyVadAssets(distDirectory) {
  const files = await collectFiles(distDirectory);
  const model = requireOne(files, /^silero_vad_v5.*\.onnx$/, "Silero V5 model");
  const wasm = requireOne(files, /^ort-wasm-simd-threaded.*\.wasm$/, "ONNX WASM binary");
  const module = requireOne(files, /^ort-wasm-simd-threaded.*\.mjs$/, "ONNX WASM module");
  const manifest = JSON.parse(await readFile(path.join(distDirectory, "manifest.json"), "utf8"));
  const policy = manifest.content_security_policy?.extension_pages ?? "";
  const scriptSource = policy.split(";").find((part) => part.trim().startsWith("script-src")) ?? "";
  if (!scriptSource.includes("'wasm-unsafe-eval'") || /https?:/i.test(scriptSource)) {
    throw new Error("Production script-src must allow packaged WASM and reject remote scripts.");
  }

  const forbidden = /(?:cdn\.jsdelivr\.net|unpkg\.com|https?:\/\/[^\s"'`]+\.(?:onnx|wasm)\b)/i;
  for (const file of files.filter((candidate) => /\.(?:js|mjs)$/.test(candidate))) {
    if (forbidden.test(await readFile(file, "utf8"))) {
      throw new Error(`Remote VAD runtime or model reference found in ${path.basename(file)}.`);
    }
  }

  const sizes = [
    await assertSize(model, 2 * 1024 ** 2, 3 * 1024 ** 2, "Silero V5 model"),
    await assertSize(wasm, 10 * 1024 ** 2, 20 * 1024 ** 2, "ONNX WASM binary"),
    await assertSize(module, 1, 100 * 1024, "ONNX WASM module"),
  ];
  return [model, wasm, module].map((file, index) => ({
    file: path.basename(file),
    bytes: sizes[index],
  }));
}
```

- [ ] **Step 6: Wire verification after every extension build**

Change scripts to:

```json
{
  "scripts": {
    "build": "tsc && vite build && npm run verify:vad-assets",
    "verify:vad-assets": "node scripts/verify-vad-assets.mjs"
  }
}
```

- [ ] **Step 7: Add exact third-party notices**

`chrome-extension/THIRD_PARTY_NOTICES.md` must name:

- ONNX Runtime Web `1.27.0`, Microsoft, MIT, `https://github.com/microsoft/onnxruntime`.
- `@ricky0123/vad-web` `0.0.30`, ISC, `https://github.com/ricky0123/vad`.
- Silero VAD V5 model distributed by the pinned `vad-web` package, derived from `https://github.com/snakers4/silero-vad`; record the installed model file's SHA-256 from `node_modules/@ricky0123/vad-web/dist/silero_vad_v5.onnx`.

Generate the checksum with:

```bash
shasum -a 256 node_modules/@ricky0123/vad-web/dist/silero_vad_v5.onnx
```

Copy the exact digest into the notice and do not use a floating model URL.

- [ ] **Step 8: Run manifest tests, production build, and verifier**

Run:

```bash
node --experimental-strip-types --test chrome-extension/test/manifest.test.ts chrome-extension/test/verifyVadAssets.test.ts
```

Expected: manifest and VAD asset-verifier tests PASS.

Run:

```bash
npm run build --workspace chrome-extension
```

Expected: TypeScript, Vite, and `verify:vad-assets` PASS; the total added VAD runtime/model assets are no more than 20 MiB; no remote runtime/model URL is found.

- [ ] **Step 9: Commit secure packaging**

```bash
git add chrome-extension/extensionManifest.ts chrome-extension/test/manifest.test.ts chrome-extension/test/verifyVadAssets.test.ts chrome-extension/package.json chrome-extension/scripts/verify-vad-assets.mjs chrome-extension/THIRD_PARTY_NOTICES.md
git diff --cached --check
git commit -m "build: package local speech detection assets"
```

---

### Task 6: Documentation, performance checks, and physical acceptance

**Files:**
- Create: `docs/verification/2026-08-21-smart-narration-speech-only-gating.md`
- Modify: `README.md`
- Modify: `docs/architecture.md`
- Modify: `chrome-extension/README.md`
- Modify: `ai-voice-realtime/README.md`

**Interfaces:**
- Documents: Chrome TTS uses the local neural speech decision; the backend policy separately ORs that local decision with Cloud STT speech activity.
- Documents: 500 ms local end hangover followed by Chrome TTS's existing 750 ms local quiet window; the backend retains its existing 750 ms quiet window after both safety signals clear.
- Documents: fallback to legacy energy gating for the remainder of a session after local model failure.
- Documents: singing/chanting treated as speech, Smart volume unchanged, and packaged local assets.

- [ ] **Step 1: Update architecture and package documentation**

Use this source-of-truth wording consistently:

```text
Smart narration classifies captured-tab audio as speech or non-speech. A local
Silero VAD worker supplies the fast speech signal used by automatic Chrome TTS.
Chrome TTS applies its existing 750 ms quiet window after local speech clears.
Cloud Speech-to-Text voice activity remains a separate backend safety signal;
the backend policy still waits until both local and Cloud speech are inactive.
Instrumental music, ambience, and effects do not block Chrome TTS when the local
worker classifies them as non-speech.
If the local model cannot start or keep up, the extension uses the former
energy-based gate for the rest of that capture session.
```

Also state that the model never receives microphone PCM, returns only probabilities, retains recurrent tensors only in memory, and loads no remote runtime/model code.

- [ ] **Step 2: Write the physical acceptance matrix**

Create `docs/verification/2026-08-21-smart-narration-speech-only-gating.md` with this exact matrix and a result column:

| Scenario | Expected Smart behavior |
| --- | --- |
| Silent video | Narration begins after the existing 750 ms quiet window. |
| Instrumental music | A fresh event can be narrated while music continues; Smart does not change tab gain. |
| Crowd ambience without an identifiable voice | A fresh event can be narrated after local non-speech stabilizes. |
| Effects such as applause, engines, or impacts | Short non-speech effects do not create a persistent speech state. |
| Clean spoken dialogue | Pending narration does not begin; active narration clears within 200 ms of sustained local speech detection. |
| Speech over music or crowd noise | Speech blocks or clears narration just as clean dialogue does. |
| Singing or chanting | Treat as speech and block Smart narration. |
| Speech pause shorter than 1.25 seconds | Narration remains blocked through local hangover plus Smart quiet window. |
| Voice question during any tab audio | User turn still interrupts automatic Chrome TTS and proceeds through the microphone/Gemini path. |
| `over_audio` mode | Narrates with the existing 40% temporary tab gain regardless of tab speech state. |
| `narration_only` mode | Keeps tab playback muted and narrates as before. |
| Local model initialization/inference failure | Falls back to RMS gating; never becomes permissive. |
| Cloud STT degraded | Chrome timeline TTS continues using the local speech gate; the backend commentary narration path retains its existing degraded policy; questions and the visual timeline remain usable. |

The checklist must record Chrome version, extension commit, model SHA-256, media URL/title, outcome, cancellation latency, and whether worker fallback occurred. It must explicitly forbid attaching captured user PCM.

- [ ] **Step 3: Measure worker performance in a real side-panel session**

Use Chrome DevTools Performance while playing at least ten minutes containing dialogue, instrumental music, and effects. Acceptance thresholds:

- p95 worker inference time is at most `16` ms per 32 ms frame.
- In-flight frames never exceed `4` in the representative run; the hard safety limit remains `8`.
- The side-panel main thread has no VAD task longer than `5` ms.
- No fallback, worker error, unbounded heap growth, or audio discontinuity occurs.
- Added packaged VAD assets remain at or below `20` MiB.

Record numeric results in the verification document. A threshold miss is a release-blocking failure, not a warning.

- [ ] **Step 4: Run automated repository verification**

Run from the repository root:

```bash
npm run check
```

Expected: orchestration, backend, extension tests/build/VAD asset verification, and dashboard checks all PASS.

Run:

```bash
git diff --check
```

Expected: no whitespace errors.

- [ ] **Step 5: Perform physical Chrome/provider acceptance**

Run the matrix from Step 2 with a real captured tab, Chrome TTS, Cloud STT, and the configured backend. Confirm all of the following before calling the feature complete:

1. The exact event is visible in the timeline before Chrome TTS speaks it.
2. Instrumental/non-speech audio continues while Smart narration speaks.
3. Spoken audio blocks or interrupts Smart narration.
4. Captured-tab PCM still reaches Cloud STT; microphone PCM still reaches only the user-turn path.
5. No raw audio is stored in SQLite, MongoDB, logs, or verification artifacts.
6. Restarting the backend does not change Memory persistence behavior.

- [ ] **Step 6: Review the final staged boundary and commit documentation/verification**

Run:

```bash
git status --short
git diff --cached --name-only
git diff --cached --check
```

Expected: only feature-owned audio-gating, tests, packaging, notices, and documentation files are staged; no dashboard/account or unrelated user files are included.

Commit:

```bash
git add README.md docs/architecture.md chrome-extension/README.md ai-voice-realtime/README.md docs/verification/2026-08-21-smart-narration-speech-only-gating.md
git commit -m "docs: document speech-only smart narration"
```

---

## Completion Criteria

- Smart narration uses detected speech rather than RMS energy when the local model is healthy.
- Instrumental music, ambience, and effects can coexist with Smart narration.
- Clean speech, speech over noise/music, singing, and chanting block or interrupt Smart narration.
- Local model failure falls back to current conservative energy gating and never silently becomes permissive.
- Cloud STT remains an independent backend speech safety signal without becoming a new dependency of Chrome timeline TTS.
- All three existing consumers receive the same speech boolean.
- No captured-tab PCM reaches Gemini Live or microphone/user-turn code.
- All model/runtime assets are packaged locally and verified after build.
- Automated checks and the physical acceptance matrix pass with recorded evidence.
