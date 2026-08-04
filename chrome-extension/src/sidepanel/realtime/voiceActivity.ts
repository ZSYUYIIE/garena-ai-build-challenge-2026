import { StreamingPcm16Resampler } from "./audioPcm.ts";

export const VAD_SAMPLE_RATE = 16_000;
export const VAD_PRE_ROLL_MS = 300;
export const VAD_END_HANGOVER_MS = 500;
export const VAD_MIN_SPEECH_MS = 120;
export const VAD_ABSOLUTE_RMS_FLOOR = 0.015;
export const VAD_NOISE_MULTIPLIER = 3;

const INITIAL_NOISE_RMS = 0.003;
const NOISE_SMOOTHING = 0.1;
const MAX_REFERENCE_DELAY_MS = 250;
const REFERENCE_DELAY_STEP_MS = 10;
const ECHO_CORRELATION_THRESHOLD = 0.86;
const ECHO_RESIDUAL_RMS_MAX = 0.1;
const TAB_ACTIVITY_RMS_FLOOR = 0.02;
const TAB_ACTIVITY_HANGOVER_MS = 500;
const VAD_PRE_ROLL_SAMPLES = (VAD_PRE_ROLL_MS * VAD_SAMPLE_RATE) / 1_000;

export type VadEvent =
  | { type: "speech_start"; timestampMs: number; preRoll: Int16Array[] }
  | { type: "speech_audio"; timestampMs: number; pcm: Int16Array }
  | { type: "speech_end"; timestampMs: number };

function durationMs(pcm: Int16Array): number {
  return (pcm.length * 1_000) / VAD_SAMPLE_RATE;
}

function rms(pcm: Int16Array): number {
  if (pcm.length === 0) return 0;
  let total = 0;
  for (const sample of pcm) {
    const normalized = sample / 32_768;
    total += normalized * normalized;
  }
  return Math.sqrt(total / pcm.length);
}

function clonePcm(pcm: Int16Array): Int16Array {
  return pcm.slice();
}

export class AdaptiveVoiceActivityDetector {
  private noiseRms = INITIAL_NOISE_RMS;
  private candidateMs = 0;
  private open = false;
  private lastSpeechEndMs: number | null = null;
  private preRoll: Int16Array[] = [];

  push(pcm: Int16Array, timestampMs: number): VadEvent[] {
    if (!(pcm instanceof Int16Array)) {
      throw new TypeError("VAD PCM must be an Int16Array.");
    }
    if (pcm.length === 0) return [];
    if (!Number.isFinite(timestampMs)) {
      throw new RangeError("VAD timestamp must be finite.");
    }

    const frameDurationMs = durationMs(pcm);
    const frameEndMs = timestampMs + frameDurationMs;
    const frameRms = rms(pcm);
    const threshold = Math.max(VAD_ABSOLUTE_RMS_FLOOR, this.noiseRms * VAD_NOISE_MULTIPLIER);
    const speechLike = frameRms >= threshold;
    this.appendPreRoll(pcm);

    if (!this.open) {
      this.noiseRms += (frameRms - this.noiseRms) * NOISE_SMOOTHING;
      this.candidateMs = speechLike ? this.candidateMs + frameDurationMs : 0;
      if (this.candidateMs < VAD_MIN_SPEECH_MS) return [];

      this.open = true;
      this.candidateMs = 0;
      this.lastSpeechEndMs = frameEndMs;
      return [{ type: "speech_start", timestampMs, preRoll: this.preRoll.map(clonePcm) }];
    }

    if (speechLike) {
      this.lastSpeechEndMs = frameEndMs;
      return [{ type: "speech_audio", timestampMs, pcm: clonePcm(pcm) }];
    }

    if (
      this.lastSpeechEndMs !== null &&
      frameEndMs - this.lastSpeechEndMs >= VAD_END_HANGOVER_MS
    ) {
      this.open = false;
      this.lastSpeechEndMs = null;
      this.candidateMs = 0;
      return [{ type: "speech_end", timestampMs: frameEndMs }];
    }
    return [{ type: "speech_audio", timestampMs, pcm: clonePcm(pcm) }];
  }

  reset(): void {
    this.noiseRms = INITIAL_NOISE_RMS;
    this.candidateMs = 0;
    this.open = false;
    this.lastSpeechEndMs = null;
    this.preRoll = [];
  }

