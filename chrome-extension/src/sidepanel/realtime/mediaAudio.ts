import { PcmChunker, StreamingPcm16Resampler } from "./audioPcm.ts";
import { encodeAudioPacket } from "./audioPacket.ts";
import {
  EchoAwareUserVadGate,
  TabActivityGate,
  type PlaybackReference,
} from "./voiceActivity.ts";

export type TabAudioState = "absent" | "captured" | "degraded";
export type MicrophoneState = "pending" | "ready" | "denied" | "degraded";

export type RealtimeMediaState = {
  tabAudioState: TabAudioState;
  microphoneState: MicrophoneState;
};

export function createContextTimeToExtensionSessionMs(origin: {
  contextTime: number;
  extensionSessionMs: number;
}): (contextTime: number) => number {
  return (contextTime) => Math.max(
    0,
    Math.round(origin.extensionSessionMs + (contextTime - origin.contextTime) * 1_000),
  );
}

type TabOptions = {
  tabStream: MediaStream;
  onTabPacket: (packet: Int16Array, firstSampleTimestampMs: number) => void;
  onTabActivity: (active: boolean) => void;
  onTabDiscontinuity: (timestampMs: number) => void;
  onVideoEnded?: () => void;
};

type MicrophoneOptions = {
  onMicPacket: (packet: Int16Array, firstSampleTimestampMs: number) => void;
  onUserActivityStart: () => void;
  onUserActivityEnd: () => void;
  tabReference: PlaybackReference | null;
  modelReference: PlaybackReference | null;
};

type GraphNode = { connect(destination: AudioNode): unknown; disconnect(): void };
type WorkletNode = GraphNode & {
  port: { onmessage: ((event: MessageEvent<Float32Array>) => void) | null; close?: () => void };
};

type Dependencies = {
  createAudioContext?: () => AudioContext;
  createWorkletNode?: (context: AudioContext) => AudioWorkletNode;
  getUserMedia?: (constraints: MediaStreamConstraints) => Promise<MediaStream>;
  getWorkletUrl?: () => string;
  now?: () => number;
  onStateChange?: (state: RealtimeMediaState) => void;
};

type Branch = {
  nodes: GraphNode[];
  captureNodes?: GraphNode[];
  worklet?: WorkletNode;
};

const WORKLET_NAME = "streamsense-pcm-capture";
const STARTUP_AUDIO_TIMEOUT_MS = 1_000;
const PCM_SAMPLE_RATE = 16_000;

type SocketSender = (value: string | ArrayBuffer) => void;

export function createMediaSocketProtocol(
  send: SocketSender,
  createTurnId: () => string,
) {
  let opened = false;
  let tabSequence = 0;
  let microphoneSequence = 0;
  let activeTurnId: string | null = null;

  const sendJson = (value: object) => send(JSON.stringify(value));
  const sendPacket = (
    source: "tab" | "microphone",
    pcm: Int16Array,
    timestampMs: number,
  ) => {
    const sequence = source === "tab" ? tabSequence : microphoneSequence;
    const packet = encodeAudioPacket(source === "tab" ? "tab" : "microphone", sequence, timestampMs, pcm);
    send(packet);
    if (source === "tab") tabSequence = (sequence + 1) >>> 0;
    else microphoneSequence = (sequence + 1) >>> 0;
    return true;
  };

  return {
    open(state: RealtimeMediaState) {
      if (opened) return;
      sendJson({ type: "session_hello", protocolVersion: 2, ...state });
      opened = true;
    },
    close() {
      opened = false;
      activeTurnId = null;
    },
    sendMediaState(state: RealtimeMediaState) {
      if (!opened) return false;
      sendJson({ type: "media_state", ...state });
      return true;
    },
    sendTabActivity(active: boolean) {
      if (!opened) return false;
      sendJson({ type: "tab_audio_activity", active });
      return true;
    },
    sendTabDiscontinuity(timestampMs: number) {
      if (!opened) return false;
      sendJson({ type: "tab_audio_discontinuity", timestampMs, reason: "track_ended" });
      return true;
    },
    sendTab(pcm: Int16Array, timestampMs: number) {
      if (!opened) return false;
      return sendPacket("tab", pcm, timestampMs);
    },
    startUserActivity() {
      if (!opened || activeTurnId) return null;
      const turnId = createTurnId();
      sendJson({ type: "user_activity_start", turnId });
      activeTurnId = turnId;
      return turnId;
    },
    sendMicrophone(pcm: Int16Array, timestampMs: number) {
      if (!opened || !activeTurnId) return false;
      return sendPacket("microphone", pcm, timestampMs);
    },
    endUserActivity() {
      if (!opened || !activeTurnId) return false;
      const turnId = activeTurnId;
      sendJson({ type: "user_activity_end", turnId });
      activeTurnId = null;
      return true;
    },
    cancelUserActivity() {
      if (!opened || !activeTurnId) return null;
      const turnId = activeTurnId;
      sendJson({ type: "user_activity_end", turnId });
      activeTurnId = null;
      return turnId;
    },
  };
}

