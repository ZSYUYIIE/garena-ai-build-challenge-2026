import assert from "node:assert/strict";
import test from "node:test";

import {
  RealtimeMediaAudio,
  createContextTimeToExtensionSessionMs,
  createMediaSocketProtocol,
} from "../src/sidepanel/realtime/mediaAudio.ts";

function sinePcm(durationMs: number, amplitude: number, frequency: number, sampleRate: number): Int16Array {
  return Int16Array.from(
    { length: (durationMs * sampleRate) / 1_000 },
    (_, index) => Math.round(Math.sin((index * Math.PI * 2 * frequency) / sampleRate) * amplitude * 32_767),
  );
}

function sineFloats(durationMs: number, amplitude: number, frequency: number, sampleRate: number): Float32Array {
  return Float32Array.from(
    { length: (durationMs * sampleRate) / 1_000 },
    (_, index) => Math.sin((index * Math.PI * 2 * frequency) / sampleRate) * amplitude,
  );
}

test("maps scheduled AudioContext time onto the performance session clock", () => {
  const map = createContextTimeToExtensionSessionMs({
    contextTime: 1.25,
    extensionSessionMs: 10_000,
  });

  assert.equal(map(1.5), 10_250);
  assert.equal(map(1), 9_750);
});

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

  removeEventListener(type: string, listener: Listener) {
    this.listeners.set(type, (this.listeners.get(type) ?? []).filter((candidate) => candidate !== listener));
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
  readonly automation: Array<{ method: string; value?: number; time: number }> = [];
  readonly gain: {
    value: number;
    setValueAtTime: (value: number, time: number) => void;
    linearRampToValueAtTime: (value: number, time: number) => void;
    cancelAndHoldAtTime?: (time: number) => void;
    cancelScheduledValues: (time: number) => void;
  } = {
    value: 1,
    setValueAtTime: (value, time) => {
      this.gain.value = value;
      this.automation.push({ method: "set", value, time });
    },
    linearRampToValueAtTime: (value, time) => {
      this.gain.value = value;
      this.automation.push({ method: "ramp", value, time });
    },
    cancelAndHoldAtTime: (time) => this.automation.push({ method: "hold", time }),
    cancelScheduledValues: (time) => this.automation.push({ method: "cancel", time }),
  };
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
  pendingModule = false;
  moduleCalls = 0;
  private releaseModule: (() => void) | null = null;
  resumeResult: Promise<void> = Promise.resolve();
  readonly audioWorklet = {
    addModule: async () => {
      this.moduleCalls += 1;
      if (this.failModule) throw new Error("worklet failed");
      if (this.pendingModule) {
        await new Promise<void>((resolve) => { this.releaseModule = resolve; });
      }
    },
  };
  readonly sampleRate = 48_000;
  get currentTime() { return 1; }
  createGain() { const node = new FakeGain(); this.gains.push(node); return node; }
  createMediaStreamSource() { const node = new FakeNode(); this.sources.push(node); return node; }
  createWorklet() { const node = new FakeWorklet(); this.worklets.push(node); return node; }
  resume() { this.resumeCalls += 1; return this.resumeResult.then(() => { this.state = "running"; }); }
  close() { this.closeCalls += 1; this.state = "closed"; return Promise.resolve(); }
  finishModuleLoad() { this.releaseModule?.(); }
}

