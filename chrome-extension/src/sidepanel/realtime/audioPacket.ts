export const AUDIO_PACKET_VERSION = 1;
export const AUDIO_PACKET_HEADER_BYTES = 10;
export const MAX_MIC_PCM_BYTES = 1_280;
export const MAX_TAB_PCM_BYTES = 3_200;

export type AudioSource = "microphone" | "tab";

const SOURCE_KINDS: Record<AudioSource, number> = {
  microphone: 1,
  tab: 2,
};

function assertUint32(value: number, label: string): void {
  if (!Number.isInteger(value) || value < 0 || value > 0xffff_ffff) {
    throw new RangeError(`${label} must be an unsigned 32-bit integer.`);
  }
}

export function encodeAudioPacket(
  source: AudioSource,
  sequence: number,
  timestampMs: number,
  pcm: Int16Array,
): ArrayBuffer {
  if (source !== "microphone" && source !== "tab") {
    throw new RangeError("Audio source is invalid.");
  }
  assertUint32(sequence, "Audio sequence");
  assertUint32(timestampMs, "Audio timestamp");
  if (!(pcm instanceof Int16Array) || pcm.byteLength === 0) {
    throw new TypeError("Audio PCM must be a non-empty Int16Array.");
  }

  const maxBytes = source === "microphone" ? MAX_MIC_PCM_BYTES : MAX_TAB_PCM_BYTES;
  if (pcm.byteLength > maxBytes) {
    throw new RangeError("Audio PCM payload is too large.");
  }

  const encoded = new ArrayBuffer(AUDIO_PACKET_HEADER_BYTES + pcm.byteLength);
  const bytes = new Uint8Array(encoded);
  const view = new DataView(encoded);
  bytes[0] = AUDIO_PACKET_VERSION;
  bytes[1] = SOURCE_KINDS[source];
  view.setUint32(2, sequence, true);
  view.setUint32(6, timestampMs, true);
  bytes.set(new Uint8Array(pcm.buffer, pcm.byteOffset, pcm.byteLength), AUDIO_PACKET_HEADER_BYTES);
  return encoded;
}