export class RealtimeMediaAudio {
  private readonly dependencies: Required<Dependencies>;
  private audioContext: AudioContext | null = null;
  private ready: Promise<void> | null = null;
  private state: RealtimeMediaState = { tabAudioState: "absent", microphoneState: "pending" };
  private tabBranch: Branch | null = null;
  private micBranch: Branch | null = null;
  private tabStream: MediaStream | null = null;
  private micStream: MediaStream | null = null;
  private stoppedTracks = new Set<MediaStreamTrack>();
  private disconnectedNodes = new Set<GraphNode>();
  private closedPorts = new Set<WorkletNode>();
  private stopped = false;
  private userActivityEnabled = true;
  private micActivityOpen = false;
  private tabOptions: TabOptions | null = null;
  private micOptions: MicrophoneOptions | null = null;
  private tabResampler: StreamingPcm16Resampler | null = null;
  private micResampler: StreamingPcm16Resampler | null = null;
  private tabChunker: PcmChunker | null = null;
  private micChunker: PcmChunker | null = null;
  private tabNextPacketTimestampMs: number | null = null;
  private micNextPacketTimestampMs: number | null = null;
  private tabVideoTrack: MediaStreamTrack | null = null;
  private tabVideoEndedHandler: (() => void) | null = null;
  private readonly tabActivity = new TabActivityGate();
  private readonly userVad = new EchoAwareUserVadGate();

  constructor(dependencies: Dependencies = {}) {
    this.dependencies = {
      createAudioContext: dependencies.createAudioContext ?? (() => new AudioContext()),
      createWorkletNode: dependencies.createWorkletNode ?? ((context) => new AudioWorkletNode(context, WORKLET_NAME)),
      getUserMedia: dependencies.getUserMedia ?? ((constraints) => navigator.mediaDevices.getUserMedia(constraints)),
      getWorkletUrl: dependencies.getWorkletUrl ?? (() => chrome.runtime.getURL("audio/pcm-capture-worklet.js")),
      now: dependencies.now ?? (() => performance.now()),
      onStateChange: dependencies.onStateChange ?? (() => undefined),
    };
    this.publishState();
  }

  prepareForUserGesture(): { audioContext: AudioContext; ready: Promise<void> } {
    if (!this.audioContext || this.audioContext.state === "closed") {
      this.audioContext = this.dependencies.createAudioContext();
      this.ready = this.audioContext.resume().then(() => {
        if (this.audioContext?.state !== "running") {
          throw new Error("AudioContext did not enter the running state.");
        }
      });
    }
    return { audioContext: this.audioContext, ready: this.ready! };
  }

  async waitUntilReady(timeoutMs = STARTUP_AUDIO_TIMEOUT_MS): Promise<AudioContext> {
    const prepared = this.prepareForUserGesture();
    await withTimeout(prepared.ready, timeoutMs);
    if (prepared.audioContext.state !== "running") {
      throw new Error("AudioContext did not enter the running state.");
    }
    return prepared.audioContext;
  }

