import { useCallback, useEffect, useRef, useState } from "react";

import {
  beginAuthorizedCapture,
  captureErrorMessage,
  isCaptureAuthorizationError,
  targetChangeRequiresReset,
} from "../../services/captureTarget";
import type { NarrationMode } from "../context/ConfigurationContext";
import {
  calculateFrameDimensions,
  createFrameCaptureScheduler,
  encodeJpegWithinBudget,
  FRAME_CAPTURE_MAX_BYTES,
} from "./frameCapture";
import { ModelAudioPlayback } from "./modelAudioPlayback";
import {
  createContextTimeToExtensionSessionMs,
  createMediaSocketProtocol,
  RealtimeMediaAudio,
  type RealtimeMediaState,
} from "./mediaAudio";
import {
  createSessionGenerationGuard,
  createSessionResourceLifecycle,
  shouldSyncIdleGuidance,
  type SessionResourceLifecycle,
} from "./sessionLifecycle";
import { SpeechCoordinator } from "./speechCoordinator";
import { useCaptureTarget } from "./useCaptureTarget";
import {
  backpressureAction,
  canAcceptTurnRoleUpdate,
  createTurnRoleState,
  descriptionAfterTurnComplete,
  finishTurnRole,
  parseServerMessage,
  settlingTurnAfterComplete,
  speakingTurnAfterPlaybackIdle,
  updateTurnChatMessages,
  voiceStatusForState,
  type RealtimeChatMessage,
  type RealtimeStatus,
  type ServerMessage,
  type StreamEvent,
  type TurnRoleState,
  type VoiceStatus,
  type VoiceStatusState,
} from "./types";

const VIDEO_FRAME_INTERVAL_MS = 1_000;
const FORCED_FRAME_DEADLINE_MS = 150;
const MAX_PENDING_MICROPHONE_BYTES = 32 * 1024;
const LATE_TRANSCRIPT_SETTLEMENT_MS = 15_000;
const DEFAULT_WEBSOCKET_URL = "ws://127.0.0.1:8000/ws";

type PendingPcm = { pcm: Int16Array; timestampMs: number };
type VoiceTurn = {
  turnId: string;
  pending: boolean;
  ended: boolean;
  packets: PendingPcm[];
  bytes: number;
};
type LatestFrame = { timestampSeconds: number; data: string };

export function delay(ms: number): Promise<void> {
  return new Promise<void>((resolve) => setTimeout(resolve, ms));
}

