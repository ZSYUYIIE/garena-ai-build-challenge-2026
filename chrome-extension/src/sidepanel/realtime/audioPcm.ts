function clampPcmFloat(sample: number): number {
  return Math.max(-1, Math.min(1, sample));
}

function toPcm16(sample: number): number {
  const bounded = clampPcmFloat(sample);
  return bounded === -1 ? -32_768 : Math.round(bounded * 32_767);
}

export class StreamingPcm16Resampler {
  private readonly sourceSamplesPerTargetSample: number;
  private buffered = new Float32Array();
  private bufferedStart = 0;
  private sourcePosition = 0;

  constructor(sourceRate: number, targetRate = 16_000) {
    if (!Number.isFinite(sourceRate) || sourceRate <= 0) {
      throw new RangeError("Source sample rate must be positive.");
    }
    if (!Number.isFinite(targetRate) || targetRate <= 0) {
      throw new RangeError("Target sample rate must be positive.");
    }
    this.sourceSamplesPerTargetSample = sourceRate / targetRate;
  }

  push(input: Float32Array): Int16Array {
    if (!(input instanceof Float32Array)) {
      throw new TypeError("Audio input must be a Float32Array.");
    }
    if (input.length === 0) return new Int16Array();

    if (this.sourceSamplesPerTargetSample === 1) {
      return Int16Array.from(input, toPcm16);
    }

    const combined = new Float32Array(this.buffered.length + input.length);
    combined.set(this.buffered);
    combined.set(input, this.buffered.length);
    this.buffered = combined;

    const output: number[] = [];
    while (this.sourcePosition + 1 < this.bufferedStart + this.buffered.length) {
      const lowerSourceIndex = Math.floor(this.sourcePosition);
      const lowerIndex = lowerSourceIndex - this.bufferedStart;
      const fraction = this.sourcePosition - lowerSourceIndex;
      const interpolated =
        this.buffered[lowerIndex] * (1 - fraction) +
        this.buffered[lowerIndex + 1] * fraction;
      output.push(toPcm16(interpolated));
      this.sourcePosition += this.sourceSamplesPerTargetSample;
    }

    const bufferedEnd = this.bufferedStart + this.buffered.length;
    const retainedStart = Math.min(Math.floor(this.sourcePosition), bufferedEnd);
    const discardCount = retainedStart - this.bufferedStart;
    if (discardCount > 0) {
      this.buffered = this.buffered.slice(discardCount);
      this.bufferedStart = retainedStart;
    }
    return Int16Array.from(output);
  }

  reset(): void {
    this.buffered = new Float32Array();
    this.bufferedStart = 0;
    this.sourcePosition = 0;
  }
}

export class PcmChunker {
  private readonly samplesPerChunk: number;
  private remainder = new Int16Array();

  constructor(samplesPerChunk: number) {
    if (!Number.isInteger(samplesPerChunk) || samplesPerChunk <= 0) {
      throw new RangeError("Chunk size must be a positive integer.");
    }
    this.samplesPerChunk = samplesPerChunk;
  }

  push(input: Int16Array): Int16Array[] {
    if (!(input instanceof Int16Array)) {
      throw new TypeError("PCM input must be an Int16Array.");
    }
    const combined = new Int16Array(this.remainder.length + input.length);
    combined.set(this.remainder);
    combined.set(input, this.remainder.length);

    const chunks: Int16Array[] = [];
    let offset = 0;
    while (offset + this.samplesPerChunk <= combined.length) {
      chunks.push(combined.slice(offset, offset + this.samplesPerChunk));
      offset += this.samplesPerChunk;
    }
    this.remainder = combined.slice(offset);
    return chunks;
  }

  flush(): Int16Array | null {
    if (this.remainder.length === 0) return null;
    const remainder = this.remainder;
    this.remainder = new Int16Array();
    return remainder;
  }
}