  private appendPreRoll(pcm: Int16Array): void {
    this.preRoll.push(clonePcm(pcm));
    let excessSamples = this.preRoll.reduce((total, frame) => total + frame.length, 0) - VAD_PRE_ROLL_SAMPLES;
    while (excessSamples > 0 && this.preRoll.length > 0) {
      const oldest = this.preRoll[0];
      if (oldest.length <= excessSamples) {
        this.preRoll.shift();
        excessSamples -= oldest.length;
      } else {
        this.preRoll[0] = oldest.slice(excessSamples);
        excessSamples = 0;
      }
    }
  }
}

export type PlaybackReference = {
  source?: "tab" | "model";
  pcm: Int16Array;
  sampleRate: number;
  firstSampleExtensionSessionMs: number;
};

type ReferenceResamplingStream = {
  resampler: StreamingPcm16Resampler;
  nextOutputSampleIndex: number | null;
  expectedNextInputTimestampMs: number | null;
};

class ReferenceRing {
  private readonly streamsByRate = new Map<number, ReferenceResamplingStream>();
  private firstSampleIndex: number | null = null;
  private samples = new Int16Array();

  push(reference: PlaybackReference): void {
    let stream = this.streamsByRate.get(reference.sampleRate);
    if (!stream) {
      stream = {
        resampler: new StreamingPcm16Resampler(reference.sampleRate, VAD_SAMPLE_RATE),
        nextOutputSampleIndex: null,
        expectedNextInputTimestampMs: null,
      };
      this.streamsByRate.set(reference.sampleRate, stream);
    }
    if (
      stream.expectedNextInputTimestampMs === null ||
      Math.abs(reference.firstSampleExtensionSessionMs - stream.expectedNextInputTimestampMs) > 1
    ) {
      this.clearSamples();
      stream.resampler.reset();
      stream.nextOutputSampleIndex = Math.round(
        (reference.firstSampleExtensionSessionMs * VAD_SAMPLE_RATE) / 1_000,
      );
    }
    const floats = Float32Array.from(reference.pcm, (sample) => sample / 32_768);
    const pcm = stream.resampler.push(floats);
    stream.expectedNextInputTimestampMs =
      reference.firstSampleExtensionSessionMs + (reference.pcm.length * 1_000) / reference.sampleRate;
    if (pcm.length === 0) return;
    const startSampleIndex = stream.nextOutputSampleIndex!;
    this.write(startSampleIndex, pcm);
    stream.nextOutputSampleIndex = startSampleIndex + pcm.length;
  }

  correlationFor(microphone: Int16Array, timestampMs: number): number {
    let strongest = 0;
    for (let delayMs = 0; delayMs <= MAX_REFERENCE_DELAY_MS; delayMs += REFERENCE_DELAY_STEP_MS) {
      const reference = this.read(timestampMs - delayMs, microphone.length);
      if (!reference) continue;
      const result = normalizedCorrelationAndResidual(microphone, reference);
      if (
        result.correlation >= ECHO_CORRELATION_THRESHOLD &&
        result.residualRms <= ECHO_RESIDUAL_RMS_MAX
      ) {
        strongest = Math.max(strongest, result.correlation);
      }
    }
    return strongest;
  }

  private read(timestampMs: number, length: number): Int16Array | null {
    if (this.firstSampleIndex === null) return null;
    const startSampleIndex = Math.round((timestampMs * VAD_SAMPLE_RATE) / 1_000);
    const offset = startSampleIndex - this.firstSampleIndex;
    if (offset >= 0 && offset + length <= this.samples.length) {
      return this.samples.slice(offset, offset + length);
    }
    return null;
  }

  reset(): void {
    this.streamsByRate.clear();
    this.clearSamples();
  }

  private clearSamples(): void {
    this.firstSampleIndex = null;
    this.samples = new Int16Array();
  }