export function useRealtimeSession(narrationLevel: NarrationMode) {
  const captureTarget = useCaptureTarget();
  const captureTargetRef = useRef(captureTarget);
  captureTargetRef.current = captureTarget;

  const [status, setStatus] = useState<RealtimeStatus>("idle");
  const [statusText, setStatusText] = useState("Ready to describe this tab.");
  const [error, setError] = useState<string | null>(null);
  const [description, setDescription] = useState("Start StreamSense to describe the selected tab.");
  const [events, setEvents] = useState<StreamEvent[]>([]);
  const [messages, setMessages] = useState<RealtimeChatMessage[]>([]);
  const [voiceStatus, setVoiceStatus] = useState<VoiceStatus>("off");
  const [tabContextStatus, setTabContextStatus] = useState<"absent" | "connecting" | "ready" | "degraded">("absent");

  const statusRef = useRef(status);
  statusRef.current = status;
  const errorRef = useRef(error);
  errorRef.current = error;
  const narrationLevelRef = useRef(narrationLevel);

  const websocketRef = useRef<WebSocket | null>(null);
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const captureVideoRef = useRef<HTMLVideoElement | null>(null);
  const captureCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const captureStartedAtRef = useRef<number | null>(null);
  const capturedTabIdRef = useRef<number | null>(null);
  const frameTimerRef = useRef<number | null>(null);
  const lastFrameSignatureRef = useRef<Uint8Array | null>(null);
  const lastFrameSentAtRef = useRef(0);
  const latestFrameRef = useRef<LatestFrame | null>(null);
  const captureFrameRef = useRef<((options: { force: boolean }) => Promise<void>) | null>(null);
  const sessionGenerationRef = useRef(createSessionGenerationGuard());
  const resourceLifecycleRef = useRef<SessionResourceLifecycle | null>(null);
  const startingRef = useRef(false);
  const stopRef = useRef<() => void>(() => undefined);
  const observedGuidanceRef = useRef<string | null>(null);

  const mediaAudioRef = useRef<RealtimeMediaAudio | null>(null);
  const speechCoordinatorRef = useRef<SpeechCoordinator | null>(null);
  const activeTurnRef = useRef<TurnRoleState | null>(null);
  const settlingTurnRef = useRef<TurnRoleState | null>(null);
  const speakingTurnIdRef = useRef<string | null>(null);
  const voiceTurnRef = useRef<VoiceTurn | null>(null);
  const nextVoiceTurnIdRef = useRef<string | null>(null);
  const tabDiscontinuityPendingRef = useRef(false);
  const settlingTurnTimerRef = useRef<number | null>(null);
  const voiceStateRef = useRef<VoiceStatusState>({
    sessionActive: false,
    microphoneState: "pending",
    helloAccepted: false,
    liveReady: false,
    liveDegraded: false,
    userSpeaking: false,
    geminiSpeaking: false,
  });

  const publishVoiceStatus = useCallback((changes: Partial<VoiceStatusState>) => {
    voiceStateRef.current = { ...voiceStateRef.current, ...changes };
    setVoiceStatus(voiceStatusForState(voiceStateRef.current));
  }, []);

  const releaseResources = useCallback(() => {
    sessionGenerationRef.current.invalidate();
    const resourceLifecycle = resourceLifecycleRef.current;
    resourceLifecycleRef.current = null;
    if (resourceLifecycle) void resourceLifecycle.release();
    startingRef.current = false;
    latestFrameRef.current = null;
    lastFrameSignatureRef.current = null;
    lastFrameSentAtRef.current = 0;
    captureFrameRef.current = null;
    tabDiscontinuityPendingRef.current = false;
    activeTurnRef.current = null;
    settlingTurnRef.current = null;
    speakingTurnIdRef.current = null;
    publishVoiceStatus({
      sessionActive: false,
      helloAccepted: false,
      liveReady: false,
      liveDegraded: false,
      userSpeaking: false,
      geminiSpeaking: false,
    });

    websocketRef.current = null;
    speechCoordinatorRef.current = null;
    mediaAudioRef.current = null;
    mediaStreamRef.current = null;
    captureVideoRef.current = null;
    captureCanvasRef.current = null;
    captureStartedAtRef.current = null;
    capturedTabIdRef.current = null;
  }, [publishVoiceStatus]);

  const stop = useCallback(() => {
    releaseResources();
    setStatus("idle");
    const targetSnapshot = captureTargetRef.current;
    setStatusText(targetSnapshot.canStart ? "StreamSense stopped." : targetSnapshot.guidance);
    setDescription("StreamSense is stopped. Start it to describe the active tab.");
  }, [releaseResources]);
  stopRef.current = stop;

  const start = useCallback(async () => {
    if (websocketRef.current || startingRef.current || statusRef.current === "requesting_capture") return;
    const targetSnapshot = captureTargetRef.current;
    if (targetSnapshot.target?.status !== "ready" || targetSnapshot.target.tabId !== targetSnapshot.activeTabId) {
      setError(targetSnapshot.guidance);
      setStatusText(targetSnapshot.guidance);
      return;
    }

    // These two calls deliberately precede the first await in this direct gesture handler.
    const generation = sessionGenerationRef.current.begin();
    startingRef.current = true;
    let mediaState: RealtimeMediaState = { tabAudioState: "absent", microphoneState: "pending" };
    let controller: RealtimeMediaAudio | null = null;
    let sessionWebsocket: WebSocket | null = null;
    const isCurrent = () => controller !== null && mediaAudioRef.current === controller && sessionGenerationRef.current.isCurrent(generation);
    const resourceLifecycle = createSessionResourceLifecycle(isCurrent);
    const callbackGate = resourceLifecycle.callbacks;
    resourceLifecycleRef.current = resourceLifecycle;
    resourceLifecycle.register(() => {
      if (frameTimerRef.current !== null) window.clearInterval(frameTimerRef.current);
      if (settlingTurnTimerRef.current !== null) window.clearTimeout(settlingTurnTimerRef.current);
      frameTimerRef.current = null;
      settlingTurnTimerRef.current = null;
    });
    resourceLifecycle.register(() => {
      if (voiceTurnRef.current) {
        voiceTurnRef.current.packets = [];
        voiceTurnRef.current.bytes = 0;
      }
      voiceTurnRef.current = null;
      nextVoiceTurnIdRef.current = null;
    });
    const safelySend = <T,>(send: () => T): T | false => {
      try { return send(); } catch { return false; }
    };
    const protocol = createMediaSocketProtocol(
      (value) => {
        if (!isCurrent() || websocketRef.current !== sessionWebsocket || sessionWebsocket?.readyState !== WebSocket.OPEN) {
          throw new Error("Session media transport is unavailable.");
        }
        sessionWebsocket.send(value);
      },
      () => {
        const id = nextVoiceTurnIdRef.current ?? crypto.randomUUID();
        nextVoiceTurnIdRef.current = null;
        return id;
      },
    );
    const mediaAudio = new RealtimeMediaAudio({
      onStateChange: (nextState) => {
        callbackGate.run(() => {
          mediaState = nextState;
          publishVoiceStatus({ microphoneState: nextState.microphoneState });
          if (
            nextState.microphoneState === "ready" &&
            voiceStateRef.current.helloAccepted &&
            voiceStateRef.current.liveReady &&
            !voiceStateRef.current.liveDegraded
          ) {
            mediaAudio.setUserActivityEnabled(true);
          }
          if (nextState.tabAudioState === "absent") setTabContextStatus("absent");
          else if (nextState.tabAudioState === "degraded") setTabContextStatus("degraded");
          else setTabContextStatus((current) => current === "ready" ? current : "connecting");
          safelySend(() => protocol.sendMediaState(nextState));
        });
      },
    });
    controller = mediaAudio;
    mediaAudioRef.current = mediaAudio;
    resourceLifecycle.register(() => mediaAudio.stop());
    const preparedAudio = mediaAudio.prepareForUserGesture();
    const audioClockOrigin = {
      contextTime: preparedAudio.audioContext.currentTime,
      extensionSessionMs: performance.now(),
    };
    const contextTimeToExtensionSessionMs = createContextTimeToExtensionSessionMs(audioClockOrigin);
    publishVoiceStatus({ sessionActive: true, microphoneState: "pending" });

    const closeUnsafeMicrophoneTurn = (turnId: string, reason: string) => {
      const websocket = websocketRef.current;
      speechCoordinatorRef.current?.failTurn(turnId, reason);
      mediaAudio.setUserActivityEnabled(false);
      voiceTurnRef.current = null;
      publishVoiceStatus({ userSpeaking: false, liveDegraded: true });
      if (websocket?.readyState === WebSocket.OPEN && websocket.bufferedAmount < 32 * 1024) {
        safelySend(() => protocol.endUserActivity());
      } else {
        websocket?.close(1008, "Microphone audio could not be delivered safely");
      }
    };
    const sendMicrophonePacket = (turn: VoiceTurn, packet: PendingPcm): boolean => {
      const websocket = websocketRef.current;
      if (!websocket || websocket.readyState !== WebSocket.OPEN || backpressureAction("microphone", websocket.bufferedAmount) !== "send") {
        closeUnsafeMicrophoneTurn(turn.turnId, "Microphone audio backlog exceeded one second.");
        return false;
      }
      const sent = safelySend(() => protocol.sendMicrophone(packet.pcm, packet.timestampMs));
      if (!sent) {
        closeUnsafeMicrophoneTurn(turn.turnId, "Microphone audio could not be delivered.");
        return false;
      }
      return true;
    };
    const playback = new ModelAudioPlayback({
      audioContext: preparedAudio.audioContext,
      contextTimeToExtensionSessionMs,
      onReferencePcm: (reference) => mediaAudio.pushPlaybackReference({
        source: "model",
        pcm: reference.pcm,
        sampleRate: reference.sampleRate,
        firstSampleExtensionSessionMs: reference.firstSampleExtensionSessionMs,
      }),
      onIdle: () => undefined,
    });
    const coordinator = new SpeechCoordinator({
      playback,
      setTabGain: (gain, fadeMs) => mediaAudio.setTabGain(gain, fadeMs),
      onFailTurn: (_turnId, reason) => {
        callbackGate.run(() => setError(reason));
      },
      onPlaybackIdle: (turnId) => {
        callbackGate.run(() => {
          const speakingTurnId = speakingTurnIdRef.current;
          speakingTurnIdRef.current = speakingTurnAfterPlaybackIdle(speakingTurnId, turnId);
          if (speakingTurnId !== speakingTurnIdRef.current) {
            publishVoiceStatus({ geminiSpeaking: false });
          }
        });
      },
    });
    speechCoordinatorRef.current = coordinator;
    resourceLifecycle.register(() => coordinator.stop());

    const runFrameCapture = async ({ force }: { force: boolean }): Promise<void> => {
      const websocket = websocketRef.current;
      const video = captureVideoRef.current;
      const canvas = captureCanvasRef.current;
      if (!isCurrent() || !websocket || websocket.readyState !== WebSocket.OPEN || !video || !canvas || video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA) return;
      const flushLatest = () => {
        const latest = latestFrameRef.current;
        if (!latest || performance.now() - lastFrameSentAtRef.current < VIDEO_FRAME_INTERVAL_MS) return false;
        if (backpressureAction("frame", websocket.bufferedAmount) !== "send") return false;
        websocket.send(JSON.stringify({ type: "video_frame", timestampSeconds: latest.timestampSeconds, mimeType: "image/jpeg", data: latest.data }));
        latestFrameRef.current = null;
        lastFrameSentAtRef.current = performance.now();
        return true;
      };
      flushLatest();
      await (async () => {
        const context = canvas.getContext("2d", { alpha: false });
        if (!context) throw new Error("Unable to create the frame capture canvas.");
        const { width, height } = calculateFrameDimensions(video.videoWidth, video.videoHeight);
        canvas.width = width;
        canvas.height = height;
        context.drawImage(video, 0, 0, width, height);
        const signature = createFrameSignature(context, width, height);
        if (!force && !hasMeaningfulVisualChange(lastFrameSignatureRef.current, signature)) return;
        const blob = await encodeJpegWithinBudget(canvas);
        if (!blob || blob.size > FRAME_CAPTURE_MAX_BYTES || !isCurrent() || websocket.readyState !== WebSocket.OPEN) return;
        lastFrameSignatureRef.current = signature;
        const frame = { timestampSeconds: currentTimestampSeconds(video, captureStartedAtRef.current), data: await blobToBase64(blob) };
        if (!isCurrent() || websocket.readyState !== WebSocket.OPEN) return;
        if (performance.now() - lastFrameSentAtRef.current < VIDEO_FRAME_INTERVAL_MS || backpressureAction("frame", websocket.bufferedAmount) !== "send") {
          latestFrameRef.current = frame;
          return;
        }
        websocket.send(JSON.stringify({ type: "video_frame", timestampSeconds: frame.timestampSeconds, mimeType: "image/jpeg", data: frame.data }));
        lastFrameSentAtRef.current = performance.now();
      })().catch((cause) => {
        if (isCurrent()) setError(`Could not capture a frame: ${toErrorMessage(cause)}`);
      });
    };
    const { capture: captureFrame } = createFrameCaptureScheduler(runFrameCapture);
    captureFrameRef.current = captureFrame;

    const microphonePromise = mediaAudio.startMicrophone({
      onMicPacket: (pcm, timestampMs) => {
        callbackGate.run(() => {
          const turn = voiceTurnRef.current;
          if (!turn) return;
          const packet = { pcm, timestampMs };
          if (turn.pending) {
            turn.packets.push(packet);
            turn.bytes += pcm.byteLength;
            if (turn.bytes > MAX_PENDING_MICROPHONE_BYTES) closeUnsafeMicrophoneTurn(turn.turnId, "Microphone audio backlog exceeded one second.");
            return;
          }
          sendMicrophonePacket(turn, packet);
        });
      },
      onUserActivityStart: () => {
        if (!callbackGate.allows() || !voiceStateRef.current.helloAccepted || !voiceStateRef.current.liveReady) return;
        const turnId = crypto.randomUUID();
        nextVoiceTurnIdRef.current = turnId;
        const turn: VoiceTurn = { turnId, pending: true, ended: false, packets: [], bytes: 0 };
        voiceTurnRef.current = turn;
        activeTurnRef.current = createTurnRoleState(turnId);
        settlingTurnRef.current = null;
        if (settlingTurnTimerRef.current !== null) {
          window.clearTimeout(settlingTurnTimerRef.current);
          settlingTurnTimerRef.current = null;
        }
        coordinator.userStarted(turnId);
        speakingTurnIdRef.current = null;
        publishVoiceStatus({ userSpeaking: true, geminiSpeaking: false });
        void (async () => {
          await Promise.race([captureFrame({ force: true }), delay(FORCED_FRAME_DEADLINE_MS)]);
          if (!isCurrent() || voiceTurnRef.current !== turn) return;
          const startedTurnId = safelySend(() => protocol.startUserActivity());
          if (startedTurnId !== turnId) {
            closeUnsafeMicrophoneTurn(turnId, "Could not start the microphone turn.");
            return;
          }
          turn.pending = false;
          for (const packet of turn.packets) {
            if (!sendMicrophonePacket(turn, packet)) return;
          }
          turn.packets = [];
          turn.bytes = 0;
          if (turn.ended) {
            safelySend(() => protocol.endUserActivity());
            coordinator.userEnded(turnId);
            publishVoiceStatus({ userSpeaking: false });
          }
        })();
      },
      onUserActivityEnd: () => {
        callbackGate.run(() => {
          const turn = voiceTurnRef.current;
          if (!turn) return;
          turn.ended = true;
          if (turn.pending) return;
          safelySend(() => protocol.endUserActivity());
          coordinator.userEnded(turn.turnId);
          publishVoiceStatus({ userSpeaking: false });
        });
      },
      tabReference: null,
      modelReference: null,
    });

    setStatus("requesting_capture");
    setStatusText("Capturing the active tab without the StreamSense panel.");
    setError(null);
    setEvents([]);
    setMessages([]);
    setDescription("Waiting for the first description...");
    let startupStream: MediaStream | null = null;
    let startupVideo: HTMLVideoElement | null = null;
    try {
      const mediaStream = await beginAuthorizedCapture(targetSnapshot.target, {
        requestStreamId: (options) => chrome.tabCapture.getMediaStreamId(options),
        ensureAudioReady: () => preparedAudio.ready,
        isCurrent: () => sessionGenerationRef.current.isCurrent(generation),
        consumeStreamId: consumeTabStreamId,
      });
      startupStream = mediaStream;
      if (!isCurrent()) { for (const track of mediaStream.getTracks()) track.stop(); return; }
      mediaStreamRef.current = mediaStream;
      await mediaAudio.startTab({
        tabStream: mediaStream,
        onTabPacket: (pcm, timestampMs) => {
          if (!callbackGate.allows()) return;
          const websocket = websocketRef.current;
          if (!websocket || websocket.readyState !== WebSocket.OPEN) return;
          if (backpressureAction("tab", websocket.bufferedAmount) !== "send") {
            tabDiscontinuityPendingRef.current = true;
            setTabContextStatus("degraded");
            return;
          }
          if (tabDiscontinuityPendingRef.current) {
            const sent = safelySend(() => websocket.send(JSON.stringify({ type: "tab_audio_discontinuity", timestampMs, reason: "websocket_backpressure" })));
            if (!sent) return;
            tabDiscontinuityPendingRef.current = false;
          }
          safelySend(() => protocol.sendTab(pcm, timestampMs));
        },
        onTabActivity: (active) => {
          callbackGate.run(() => {
            coordinator.tabActivity(active);
            safelySend(() => protocol.sendTabActivity(active));
          });
        },
        onTabDiscontinuity: (timestampMs) => {
          callbackGate.run(() => {
            setTabContextStatus("degraded");
            safelySend(() => protocol.sendTabDiscontinuity(timestampMs));
          });
        },
        onVideoEnded: () => { callbackGate.run(() => stopRef.current()); },
      });
      if (!isCurrent()) { await mediaAudio.stop(); return; }
      const video = document.createElement("video");
      video.muted = true;
      video.playsInline = true;
      video.srcObject = mediaStream;
      startupVideo = video;
      captureVideoRef.current = video;
      resourceLifecycle.register(() => {
        video.pause();
        video.srcObject = null;
      });
      captureCanvasRef.current = document.createElement("canvas");
      await video.play();
      if (!isCurrent()) { video.pause(); video.srcObject = null; for (const track of mediaStream.getTracks()) track.stop(); return; }
      captureStartedAtRef.current = performance.now();
      capturedTabIdRef.current = targetSnapshot.target.tabId;
      const websocket = new WebSocket(import.meta.env.VITE_STREAMSENSE_WS_URL || DEFAULT_WEBSOCKET_URL);
      sessionWebsocket = websocket;
      websocketRef.current = websocket;
      resourceLifecycle.register(() => {
        if (websocket.readyState === WebSocket.OPEN || websocket.readyState === WebSocket.CONNECTING) {
          websocket.close(1000, "Extension session stopped");
        }
      });
      startingRef.current = false;
      setStatus("connecting");
      setStatusText("Connecting to the local StreamSense backend...");
      websocket.addEventListener("open", () => {
        if (!isCurrent()) { websocket.close(1000, "Stale extension session"); return; }
        protocol.open(mediaState);
        websocket.send(JSON.stringify({ type: "capture_source", source: "screen" }));
        websocket.send(JSON.stringify({ type: "session_config", narrationLevel: narrationLevelRef.current }));
        void captureFrame({ force: false });
        frameTimerRef.current = window.setInterval(() => { void captureFrame({ force: false }); }, VIDEO_FRAME_INTERVAL_MS);
      });
      void microphonePromise.then(() => {
        callbackGate.run(() => publishVoiceStatus({ microphoneState: mediaState.microphoneState }));
      });
      websocket.addEventListener("message", (event) => {
        if (!isCurrent()) return;
        let message: ServerMessage;
        try { message = parseServerMessage(String(event.data)); }
        catch { websocket.close(1002, "Invalid backend message"); setError("The backend sent an invalid message."); return; }
        switch (message.type) {
          case "connected":
            setStatus("connected"); setStatusText(`Connected to ${message.model ?? "Gemini"}.`); setError(null);
            publishVoiceStatus({ helloAccepted: true });
            break;
          case "provider_health":
            if (message.provider === "live") {
              const ready = message.state === "ready";
              const degraded = message.state === "degraded" || message.state === "closed";
              publishVoiceStatus({ liveReady: ready, liveDegraded: degraded });
              mediaAudio.setUserActivityEnabled(ready && !degraded && mediaState.microphoneState === "ready");
            } else if (mediaState.tabAudioState !== "absent") {
              setTabContextStatus(message.state === "ready" ? "ready" : message.state === "connecting" ? "connecting" : "degraded");
            }
            break;
          case "user_transcript":
          case "answer_update": {
            const role = message.type === "user_transcript" ? "user" : "assistant";
            if (message.mode === "answer" && canAcceptTurnRoleUpdate(
              message.turnId,
              role,
              activeTurnRef.current,
              settlingTurnRef.current,
            )) {
              setMessages((current) => updateTurnChatMessages(current, {
                turnId: message.turnId,
                role,
                text: message.text,
                finished: message.finished,
              }));
              if (message.type === "answer_update") coordinator.answerProgress(message.turnId);
              if (message.finished) {
                if (activeTurnRef.current?.turnId === message.turnId) {
                  activeTurnRef.current = finishTurnRole(activeTurnRef.current, role);
                } else if (settlingTurnRef.current?.turnId === message.turnId) {
                  const finishedTurn = finishTurnRole(settlingTurnRef.current, role);
                  settlingTurnRef.current = settlingTurnAfterComplete(finishedTurn, message.turnId);
                  if (settlingTurnRef.current === null && settlingTurnTimerRef.current !== null) {
                    window.clearTimeout(settlingTurnTimerRef.current);
                    settlingTurnTimerRef.current = null;
                  }
                }
              }
            }
            break;
          }
          case "model_audio": {
            const sampleRate = parsePcmRate(message.mimeType);
            if (!sampleRate) { websocket.close(1002, "Invalid audio metadata"); return; }
            try {
              const accepted = coordinator.modelAudio({ turnId: message.turnId, mode: message.mode, pcm: base64ToArrayBuffer(message.data), sampleRate, mimeType: message.mimeType });
              if (accepted) {
                speakingTurnIdRef.current = message.turnId;
                publishVoiceStatus({ geminiSpeaking: true });
              }
            } catch { websocket.close(1002, "Invalid audio payload"); }
            break;
          }
          case "playback_clear": {
            coordinator.clearPlayback(message.turnId);
            const speakingTurnId = speakingTurnIdRef.current;
            speakingTurnIdRef.current = speakingTurnAfterPlaybackIdle(speakingTurnId, message.turnId);
            if (speakingTurnId !== speakingTurnIdRef.current) {
              publishVoiceStatus({ geminiSpeaking: false });
            }
            if (message.mode === "narration") setDescription("");
            break;
          }
          case "turn_complete":
            coordinator.turnComplete(message);
            if (activeTurnRef.current?.turnId === message.turnId) {
              settlingTurnRef.current = settlingTurnAfterComplete(activeTurnRef.current, message.turnId);
              activeTurnRef.current = null;
              if (settlingTurnTimerRef.current !== null) window.clearTimeout(settlingTurnTimerRef.current);
              settlingTurnTimerRef.current = settlingTurnRef.current === null
                ? null
                : window.setTimeout(() => {
                  if (settlingTurnRef.current?.turnId === message.turnId) settlingTurnRef.current = null;
                  settlingTurnTimerRef.current = null;
                }, LATE_TRANSCRIPT_SETTLEMENT_MS);
            }
            setDescription((current) => descriptionAfterTurnComplete(
              current,
              message.mode,
              message.interrupted === true,
            ));
            break;
          case "status_text": if (message.text) setStatusText(message.text); break;
          case "narration":
          case "narration_update": if (message.text) setDescription(message.text); break;
          case "event": if (message.event) setEvents((current) => current.some((item) => item.id === message.event!.id) ? current : [message.event!, ...current].slice(0, 100)); break;
          case "error": setError(message.text ?? "The realtime session reported an error."); setStatus("error"); break;
          case "analysis_error": setError(message.text ?? "The current frame could not be analyzed."); break;
          case "answer":
          case "status":
          case "telemetry":
          case "turn_started":
            break;
        }
      });
      websocket.addEventListener("error", () => {
        if (!isCurrent()) return;
        setError("Cannot reach StreamSense at 127.0.0.1:8000. Start the Express backend first.");
        setStatus("error");
      });
      websocket.addEventListener("close", () => {
        protocol.close();
        if (!isCurrent()) return;
        releaseResources();
        setStatus("error");
        setStatusText("Backend connection closed.");
      });
    } catch (cause) {
      if (!isCurrent()) { startupVideo?.pause(); if (startupVideo) startupVideo.srcObject = null; for (const track of startupStream?.getTracks() ?? []) track.stop(); return; }
      releaseResources();
      setStatus("error");
      setError(captureErrorMessage(cause));
      setStatusText("StreamSense could not start.");
    }
  }, [publishVoiceStatus, releaseResources]);

  const ask = useCallback((question: string) => {
    const websocket = websocketRef.current;
    const coordinator = speechCoordinatorRef.current;
    if (!websocket || websocket.readyState !== WebSocket.OPEN || !coordinator) return false;
    const turnId = crypto.randomUUID();
    activeTurnRef.current = createTurnRoleState(turnId, { userFinished: true });
    settlingTurnRef.current = null;
    if (settlingTurnTimerRef.current !== null) {
      window.clearTimeout(settlingTurnTimerRef.current);
      settlingTurnTimerRef.current = null;
    }
    coordinator.typedQuestionStarted(turnId);
    speakingTurnIdRef.current = null;
    publishVoiceStatus({ geminiSpeaking: false });
    setMessages((current) => updateTurnChatMessages(current, { turnId, role: "user", text: question, finished: true }));
    void (async () => {
      await Promise.race([captureFrameRef.current?.({ force: true }) ?? Promise.resolve(), delay(FORCED_FRAME_DEADLINE_MS)]);
      if (websocketRef.current === websocket && websocket.readyState === WebSocket.OPEN) {
        websocket.send(JSON.stringify({ type: "typed_question", turnId, text: question }));
      }
    })();
    return true;
  }, [publishVoiceStatus]);

  useEffect(() => {
    if (!targetChangeRequiresReset(capturedTabIdRef.current, captureTarget.target)) return;
    stopRef.current();
    setError(null);
    setStatusText(captureTarget.canStart ? "Capture target changed. Start StreamSense again." : captureTarget.guidance);
  }, [captureTarget.target, captureTarget.canStart, captureTarget.guidance]);

  useEffect(() => {
    const previousGuidance = observedGuidanceRef.current;
    observedGuidanceRef.current = captureTarget.guidance;
    const authorizationRecovered = captureTarget.canStart && isCaptureAuthorizationError(errorRef.current);
    if (authorizationRecovered) { setError(null); setStatus("idle"); setStatusText(captureTarget.guidance); }
    if (!authorizationRecovered && shouldSyncIdleGuidance(statusRef.current === "idle", previousGuidance, captureTarget.guidance)) setStatusText(captureTarget.guidance);
  }, [captureTarget.canStart, captureTarget.guidance]);

  useEffect(() => {
    narrationLevelRef.current = narrationLevel;
    const websocket = websocketRef.current;
    if (websocket?.readyState === WebSocket.OPEN) websocket.send(JSON.stringify({ type: "session_config", narrationLevel }));
  }, [narrationLevel]);

  useEffect(() => {
    const cleanup = () => releaseResources();
    window.addEventListener("pagehide", cleanup);
    return () => { window.removeEventListener("pagehide", cleanup); cleanup(); };
  }, [releaseResources]);

  return {
    status, statusText, error, description, events, messages, voiceStatus, tabContextStatus,
    isRunning: status === "connecting" || status === "connected",
    isBusy: status === "requesting_capture",
    canStart: captureTarget.canStart,
    canAsk: status === "connected",
    start, stop, ask,
  };
}