  async startTab(options: TabOptions): Promise<TabAudioState> {
    this.tabOptions = options;
    this.tabStream = options.tabStream;
    this.installVideoEndedListener(options);
    const audioTrack = options.tabStream.getAudioTracks()[0];
    if (!audioTrack) {
      this.setState({ tabAudioState: "absent" });
      return "absent";
    }

    let context: AudioContext;
    try {
      context = await this.waitUntilReady();
    } catch {
      this.stopTracks(options.tabStream);
      throw new Error("Local audio could not start.");
    }
    if (this.stopped) {
      this.stopTracks(options.tabStream);
      return "degraded";
    }

    let source: GraphNode;
    let gain: GraphNode & { gain: AudioParam };
    try {
      source = context.createMediaStreamSource(options.tabStream) as unknown as GraphNode;
      gain = context.createGain() as unknown as GraphNode & { gain: AudioParam };
      gain.gain.setValueAtTime(1, context.currentTime);
      source.connect(gain as unknown as AudioNode);
      gain.connect(context.destination);
      this.tabBranch = { nodes: [source, gain], captureNodes: [] };
    } catch {
      this.stopTracks(options.tabStream);
      throw new Error("Local audio could not start.");
    }

    try {
      await context.audioWorklet.addModule(this.dependencies.getWorkletUrl());
      if (this.stopped) return "degraded";
      const worklet = this.dependencies.createWorkletNode(context) as unknown as WorkletNode;
      this.tabBranch.nodes.push(worklet);
      this.tabBranch.captureNodes?.push(worklet);
      this.tabBranch.worklet = worklet;
      const monitor = context.createGain() as unknown as GraphNode & { gain: AudioParam };
      monitor.gain.setValueAtTime(0, context.currentTime);
      this.tabBranch.nodes.push(monitor);
      this.tabBranch.captureNodes?.push(monitor);
      source.connect(worklet as unknown as AudioNode);
      worklet.connect(monitor as unknown as AudioNode);
      monitor.connect(context.destination);
      this.tabResampler = new StreamingPcm16Resampler(context.sampleRate);
      this.tabChunker = new PcmChunker(1_600);
      worklet.port.onmessage = (event) => this.handleTabSamples(event.data);
      audioTrack.addEventListener("ended", () => this.degradeTab(), { once: true });
      this.setState({ tabAudioState: "captured" });
      return "captured";
    } catch {
      if (this.stopped) return "degraded";
      this.closeCaptureNodes(this.tabBranch);
      this.setState({ tabAudioState: "degraded" });
      return "degraded";
    }
  }

  startMicrophone(options: MicrophoneOptions): Promise<MicrophoneState> {
    this.micOptions = options;
    if (options.tabReference) this.userVad.pushReference(options.tabReference);
    if (options.modelReference) this.userVad.pushReference(options.modelReference);
    const microphonePromise = this.dependencies.getUserMedia({
      audio: {
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
        channelCount: 1,
      },
    });
    return microphonePromise.then(
      async (stream) => this.installMicrophone(stream),
      (cause) => {
        if (isPermissionDenied(cause)) {
          this.setState({ microphoneState: "denied" });
          return "denied";
        }
        this.setState({ microphoneState: "degraded" });
        return "degraded";
      },
    );
  }

  setUserActivityEnabled(enabled: boolean): void {
    this.userActivityEnabled = enabled;
    this.micActivityOpen = false;
    this.micChunker = this.audioContext ? new PcmChunker(640) : null;
    this.micNextPacketTimestampMs = null;
    this.userVad.reset();
  }

  pushPlaybackReference(reference: PlaybackReference): void {
    if (this.stopped) return;
    this.userVad.pushReference(reference);
  }

  setTabGain(gain: 0.3 | 1, fadeMs: number): void {
    const node = this.tabBranch?.nodes[1] as (GraphNode & { gain?: AudioParam }) | undefined;
    const context = this.audioContext;
    if (!node?.gain || !context) return;
    const audioParam = node.gain;
    const now = context.currentTime;
    try {
      audioParam.cancelAndHoldAtTime(now);
    } catch {
      audioParam.cancelScheduledValues(now);
      audioParam.setValueAtTime(audioParam.value, now);
    }
    audioParam.linearRampToValueAtTime(gain, now + Math.max(0, fadeMs) / 1_000);
  }

  async stop(): Promise<void> {
    if (this.stopped) return;
    this.stopped = true;
    this.closeBranch(this.tabBranch);
    this.closeBranch(this.micBranch);
    this.stopTracks(this.tabStream);
    this.stopTracks(this.micStream);
    this.removeVideoEndedListener();
    this.tabBranch = null;
    this.micBranch = null;
    this.tabStream = null;
    this.micStream = null;
    if (this.audioContext && this.audioContext.state !== "closed") await this.audioContext.close();
  }