  private write(startSampleIndex: number, pcm: Int16Array): void {
    if (this.firstSampleIndex === null) {
      this.firstSampleIndex = startSampleIndex;
      this.samples = pcm.slice();
      return;
    }

    if (startSampleIndex < this.firstSampleIndex) return;
    let offset = startSampleIndex - this.firstSampleIndex;
    if (offset > this.samples.length) {
      const extended = new Int16Array(offset + pcm.length);
      extended.set(this.samples);
      this.samples = extended;
    } else if (offset + pcm.length > this.samples.length) {
      const extended = new Int16Array(offset + pcm.length);
      extended.set(this.samples);
      this.samples = extended;
    }
    this.samples.set(pcm, offset);

    const maximumSamples =
      ((MAX_REFERENCE_DELAY_MS + 1_000) * VAD_SAMPLE_RATE) / 1_000;
    if (this.samples.length > maximumSamples) {
      const discardCount = this.samples.length - maximumSamples;
      this.samples = this.samples.slice(discardCount);
      this.firstSampleIndex += discardCount;
    }
  }
}

function normalizedCorrelationAndResidual(
  microphone: Int16Array,
  reference: Int16Array,
): { correlation: number; residualRms: number } {
  let dot = 0;
  let microphoneEnergy = 0;
  let referenceEnergy = 0;
  for (let index = 0; index < microphone.length; index += 1) {
    dot += microphone[index] * reference[index];
    microphoneEnergy += microphone[index] * microphone[index];
    referenceEnergy += reference[index] * reference[index];
  }
  if (microphoneEnergy === 0 || referenceEnergy === 0) {
    return { correlation: 0, residualRms: 1 };
  }
  const correlation = Math.abs(dot) / Math.sqrt(microphoneEnergy * referenceEnergy);
  const gain = dot / referenceEnergy;
  let residualEnergy = 0;
  for (let index = 0; index < microphone.length; index += 1) {
    const residual = microphone[index] - gain * reference[index];
    residualEnergy += residual * residual;
  }
  return {
    correlation,
    residualRms: Math.sqrt(residualEnergy / microphone.length) / 32_768,
  };
}

export class EchoAwareUserVadGate {
  private readonly detector = new AdaptiveVoiceActivityDetector();
  private readonly references = {
    tab: new ReferenceRing(),
    model: new ReferenceRing(),
  };

  pushReference(reference: PlaybackReference): void {
    if (!(reference.pcm instanceof Int16Array)) {
      throw new TypeError("Playback reference PCM must be an Int16Array.");
    }
    if (!Number.isFinite(reference.sampleRate) || reference.sampleRate <= 0) {
      throw new RangeError("Playback reference sample rate must be positive.");
    }
    if (!Number.isFinite(reference.firstSampleExtensionSessionMs)) {
      throw new RangeError("Playback reference timestamp must be finite.");
    }
    this.references[reference.source ?? "tab"].push(reference);
  }

  pushMicrophone(pcm: Int16Array, timestampMs: number): VadEvent[] {
    const correlated =
      this.references.tab.correlationFor(pcm, timestampMs) >= ECHO_CORRELATION_THRESHOLD ||
      this.references.model.correlationFor(pcm, timestampMs) >= ECHO_CORRELATION_THRESHOLD;
    if (correlated) {
      this.detector.reset();
      return [];
    }
    return this.detector.push(pcm, timestampMs);
  }

  reset(): void {
    this.detector.reset();
    this.references.tab.reset();
    this.references.model.reset();
  }
}

export class TabActivityGate {
  private active = false;
  private lastActiveEndMs: number | null = null;

  push(pcm: Int16Array, timestampMs: number): { changed: boolean; active: boolean } {
    if (!(pcm instanceof Int16Array)) {
      throw new TypeError("Tab PCM must be an Int16Array.");
    }
    if (!Number.isFinite(timestampMs)) {
      throw new RangeError("Tab activity timestamp must be finite.");
    }
    const frameEndMs = timestampMs + durationMs(pcm);
    if (rms(pcm) >= TAB_ACTIVITY_RMS_FLOOR) {
      this.lastActiveEndMs = frameEndMs;
      if (!this.active) {
        this.active = true;
        return { changed: true, active: true };
      }
      return { changed: false, active: true };
    }
    if (
      this.active &&
      this.lastActiveEndMs !== null &&
      frameEndMs - this.lastActiveEndMs >= TAB_ACTIVITY_HANGOVER_MS
    ) {
      this.active = false;
      return { changed: true, active: false };
    }
    return { changed: false, active: this.active };
  }
}
