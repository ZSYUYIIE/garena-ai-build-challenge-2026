import assert from "node:assert/strict";
import test from "node:test";

import { RealtimeMediaAudio } from "../src/sidepanel/realtime/mediaAudio.ts";

type Listener = () => void;

class FakeTrack {
  readonly listeners = new Map<string, Listener[]>();
  stopCalls = 0;
  readonly kind: "audio" | "video";
  private readonly settings: MediaTrackSettings;

  constructor(
    kind: "audio" | "video",
    settings: MediaTrackSettings = {},
  ) {
    this.kind = kind;
    this.settings = settings;
  }

  getSettings() {
    return this.settings;
  }

  addEventListener(type: string, listener: Listener) {
    this.listeners.set(type, [...(this.listeners.get(type) ?? []), listener]);
  }

  stop() {
    this.stopCalls += 1;
  }

  end() {
    for (const listener of this.listeners.get("ended") ?? []) listener();
  }
}

class FakeStream {
  readonly tracks: FakeTrack[];
  constructor(tracks: FakeTrack[]) { this.tracks = tracks; }
  getTracks() { return this.tracks; }
  getAudioTracks() { return this.tracks.filter((track) => track.kind === "audio"); }
  getVideoTracks() { return this.tracks.filter((track) => track.kind === "video"); }
}

class FakeNode {
  readonly destinations: FakeNode[] = [];
  disconnectCalls = 0;
  connect(destination: FakeNode) { this.destinations.push(destination); return destination; }
  disconnect() { this.disconnectCalls += 1; this.destinations.length = 0; }
}

class FakeGain extends FakeNode {
  readonly gain = { value: 1, setValueAtTime: (value: number) => { this.gain.value = value; }, linearRampToValueAtTime: (value: number) => { this.gain.value = value; } };
}

class FakeWorklet extends FakeNode {
  readonly port: {
    closeCalls: number;
    onmessage: ((event: MessageEvent<Float32Array>) => void) | null;
    close: () => void;
  } = {
    closeCalls: 0,
    onmessage: null,
    close: () => { this.port.closeCalls += 1; },
  };
  emit(samples: Float32Array) { this.port.onmessage?.({ data: samples } as MessageEvent<Float32Array>); }
}

class FakeAudioContext {
  state: AudioContextState = "suspended";
  readonly destination = new FakeNode();
  readonly worklets: FakeWorklet[] = [];
  readonly gains: FakeGain[] = [];
  readonly sources: FakeNode[] = [];
  resumeCalls = 0;
  closeCalls = 0;
  failModule = false;
  resumeResult: Promise<void> = Promise.resolve();
  readonly audioWorklet = { addModule: async () => { if (this.failModule) throw new Error("worklet failed"); } };
  readonly sampleRate = 48_000;
  get currentTime() { return 1; }
  createGain() { const node = new FakeGain(); this.gains.push(node); return node; }
  createMediaStreamSource() { const node = new FakeNode(); this.sources.push(node); return node; }
  createWorklet() { const node = new FakeWorklet(); this.worklets.push(node); return node; }
  resume() { this.resumeCalls += 1; return this.resumeResult.then(() => { this.state = "running"; }); }
  close() { this.closeCalls += 1; this.state = "closed"; return Promise.resolve(); }
}