function currentTimestampSeconds(video: HTMLVideoElement, captureStartedAt: number | null) {
  if (Number.isFinite(video.currentTime) && video.currentTime > 0) return Math.round(video.currentTime * 1_000) / 1_000;
  return captureStartedAt === null ? 0 : Math.round(performance.now() - captureStartedAt) / 1_000;
}

function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => resolve(String(reader.result).split(",")[1] ?? "");
    reader.onerror = () => reject(reader.error ?? new Error("Frame encoding failed."));
    reader.readAsDataURL(blob);
  });
}

function base64ToArrayBuffer(base64: string): ArrayBuffer {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes.buffer;
}

function parsePcmRate(mimeType: string): number | null {
  const match = /^audio\/pcm;rate=([1-9][0-9]*)$/.exec(mimeType);
  if (!match) return null;
  const sampleRate = Number(match[1]);
  return Number.isSafeInteger(sampleRate) && sampleRate >= 8_000 && sampleRate <= 48_000 ? sampleRate : null;
}

function toErrorMessage(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}

function createFrameSignature(context: CanvasRenderingContext2D, width: number, height: number) {
  const columns = 48;
  const rows = Math.max(1, Math.round(columns * (height / width)));
  const pixels = context.getImageData(0, 0, width, height).data;
  const signature = new Uint8Array(columns * rows);
  for (let row = 0; row < rows; row += 1) {
    const y = Math.min(height - 1, Math.floor(((row + 0.5) / rows) * height));
    for (let column = 0; column < columns; column += 1) {
      const x = Math.min(width - 1, Math.floor(((column + 0.5) / columns) * width));
      const index = (y * width + x) * 4;
      signature[row * columns + column] = Math.round(pixels[index] * 0.2126 + pixels[index + 1] * 0.7152 + pixels[index + 2] * 0.0722);
    }
  }
  return signature;
}

function hasMeaningfulVisualChange(previous: Uint8Array | null, current: Uint8Array): boolean {
  if (!previous || previous.length !== current.length) return true;
  let changedSamples = 0;
  let totalDifference = 0;
  for (let index = 0; index < current.length; index += 1) {
    const difference = Math.abs(current[index] - previous[index]);
    totalDifference += difference;
    if (difference >= 18) changedSamples += 1;
  }
  return changedSamples / current.length >= 0.012 || totalDifference / current.length >= 5;
}

async function consumeTabStreamId(streamId: string): Promise<MediaStream> {
  const audio = { mandatory: { chromeMediaSource: "tab", chromeMediaSourceId: streamId } } as unknown as MediaTrackConstraints;
  const video = { mandatory: { chromeMediaSource: "tab", chromeMediaSourceId: streamId, maxFrameRate: 10 } } as unknown as MediaTrackConstraints;
  return navigator.mediaDevices.getUserMedia({ audio, video });
}