  private async installMicrophone(stream: MediaStream): Promise<MicrophoneState> {
    if (this.stopped) {
      this.stopTracks(stream);
      return "degraded";
    }
    this.micStream = stream;
    const audioTrack = stream.getAudioTracks()[0];
    if (!audioTrack || audioTrack.getSettings().echoCancellation !== true) {
      this.stopTracks(stream);
      this.setState({ microphoneState: "degraded" });
      return "degraded";
    }
    try {
      const context = await this.waitUntilReady();
      if (this.stopped) {
        this.stopTracks(stream);
        return "degraded";
      }
      await context.audioWorklet.addModule(this.dependencies.getWorkletUrl());
      if (this.stopped) {
        this.stopTracks(stream);
        return "degraded";
      }
      const source = context.createMediaStreamSource(stream) as unknown as GraphNode;
      this.micBranch = { nodes: [source] };
      const worklet = this.dependencies.createWorkletNode(context) as unknown as WorkletNode;
      this.micBranch.nodes.push(worklet);
      this.micBranch.worklet = worklet;
      const monitor = context.createGain() as unknown as GraphNode & { gain: AudioParam };
      monitor.gain.setValueAtTime(0, context.currentTime);
      this.micBranch.nodes.push(monitor);
      source.connect(worklet as unknown as AudioNode);
      worklet.connect(monitor as unknown as AudioNode);
      monitor.connect(context.destination);
      this.micResampler = new StreamingPcm16Resampler(context.sampleRate);
      this.micChunker = new PcmChunker(640);
      worklet.port.onmessage = (event) => this.handleMicSamples(event.data);
      audioTrack.addEventListener("ended", () => this.degradeMicrophone(), { once: true });
      this.setState({ microphoneState: "ready" });
      return "ready";
    } catch {
      this.stopTracks(stream);
      this.closeBranch(this.micBranch);
      this.micBranch = null;
      if (this.stopped) return "degraded";
      this.setState({ microphoneState: "degraded" });
      return "degraded";
    }
  }

  private handleTabSamples(samples: Float32Array): void {
    const resampler = this.tabResampler;
    const chunker = this.tabChunker;
    const options = this.tabOptions;
    if (!resampler || !chunker || !options || this.stopped || !(samples instanceof Float32Array)) return;
    if (this.tabNextPacketTimestampMs === null) {
      this.tabNextPacketTimestampMs = Math.max(0, Math.round(this.dependencies.now()));
    }
    for (const packet of chunker.push(resampler.push(samples))) {
      const timestampMs = this.takeTabPacketTimestamp(packet.length);
      const activity = this.tabActivity.push(packet, timestampMs);
      if (activity.changed) options.onTabActivity(activity.active);
      this.userVad.pushReference({ source: "tab", pcm: packet, sampleRate: 16_000, firstSampleExtensionSessionMs: timestampMs });
      options.onTabPacket(packet, timestampMs);
    }
  }

  private handleMicSamples(samples: Float32Array): void {
    const resampler = this.micResampler;
    const chunker = this.micChunker;
    const options = this.micOptions;
    if (!resampler || !chunker || !options || !this.userActivityEnabled || this.stopped || !(samples instanceof Float32Array)) return;
    const timestampMs = Math.max(0, Math.round(this.dependencies.now()));
    for (const event of this.userVad.pushMicrophone(resampler.push(samples), timestampMs)) {
      if (event.type === "speech_start") {
        this.micActivityOpen = true;
        this.micNextPacketTimestampMs = Math.max(
          0,
          event.timestampMs - samplesToMilliseconds(event.preRoll.reduce((total, frame) => total + frame.length, 0)),
        );
        options.onUserActivityStart();
        for (const preRoll of event.preRoll) this.emitMicChunks(chunker.push(preRoll));
      } else if (event.type === "speech_audio" && this.micActivityOpen) {
        this.emitMicChunks(chunker.push(event.pcm));
      } else if (event.type === "speech_end" && this.micActivityOpen) {
        const remaining = chunker.flush();
        if (remaining) options.onMicPacket(remaining, this.takeMicPacketTimestamp(remaining.length));
        this.micActivityOpen = false;
        options.onUserActivityEnd();
      }
    }
  }

