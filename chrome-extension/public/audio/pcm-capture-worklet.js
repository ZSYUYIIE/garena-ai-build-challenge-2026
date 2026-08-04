class StreamSensePcmCaptureProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.samples = [];
    this.samplesPerPacket = Math.max(1, Math.round(sampleRate / 50));
  }

  process(inputs, outputs) {
    const input = inputs[0] ?? [];
    const frameCount = input.reduce((length, channel) => Math.max(length, channel.length), 0);
    for (let index = 0; index < frameCount; index += 1) {
      let total = 0;
      let channels = 0;
      for (const channel of input) {
        if (index < channel.length) {
          total += channel[index];
          channels += 1;
        }
      }
      this.samples.push(channels === 0 ? 0 : total / channels);
    }
    while (this.samples.length >= this.samplesPerPacket) {
      const packet = new Float32Array(this.samples.splice(0, this.samplesPerPacket));
      this.port.postMessage(packet, [packet.buffer]);
    }
    for (const output of outputs) for (const channel of output) channel.fill(0);
    return true;
  }
}

registerProcessor("streamsense-pcm-capture", StreamSensePcmCaptureProcessor);