function fixture(options: {
  tabAudio?: boolean;
  mic?: "allowed" | "denied" | "pending" | "no-echo";
} = {}) {
  const context = new FakeAudioContext();
  const tabAudio = new FakeTrack("audio");
  const tabVideo = new FakeTrack("video");
  const tabStream = new FakeStream(options.tabAudio === false ? [tabVideo] : [tabAudio, tabVideo]);
  const micTrack = new FakeTrack("audio", { echoCancellation: options.mic !== "no-echo" });
  const micStream = new FakeStream([micTrack]);
  let resolveMic: ((stream: MediaStream) => void) | null = null;
  const microphone = options.mic === "denied"
    ? () => Promise.reject(new DOMException("Denied", "NotAllowedError"))
    : options.mic === "pending"
      ? () => new Promise<MediaStream>((resolve) => { resolveMic = resolve; })
      : () => Promise.resolve(micStream as unknown as MediaStream);
  const tabPackets: Int16Array[] = [];
  const micPackets: Int16Array[] = [];
  const activity: boolean[] = [];
  const userEvents: string[] = [];
  const states: string[] = [];
  let videoEnded = false;
  const audio = new RealtimeMediaAudio({
    createAudioContext: () => context as unknown as AudioContext,
    createWorkletNode: () => context.createWorklet() as unknown as AudioWorkletNode,
    getUserMedia: microphone,
    getWorkletUrl: () => "chrome-extension://id/audio/pcm-capture-worklet.js",
    now: () => 1_000,
    onStateChange: (state) => states.push(`${state.tabAudioState}/${state.microphoneState}`),
  });
  return {
    audio,
    context,
    tabAudio,
    tabVideo,
    tabStream,
    micTrack,
    tabPackets,
    micPackets,
    activity,
    userEvents,
    states,
    videoEnded: () => videoEnded,
    resolveMic: () => resolveMic?.(micStream as unknown as MediaStream),
    tabOptions: {
      tabStream: tabStream as unknown as MediaStream,
      onTabPacket: (packet: Int16Array) => tabPackets.push(packet),
      onTabActivity: (active: boolean) => activity.push(active),
      onTabDiscontinuity: () => states.push("tab-discontinuity"),
      onVideoEnded: () => { videoEnded = true; },
    },
    micOptions: {
      onMicPacket: (packet: Int16Array) => micPackets.push(packet),
      onUserActivityStart: () => userEvents.push("start"),
      onUserActivityEnd: () => userEvents.push("end"),
      tabReference: null,
      modelReference: null,
    },
  };
}

async function startBoth(media = fixture()) {
  media.audio.prepareForUserGesture();
  const tab = await media.audio.startTab(media.tabOptions);
  const mic = await media.audio.startMicrophone(media.micOptions);
  return { media, tab, mic };
}

test("routes tab audio to full-volume playback and a separate STT callback", async () => {
  const { media, tab, mic } = await startBoth();
  assert.deepEqual({ tab, mic }, { tab: "captured", mic: "ready" });
  assert.equal(media.context.gains[0].gain.value, 1);
  assert.equal(media.context.sources[0].destinations.includes(media.context.gains[0]), true);
  assert.equal(media.context.sources[0].destinations.includes(media.context.worklets[0]), true);
});

test("does not make microphone PCM audible or route tab PCM to the mic callback", async () => {
  const { media } = await startBoth();
  media.context.worklets[0].emit(new Float32Array(4_800).fill(0.2));
  assert.equal(media.micPackets.length, 0);
  assert.ok(media.tabPackets.length > 0);
  assert.equal(media.context.sources[1].destinations.includes(media.context.destination), false);
  assert.equal(media.context.gains[2].gain.value, 0);
});

test("starts microphone permission without waiting for it to settle", async () => {
  const media = fixture({ mic: "pending" });
  media.audio.prepareForUserGesture();
  const pendingMic = media.audio.startMicrophone(media.micOptions);
  assert.deepEqual(media.states.at(-1), "absent/pending");
  assert.equal(await media.audio.startTab(media.tabOptions), "captured");
  media.context.worklets[0].emit(new Float32Array(4_800).fill(0.2));
  assert.ok(media.tabPackets.length > 0);
  media.resolveMic();
  assert.equal(await pendingMic, "ready");
});

test("keeps tab capture when microphone permission is denied", async () => {
  const media = fixture({ mic: "denied" });
  media.audio.prepareForUserGesture();
  assert.equal(await media.audio.startTab(media.tabOptions), "captured");
  assert.equal(await media.audio.startMicrophone(media.micOptions), "denied");
  assert.equal(media.tabAudio.stopCalls, 0);
  assert.equal(media.states.at(-1), "captured/denied");
});

test("stops captured tracks when context cannot become running", async () => {
  const media = fixture();
  media.context.resumeResult = Promise.reject(new Error("blocked"));
  media.audio.prepareForUserGesture();
  await assert.rejects(media.audio.startTab(media.tabOptions), /Local audio could not start/);
  assert.equal(media.tabAudio.stopCalls, 1);
  assert.equal(media.tabVideo.stopCalls, 1);
});

test("distinguishes initially absent tab audio from a failed present worklet", async () => {
  const absent = fixture({ tabAudio: false });
  absent.audio.prepareForUserGesture();
  assert.equal(await absent.audio.startTab(absent.tabOptions), "absent");
  const failed = fixture();
  failed.context.failModule = true;
  failed.audio.prepareForUserGesture();
  assert.equal(await failed.audio.startTab(failed.tabOptions), "degraded");
});