  private emitMicChunks(chunks: Int16Array[]): void {
    for (const chunk of chunks) {
      this.micOptions?.onMicPacket(chunk, this.takeMicPacketTimestamp(chunk.length));
    }
  }

  private degradeTab(): void {
    if (this.stopped || this.state.tabAudioState !== "captured") return;
    this.closeBranch(this.tabBranch);
    this.tabBranch = null;
    this.setState({ tabAudioState: "degraded" });
    this.tabOptions?.onTabDiscontinuity(Math.max(0, Math.round(this.dependencies.now())));
  }

  private degradeMicrophone(): void {
    if (this.stopped || this.state.microphoneState !== "ready") return;
    this.closeBranch(this.micBranch);
    this.micBranch = null;
    this.userVad.reset();
    this.micActivityOpen = false;
    this.micNextPacketTimestampMs = null;
    this.setState({ microphoneState: "degraded" });
  }

  private closeBranch(branch: Branch | null): void {
    if (!branch) return;
    for (const node of branch.nodes) {
      if (!this.disconnectedNodes.has(node)) {
        this.disconnectedNodes.add(node);
        node.disconnect();
      }
    }
    if (branch.worklet && !this.closedPorts.has(branch.worklet)) {
      this.closedPorts.add(branch.worklet);
      branch.worklet.port.close?.();
    }
  }

  private installVideoEndedListener(options: TabOptions): void {
    this.removeVideoEndedListener();
    const track = options.tabStream.getVideoTracks()[0];
    if (!track) return;
    const handler = () => {
      if (!this.stopped) options.onVideoEnded?.();
    };
    this.tabVideoTrack = track;
    this.tabVideoEndedHandler = handler;
    track.addEventListener("ended", handler, { once: true });
  }

  private removeVideoEndedListener(): void {
    if (this.tabVideoTrack && this.tabVideoEndedHandler) {
      this.tabVideoTrack.removeEventListener("ended", this.tabVideoEndedHandler);
    }
    this.tabVideoTrack = null;
    this.tabVideoEndedHandler = null;
  }

  private closeCaptureNodes(branch: Branch | null): void {
    if (!branch) return;
    for (const node of branch.captureNodes ?? []) {
      if (!this.disconnectedNodes.has(node)) {
        this.disconnectedNodes.add(node);
        node.disconnect();
      }
    }
    if (branch.worklet && !this.closedPorts.has(branch.worklet)) {
      this.closedPorts.add(branch.worklet);
      branch.worklet.port.close?.();
    }
  }

  private takeTabPacketTimestamp(sampleCount: number): number {
    const timestampMs = this.tabNextPacketTimestampMs ?? Math.max(0, Math.round(this.dependencies.now()));
    this.tabNextPacketTimestampMs = timestampMs + samplesToMilliseconds(sampleCount);
    return Math.round(timestampMs);
  }

  private takeMicPacketTimestamp(sampleCount: number): number {
    const timestampMs = this.micNextPacketTimestampMs ?? Math.max(0, Math.round(this.dependencies.now()));
    this.micNextPacketTimestampMs = timestampMs + samplesToMilliseconds(sampleCount);
    return Math.round(timestampMs);
  }

  private stopTracks(stream: MediaStream | null): void {
    for (const track of stream?.getTracks() ?? []) {
      if (this.stoppedTracks.has(track)) continue;
      this.stoppedTracks.add(track);
      track.stop();
    }
  }

  private setState(next: Partial<RealtimeMediaState>): void {
    if (this.stopped) return;
    this.state = { ...this.state, ...next };
    this.publishState();
  }

  private publishState(): void {
    this.dependencies.onStateChange({ ...this.state });
  }
}

function samplesToMilliseconds(sampleCount: number): number {
  return (sampleCount * 1_000) / PCM_SAMPLE_RATE;
}

function isPermissionDenied(cause: unknown): boolean {
  return cause instanceof DOMException && cause.name === "NotAllowedError";
}

function withTimeout(promise: Promise<void>, timeoutMs: number): Promise<void> {
  let timer: ReturnType<typeof setTimeout> | null = null;
  const timeout = new Promise<void>((_, reject) => {
    timer = setTimeout(() => reject(new Error("AudioContext startup timed out.")), timeoutMs);
  });
  return Promise.race([promise, timeout]).finally(() => {
    if (timer !== null) clearTimeout(timer);
  });
}
