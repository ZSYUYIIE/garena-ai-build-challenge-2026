export const AUDIO_PACKET_VERSION = 1;
export const AUDIO_PACKET_HEADER_BYTES = 10;
export const MAX_MIC_PCM_BYTES = 1_280;
export const MAX_TAB_PCM_BYTES = 3_200;

const SOURCES = Object.freeze({
  1: "microphone",
  2: "tab",
});

function maxPayloadBytes(source) {
  return source === "microphone" ? MAX_MIC_PCM_BYTES : MAX_TAB_PCM_BYTES;
}

export class AudioSequenceGuard {
  constructor() {
    this.lastSequences = new Map();
  }

  accept(source, sequence) {
    const previous = this.lastSequences.get(source);
    if (previous !== undefined && sequence !== (previous + 1) >>> 0) {
      return false;
    }
    this.lastSequences.set(source, sequence);
    return true;
  }

  reset() {
    this.lastSequences.clear();
  }
}

export function parseAudioPacket(raw, guard) {
  if (!Buffer.isBuffer(raw) || raw.length < AUDIO_PACKET_HEADER_BYTES) {
    throw new TypeError("Audio packet header is invalid.");
  }
  if (raw[0] !== AUDIO_PACKET_VERSION) {
    throw new RangeError("Audio packet version is unsupported.");
  }

  const source = SOURCES[raw[1]];
  if (!source) throw new RangeError("Audio packet source is invalid.");

  const pcmLength = raw.length - AUDIO_PACKET_HEADER_BYTES;
  if (pcmLength === 0 || pcmLength % 2 !== 0) {
    throw new RangeError("Audio packet PCM payload must have an even byte length.");
  }
  if (pcmLength > maxPayloadBytes(source)) {
    throw new RangeError("Audio packet PCM payload is too large.");
  }

  const sequence = raw.readUInt32LE(2);
  if (!guard?.accept(source, sequence)) {
    throw new RangeError("Audio packet sequence is not monotonic.");
  }

  return {
    source,
    sequence,
    timestampMs: raw.readUInt32LE(6),
    pcm: Buffer.from(raw.subarray(AUDIO_PACKET_HEADER_BYTES)),
  };
}