function fixture(options: {
  tabAudio?: boolean;
  mic?: "allowed" | "denied" | "pending" | "no-echo";
  pendingModule?: boolean;
  now?: () => number;
} = {}) {
  const context = new FakeAudioContext();
  context.pendingModule = options.pendingModule ?? false;
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
  const discontinuities: number[] = [];
  const tabPacketTimestamps: number[] = [];
  const micPacketTimestamps: number[] = [];
  let videoEnded = false;
  const audio = new RealtimeMediaAudio({
    createAudioContext: () => context as unknown as AudioContext,
    createWorkletNode: () => context.createWorklet() as unknown as AudioWorkletNode,
    getUserMedia: microphone,
    getWorkletUrl: () => "chrome-extension://id/audio/pcm-capture-worklet.js",
    now: options.now ?? (() => 1_000),
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
    discontinuities,
    tabPacketTimestamps,
    micPacketTimestamps,
    videoEnded: () => videoEnded,
    resolveMic: () => resolveMic?.(micStream as unknown as MediaStream),
    tabOptions: {
      tabStream: tabStream as unknown as MediaStream,
      onTabPacket: (packet: Int16Array, timestampMs: number) => {
        tabPackets.push(packet);
        tabPacketTimestamps.push(timestampMs);
      },
      onTabActivity: (active: boolean) => activity.push(active),
      onTabDiscontinuity: (timestampMs: number) => {
        discontinuities.push(timestampMs);
        states.push("tab-discontinuity");
      },
      onVideoEnded: () => { videoEnded = true; },
    },
    micOptions: {
      onMicPacket: (packet: Int16Array, timestampMs: number) => {
        micPackets.push(packet);
        micPacketTimestamps.push(timestampMs);
      },
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

test("cancels held tab-gain automation before every rapid duck and restore ramp", async () => {
  const { media } = await startBoth();
  const gain = media.context.gains[0];
  gain.automation.length = 0;

  media.audio.setTabGain(0.3, 150);
  media.audio.setTabGain(1, 250);
  media.audio.setTabGain(0.3, 150);

  assert.deepEqual(
    gain.automation,
    [
      { method: "hold", time: 1 }, { method: "ramp", value: 0.3, time: 1.15 },
      { method: "hold", time: 1 }, { method: "ramp", value: 1, time: 1.25 },
      { method: "hold", time: 1 }, { method: "ramp", value: 0.3, time: 1.15 },
    ],
  );
});

test("falls back to canceling and pinning the current tab gain before a ramp", async () => {
  const { media } = await startBoth();
  const gain = media.context.gains[0];
  gain.automation.length = 0;
  gain.gain.cancelAndHoldAtTime = undefined;

  media.audio.setTabGain(0.3, 150);

  assert.deepEqual(gain.automation, [
    { method: "cancel", time: 1 },
    { method: "set", value: 1, time: 1 },
    { method: "ramp", value: 0.3, time: 1.15 },
  ]);
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

test("stops a late microphone grant without publishing replacement state", async () => {
  const media = fixture({ mic: "pending" });
  media.audio.prepareForUserGesture();
  const pending = media.audio.startMicrophone(media.micOptions);
  const stateCountBeforeStop = media.states.length;
  await media.audio.stop();
  media.resolveMic();
  assert.equal(await pending, "degraded");
  assert.equal(media.micTrack.stopCalls, 1);
  assert.equal(media.states.length, stateCountBeforeStop);
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

test("observes captured video ending when the tab has no audio", async () => {
  const media = fixture({ tabAudio: false });
  media.audio.prepareForUserGesture();
  assert.equal(await media.audio.startTab(media.tabOptions), "absent");
  await media.audio.waitUntilReady();
  media.tabVideo.end();
  assert.equal(media.videoEnded(), true);
  await media.audio.stop();
  media.tabVideo.end();
  assert.equal(media.videoEnded(), true);
});

test("observes captured video ending after tab worklet setup degrades", async () => {
  const media = fixture();
  media.context.failModule = true;
  media.audio.prepareForUserGesture();
  assert.equal(await media.audio.startTab(media.tabOptions), "degraded");
  media.tabVideo.end();
  assert.equal(media.videoEnded(), true);
  await media.audio.stop();
  media.tabVideo.end();
  assert.equal(media.videoEnded(), true);
});

test("keeps tab playback audible when only its capture worklet fails", async () => {
  const media = fixture();
  media.context.failModule = true;
  media.audio.prepareForUserGesture();
  assert.equal(await media.audio.startTab(media.tabOptions), "degraded");
  assert.equal(media.context.sources[0].destinations.includes(media.context.gains[0]), true);
  assert.equal(media.context.gains[0].destinations.includes(media.context.destination), true);
  await media.audio.stop();
  assert.equal(media.context.sources[0].disconnectCalls, 1);
  assert.equal(media.context.gains[0].disconnectCalls, 1);
});

test("does not create a tab capture branch after stop during worklet loading", async () => {
  const media = fixture({ pendingModule: true });
  media.audio.prepareForUserGesture();
  const starting = media.audio.startTab(media.tabOptions);
  while (media.context.moduleCalls === 0) await Promise.resolve();
  await media.audio.stop();
  media.context.finishModuleLoad();
  assert.equal(await starting, "degraded");
  assert.equal(media.context.worklets.length, 0);
  assert.equal(media.tabAudio.stopCalls, 1);
});

test("does not create a microphone branch after stop during worklet loading", async () => {
  const media = fixture({ pendingModule: true });
  media.audio.prepareForUserGesture();
  const starting = media.audio.startMicrophone(media.micOptions);
  await Promise.resolve();
  await Promise.resolve();
  await media.audio.stop();
  media.context.finishModuleLoad();
  assert.equal(await starting, "degraded");
  assert.equal(media.context.worklets.length, 0);
  assert.equal(media.micTrack.stopCalls, 1);
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

test("opens and closes a microphone turn from production-sized worklet blocks", async () => {
  let nowMs = 1_000;
  const media = fixture({ now: () => nowMs });
  await startBoth(media);
  const microphone = sineFloats(300, 0.32, 220, 48_000);
  for (let offset = 0; offset < microphone.length; offset += 960) {
    media.context.worklets[1].emit(microphone.slice(offset, offset + 960));
    nowMs += 20;
  }
  for (let index = 0; index < 30; index += 1) {
    media.context.worklets[1].emit(new Float32Array(960));
    nowMs += 20;
  }

  assert.deepEqual(media.userEvents, ["start", "end"]);
  assert.ok(media.micPackets.length > 0);
});

test("feeds scheduled model playback into live mic echo rejection without blocking independent speech", async () => {
  const referencePcm = sinePcm(800, 0.2, 310, 48_000);
  const leakage = sineFloats(300, 0.09, 310, 48_000);
  let echoNowMs = 1_080;
  const echo = fixture({ now: () => echoNowMs });
  await startBoth(echo);
  echo.audio.pushPlaybackReference({
    source: "model",
    pcm: referencePcm,
    sampleRate: 48_000,
    firstSampleExtensionSessionMs: 1_000,
  });
  for (let offset = 0; offset < leakage.length; offset += 960) {
    echo.context.worklets[1].emit(leakage.slice(offset, offset + 960));
    echoNowMs += 20;
  }
  assert.deepEqual(echo.userEvents, []);

  let speechNowMs = 1_080;
  const speech = fixture({ now: () => speechNowMs });
  await startBoth(speech);
  speech.audio.pushPlaybackReference({
    source: "model",
    pcm: referencePcm,
    sampleRate: 48_000,
    firstSampleExtensionSessionMs: 1_000,
  });
  const user = sineFloats(300, 0.42, 760, 48_000);
  const mixed = Float32Array.from(leakage, (sample, index) => sample + user[index]);
  for (let offset = 0; offset < mixed.length; offset += 960) {
    speech.context.worklets[1].emit(mixed.slice(offset, offset + 960));
    speechNowMs += 20;
  }
  assert.deepEqual(speech.userEvents, ["start"]);
});

test("reports first-sample timestamps from sample-duration cursors", async () => {
  const { media } = await startBoth();
  media.context.worklets[0].emit(new Float32Array(9_600).fill(0.2));
  assert.deepEqual(media.tabPacketTimestamps, [1_000, 1_100]);
  media.context.worklets[1].emit(sineFloats(200, 0.6, 220, 48_000));
  assert.deepEqual(media.micPacketTimestamps.slice(0, 2), [800, 840]);
});

test("anchors a tab packet timestamp at the first worklet block before chunk buffering", async () => {
  let now = 0;
  const media = fixture({ now: () => now });
  media.audio.prepareForUserGesture();
  await media.audio.startTab(media.tabOptions);
  for (let index = 0; index < 5; index += 1) {
    now = index * 20;
    media.context.worklets[0].emit(new Float32Array(960).fill(0.2));
  }
  assert.deepEqual(media.tabPacketTimestamps, [0]);
});

test("degrades only the branch whose track ends and reports tab discontinuity", async () => {
  const { media } = await startBoth();
  media.micTrack.end();
  assert.equal(media.states.at(-1), "captured/degraded");
  media.tabAudio.end();
  assert.ok(media.states.includes("degraded/degraded"));
  assert.ok(media.states.includes("tab-discontinuity"));
  assert.deepEqual(media.discontinuities, [1_000]);
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

test("sends a complete protocol-v2 hello before all session media commands", () => {
  const sent: (string | ArrayBuffer)[] = [];
  const protocol = createMediaSocketProtocol((value) => sent.push(value), () => "123e4567-e89b-42d3-a456-426614174000");
  protocol.open({ tabAudioState: "captured", microphoneState: "pending" });
  protocol.sendMediaState({ tabAudioState: "captured", microphoneState: "ready" });
  protocol.sendTabActivity(true);
  assert.deepEqual(
    sent.map((value) => typeof value === "string" ? JSON.parse(value) : value),
    [
      { type: "session_hello", protocolVersion: 2, tabAudioState: "captured", microphoneState: "pending" },
      { type: "media_state", tabAudioState: "captured", microphoneState: "ready" },
      { type: "tab_audio_activity", active: true },
    ],
  );
});

test("brackets only one microphone turn and retains sequence after a failed send", () => {
  const sent: (string | ArrayBuffer)[] = [];
  let failNext = true;
  const protocol = createMediaSocketProtocol((value) => {
    if (value instanceof ArrayBuffer && failNext) {
      failNext = false;
      throw new Error("socket closed");
    }
    sent.push(value);
  }, () => "123e4567-e89b-42d3-a456-426614174000");
  protocol.open({ tabAudioState: "captured", microphoneState: "ready" });
  const turnId = protocol.startUserActivity();
  assert.equal(turnId, "123e4567-e89b-42d3-a456-426614174000");
  assert.throws(() => protocol.sendMicrophone(new Int16Array([1, 2]), 800), /socket closed/);
  protocol.sendMicrophone(new Int16Array([3, 4]), 840);
  protocol.endUserActivity();
  assert.equal(protocol.sendMicrophone(new Int16Array([5, 6]), 880), false);
  const start = JSON.parse(sent[1] as string);
  const packet = sent[2] as ArrayBuffer;
  const end = JSON.parse(sent[3] as string);
  assert.deepEqual(start, { type: "user_activity_start", turnId });
  assert.equal(new DataView(packet).getUint32(2, true), 0);
  assert.equal(new DataView(packet).getUint32(6, true), 840);
  assert.deepEqual(end, { type: "user_activity_end", turnId });
});

test("terminally ends one microphone activity and permits a later fresh activity", () => {
  const sent: (string | ArrayBuffer)[] = [];
  const protocol = createMediaSocketProtocol((value) => sent.push(value), () => "123e4567-e89b-42d3-a456-426614174000");
  protocol.open({ tabAudioState: "captured", microphoneState: "ready" });
  assert.equal(protocol.startUserActivity(), "123e4567-e89b-42d3-a456-426614174000");
  assert.equal(protocol.cancelUserActivity(), "123e4567-e89b-42d3-a456-426614174000");
  assert.equal(protocol.sendMicrophone(new Int16Array([1, 2]), 0), false);
  assert.equal(protocol.startUserActivity(), "123e4567-e89b-42d3-a456-426614174000");
  assert.equal(JSON.parse(sent.filter((value): value is string => typeof value === "string").at(-2)!).type, "user_activity_end");
});

test("sends tab activity and track-ended discontinuity as distinct commands", () => {
  const sent: string[] = [];
  const protocol = createMediaSocketProtocol((value) => sent.push(value as string), crypto.randomUUID);
  protocol.open({ tabAudioState: "captured", microphoneState: "ready" });
  protocol.sendTabActivity(false);
  protocol.sendTabDiscontinuity(1_234);
  assert.deepEqual(sent.slice(1).map(JSON.parse), [
    { type: "tab_audio_activity", active: false },
    { type: "tab_audio_discontinuity", timestampMs: 1_234, reason: "track_ended" },
  ]);
});