test("disarms VAD when echo cancellation is not confirmed", async () => {
  const media = fixture({ mic: "no-echo" });
  media.audio.prepareForUserGesture();
  assert.equal(await media.audio.startMicrophone(media.micOptions), "degraded");
  assert.equal(media.context.worklets.length, 0);
});

test("keeps worklets pulled through separate silent monitors", async () => {
  const { media } = await startBoth();
  assert.equal(media.context.worklets[0].destinations[0], media.context.gains[1]);
  assert.equal(media.context.worklets[1].destinations[0], media.context.gains[2]);
  assert.equal(media.context.gains[1].gain.value, 0);
  assert.equal(media.context.gains[2].gain.value, 0);
  assert.equal(media.context.gains[1].destinations[0], media.context.destination);
  assert.equal(media.context.gains[2].destinations[0], media.context.destination);
});

test("suppresses mic VAD while disabled and restarts it from a reset detector", async () => {
  const { media } = await startBoth();
  media.audio.setUserActivityEnabled(false);
  media.context.worklets[1].emit(new Float32Array(9_600).fill(0.6));
  assert.deepEqual(media.userEvents, []);
  assert.deepEqual(media.micPackets, []);
  media.audio.setUserActivityEnabled(true);
  media.context.worklets[1].emit(new Float32Array(9_600).fill(0.6));
  assert.deepEqual(media.userEvents, ["start"]);
  assert.ok(media.micPackets.length > 0);
});

test("degrades only the branch whose track ends and reports tab discontinuity", async () => {
  const { media } = await startBoth();
  media.micTrack.end();
  assert.equal(media.states.at(-1), "captured/degraded");
  media.tabAudio.end();
  assert.ok(media.states.includes("degraded/degraded"));
  assert.ok(media.states.includes("tab-discontinuity"));
  assert.equal(media.tabVideo.stopCalls, 0);
});

test("notifies the owner when the captured video track ends", async () => {
  const { media } = await startBoth();
  media.tabVideo.end();
  assert.equal(media.videoEnded(), true);
});

test("stops all tracks and graph nodes exactly once across repeated cleanup", async () => {
  const { media } = await startBoth();
  await media.audio.stop();
  await media.audio.stop();
  for (const track of [media.tabAudio, media.tabVideo, media.micTrack]) assert.equal(track.stopCalls, 1);
  for (const node of [...media.context.sources, ...media.context.gains, ...media.context.worklets]) assert.equal(node.disconnectCalls, 1);
  for (const worklet of media.context.worklets) assert.equal(worklet.port.closeCalls, 1);
  assert.equal(media.context.closeCalls, 1);
});

test("worklet downmixes all channels, preserves render-quantum continuity, and posts at a bounded rate", async () => {
  const globals = globalThis as Record<string, unknown>;
  const previousProcessor = globals.AudioWorkletProcessor;
  const previousRegister = globals.registerProcessor;
  const previousSampleRate = globals.sampleRate;
  const packets: Float32Array[] = [];
  let Processor: (new () => { process: (inputs: Float32Array[][], outputs: Float32Array[][]) => boolean }) | null = null;
  class ProcessorBase {
    readonly port = { postMessage: (packet: Float32Array) => packets.push(packet) };
  }
  globals.AudioWorkletProcessor = ProcessorBase;
  globals.sampleRate = 48_000;
  globals.registerProcessor = (_name: string, processor: typeof Processor) => { Processor = processor; };
  try {
    await import(`../public/audio/pcm-capture-worklet.js?test=${Date.now()}`);
    assert.ok(Processor);
    const processor = new Processor!();
    const output = [new Float32Array(128).fill(1)];
    for (let index = 0; index < 8; index += 1) {
      assert.equal(
        processor.process(
          [[new Float32Array(128), new Float32Array(128).fill(0.6)]],
          [output],
        ),
        true,
      );
    }
    assert.equal(packets.length, 1);
    assert.equal(packets[0].length, 960);
    assert.ok(Math.abs(packets[0][0] - 0.3) < 0.000_001);
    assert.ok(output[0].every((sample) => sample === 0));
    for (let index = 0; index < 16; index += 1) {
      processor.process([[new Float32Array(128)]], [output]);
    }
    assert.equal(packets.length, 3);
  } finally {
    globals.AudioWorkletProcessor = previousProcessor;
    globals.registerProcessor = previousRegister;
    globals.sampleRate = previousSampleRate;
  }
});
