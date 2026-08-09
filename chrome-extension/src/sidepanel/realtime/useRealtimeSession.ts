import { useCallback, useEffect, useRef, useState } from "react";

import {
  beginAuthorizedCapture,
  captureErrorMessage,
  isCaptureAuthorizationError,
  targetChangeRequiresReset,
} from "../../services/captureTarget";
import {
  isMicrophonePermissionGrantedMessage,
  microphonePermissionPageUrl,
} from "../../services/microphonePermission";
import { configuredBackendWebSocketUrl } from "../../services/backendUrls";
import type { NarrationMode } from "../context/ConfigurationContext";
import type { VoiceNarrationMode } from "../voiceNarration";
import {
  calculateFrameDimensions,
  commitRetainedFrame,
  createFrameSignature,
  createFrameCaptureScheduler,
  encodeJpegWithinBudget,
  FRAME_CAPTURE_MAX_BYTES,
  hasMeaningfulVisualChange,
  type FrameSignature,
} from "./frameCapture";
import { ModelAudioPlayback } from "./modelAudioPlayback";
import {
  createContextTimeToExtensionSessionMs,
  createMediaSocketProtocol,
  RealtimeMediaAudio,
  type MicrophoneOptions,
  type MicrophoneState,
  type RealtimeMediaState,
} from "./mediaAudio";
import {
  createMicrophoneTurnOwnership,
  createSessionGenerationGuard,
  createSessionResourceLifecycle,
  shouldSyncIdleGuidance,
  type SessionResourceLifecycle,
  type MicrophoneTurnOwnership,
} from "./sessionLifecycle";
import { SpeechCoordinator } from "./speechCoordinator";
import {
  createChromeTimelineTtsPort,
  TimelineNarrator,
} from "./timelineNarrator";
import { routeTimelineEvent } from "./timelineEventAdmission";
import {
  canAskRealtime,
  dispatchTypedQuestion,
  questionAvailabilityFor,
  retireMicrophoneBeforeTypedAdmission,
  retryableAnswerNotice,
} from "./typedQuestion";
import { useCaptureTarget } from "./useCaptureTarget";
import {
  backpressureAction,
  backendConnectionClosedStatus,
  canAcceptTurnRoleUpdate,
  createTurnRoleState,
  descriptionAfterTurnComplete,
  descriptionTurnOwnsCompletion,
  finishTurnRole,
  mergeNarrationTranscript,
  parseServerMessage,
  settlingTurnAfterComplete,
  speakingTurnAfterPlaybackIdle,
  updateTurnChatMessages,
  voiceStatusForState,
  type RealtimeChatMessage,
  type ResearchMode,
  type ResearchProgress,
  type RealtimeStatus,
  type ServerMessage,
  type StreamEvent,
  type LiveProviderState,
  type TurnRoleState,
  type VoiceStatus,
  type VoiceStatusState,
} from "./types";

const VIDEO_FRAME_INTERVAL_MS = 1_000;
const FORCED_FRAME_DEADLINE_MS = 150;
const MAX_PENDING_MICROPHONE_BYTES = 32 * 1024;
const LATE_TRANSCRIPT_SETTLEMENT_MS = 15_000;

type PendingPcm = { pcm: Int16Array; timestampMs: number };
type VoiceTurn = {
  turnId: string;
  pending: boolean;
  ended: boolean;
  packets: PendingPcm[];
  bytes: number;
};
type LatestFrame = { timestampSeconds: number; data: string };
type RetireMicrophoneTurn = (
  turnId: string | undefined,
  options: { notifyBackend: boolean; failCoordinator?: boolean; reason?: string },
) => "none" | "retired" | "transport_failed";

export function delay(ms: number): Promise<void> {
  return new Promise<void>((resolve) => setTimeout(resolve, ms));
}

export function useRealtimeSession(
  narrationLevel: NarrationMode,
  voiceNarrationMode: VoiceNarrationMode,
) {
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
  const [liveProviderState, setLiveProviderState] = useState<LiveProviderState>("closed");
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
  const [researchMode, setResearchModeState] = useState<ResearchMode>("normal");
  const [researchProgress, setResearchProgress] = useState<ResearchProgress[]>([]);
  const eventsRef = useRef<StreamEvent[]>(events);
  eventsRef.current = events;

  const statusRef = useRef(status);
  statusRef.current = status;
  const errorRef = useRef(error);
  errorRef.current = error;
  const narrationLevelRef = useRef(narrationLevel);
  const voiceNarrationModeRef = useRef(voiceNarrationMode);
  voiceNarrationModeRef.current = voiceNarrationMode;
  const researchModeRef = useRef<ResearchMode>(researchMode);
  researchModeRef.current = researchMode;

  const websocketRef = useRef<WebSocket | null>(null);
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const captureVideoRef = useRef<HTMLVideoElement | null>(null);
  const captureCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const captureStartedAtRef = useRef<number | null>(null);
  const capturedTabIdRef = useRef<number | null>(null);
  const frameTimerRef = useRef<number | null>(null);
  const lastFrameSignatureRef = useRef<FrameSignature | null>(null);
  const lastFrameSentAtRef = useRef(0);
  const latestFrameRef = useRef<LatestFrame | null>(null);
  const captureFrameRef = useRef<((options: { force: boolean }) => Promise<void>) | null>(null);
  const sessionGenerationRef = useRef(createSessionGenerationGuard());
  const resourceLifecycleRef = useRef<SessionResourceLifecycle | null>(null);
  const startingRef = useRef(false);
  const stopRef = useRef<() => void>(() => undefined);
  const observedGuidanceRef = useRef<string | null>(null);
  const liveProviderStateRef = useRef<LiveProviderState>("closed");

  const mediaAudioRef = useRef<RealtimeMediaAudio | null>(null);
  const retryMicrophoneRef = useRef<(() => Promise<MicrophoneState>) | null>(null);
  const speechCoordinatorRef = useRef<SpeechCoordinator | null>(null);
  const timelineNarratorRef = useRef<TimelineNarrator | null>(null);
  const activeTurnRef = useRef<TurnRoleState | null>(null);
  const settlingTurnRef = useRef<TurnRoleState | null>(null);
  const speakingTurnIdRef = useRef<string | null>(null);
  const descriptionTurnIdRef = useRef<string | null>(null);
  const narrationTranscriptRef = useRef<{ turnId: string; text: string } | null>(null);
  const microphoneTurnOwnershipRef = useRef<MicrophoneTurnOwnership<VoiceTurn> | null>(null);
  const retireMicrophoneTurnRef = useRef<RetireMicrophoneTurn | null>(null);
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

  const publishLiveProviderState = useCallback((state: LiveProviderState) => {
    liveProviderStateRef.current = state;
    setLiveProviderState(state);
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
    descriptionTurnIdRef.current = null;
    narrationTranscriptRef.current = null;
    microphoneTurnOwnershipRef.current?.clear();
    microphoneTurnOwnershipRef.current = null;
    retireMicrophoneTurnRef.current = null;
    setActiveSessionId(null);
    setResearchProgress([]);
    publishLiveProviderState("closed");
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
    timelineNarratorRef.current = null;
    mediaAudioRef.current = null;
    retryMicrophoneRef.current = null;
    mediaStreamRef.current = null;
    captureVideoRef.current = null;
    captureCanvasRef.current = null;
    captureStartedAtRef.current = null;
    capturedTabIdRef.current = null;
  }, [publishLiveProviderState, publishVoiceStatus]);

  const stop = useCallback(() => {
    releaseResources();
    setStatus("idle");
    const targetSnapshot = captureTargetRef.current;
    setStatusText(targetSnapshot.canStart ? "StreamSense stopped." : targetSnapshot.guidance);
    setDescription("StreamSense is stopped. Start it to describe the active tab.");
  }, [releaseResources]);
  stopRef.current = stop;

  const settleTurnComplete = useCallback((
    message: Extract<ServerMessage, { type: "turn_complete" }>,
  ) => {
    speechCoordinatorRef.current?.turnComplete(message);
    retireMicrophoneTurnRef.current?.(message.turnId, { notifyBackend: false });
    const settledActiveTurn = activeTurnRef.current?.turnId === message.turnId;
    const settledDescriptionTurn = descriptionTurnOwnsCompletion(
      descriptionTurnIdRef.current,
      message.turnId,
      message.mode,
    );
    if (settledActiveTurn) {
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
    if (settledDescriptionTurn) {
      descriptionTurnIdRef.current = null;
      setDescription((current) => descriptionAfterTurnComplete(
        current,
        message.mode,
        message.interrupted === true,
      ));
    }
    const notice = retryableAnswerNotice(message.mode, message.retryable, settledActiveTurn);
    if (notice) setError(notice);
  }, []);

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
    const microphoneTurns = createMicrophoneTurnOwnership<VoiceTurn>();
    microphoneTurnOwnershipRef.current = microphoneTurns;
    resourceLifecycle.register(() => {
      microphoneTurns.clear();
      if (microphoneTurnOwnershipRef.current === microphoneTurns) {
        microphoneTurnOwnershipRef.current = null;
        retireMicrophoneTurnRef.current = null;
      }
      nextVoiceTurnIdRef.current = null;
    });
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
    mediaAudio.setPushToTalkMode(true);
    resourceLifecycle.register(() => mediaAudio.stop());
    const preparedAudio = mediaAudio.prepareForUserGesture();
    const audioClockOrigin = {
      contextTime: preparedAudio.audioContext.currentTime,
      extensionSessionMs: performance.now(),
    };
    const contextTimeToExtensionSessionMs = createContextTimeToExtensionSessionMs(audioClockOrigin);
    publishVoiceStatus({ sessionActive: true, microphoneState: "pending" });

    const retireMicrophoneTurn: RetireMicrophoneTurn = (turnId, {
      notifyBackend,
      failCoordinator = false,
      reason = "",
    }) => {
      const turn = microphoneTurns.retire(turnId);
      if (!turn) return "none";
      const websocket = websocketRef.current;
      nextVoiceTurnIdRef.current = null;
      mediaAudio.setUserActivityEnabled(false);
      if (failCoordinator) speechCoordinatorRef.current?.failTurn(turn.turnId, reason);
      let transportFailed = false;
      if (notifyBackend) {
        if (websocket?.readyState === WebSocket.OPEN && websocket.bufferedAmount < 32 * 1024) {
          transportFailed = safelySend(() => protocol.cancelUserActivity()) === false;
        } else {
          transportFailed = true;
        }
      } else {
        protocol.forgetUserActivity();
      }
      if (transportFailed) websocket?.close(1008, "Microphone audio could not be delivered safely");
      mediaAudio.setUserActivityEnabled(
        voiceStateRef.current.helloAccepted
          && voiceStateRef.current.liveReady
          && !voiceStateRef.current.liveDegraded
          && mediaState.microphoneState === "ready",
      );
      publishVoiceStatus({ userSpeaking: false });
      return transportFailed ? "transport_failed" : "retired";
    };
    retireMicrophoneTurnRef.current = retireMicrophoneTurn;
    const closeUnsafeMicrophoneTurn = (turnId: string, reason: string) => {
      retireMicrophoneTurn(turnId, { notifyBackend: true, failCoordinator: true, reason });
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
      voiceNarrationMode: voiceNarrationModeRef.current,
      setTabGain: (gain, fadeMs) => mediaAudio.setTabGain(gain, fadeMs),
      onFailTurn: (turnId, reason) => {
        callbackGate.run(() => {
          retireMicrophoneTurn(turnId, { notifyBackend: true, reason });
          setError(reason);
        });
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
    const timelineNarrator = new TimelineNarrator({
      tts: createChromeTimelineTtsPort(),
      voiceNarrationMode: voiceNarrationModeRef.current,
      automaticNarrationEnabled: narrationLevelRef.current !== "question_only",
      onActiveChange: (active) => {
        callbackGate.run(() => coordinator.setTimelineNarrationActive(active));
      },
      onError: (message) => {
        callbackGate.run(() => setError(`Timeline narration unavailable: ${message}`));
      },
    });
    timelineNarratorRef.current = timelineNarrator;
    resourceLifecycle.register(() => {
      timelineNarrator.stop();
      if (timelineNarratorRef.current === timelineNarrator) {
        timelineNarratorRef.current = null;
      }
    });

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
        const signature = createFrameSignature(
          context.getImageData(0, 0, width, height).data,
          width,
          height,
        );
        if (!force && !hasMeaningfulVisualChange(lastFrameSignatureRef.current, signature)) return;
        const blob = await encodeJpegWithinBudget(canvas);
        if (!blob || blob.size > FRAME_CAPTURE_MAX_BYTES || !isCurrent() || websocket.readyState !== WebSocket.OPEN) return;
        const frame = { timestampSeconds: currentTimestampSeconds(video, captureStartedAtRef.current), data: await blobToBase64(blob) };
        if (!isCurrent() || websocket.readyState !== WebSocket.OPEN) return;
        if (performance.now() - lastFrameSentAtRef.current < VIDEO_FRAME_INTERVAL_MS || backpressureAction("frame", websocket.bufferedAmount) !== "send") {
          const retained = commitRetainedFrame(signature, () => {
            latestFrameRef.current = frame;
          });
          lastFrameSignatureRef.current = retained.signature;
          return;
        }
        const retained = commitRetainedFrame(signature, () => websocket.send(JSON.stringify({
          type: "video_frame",
          timestampSeconds: frame.timestampSeconds,
          mimeType: "image/jpeg",
          data: frame.data,
        })));
        lastFrameSignatureRef.current = retained.signature;
        lastFrameSentAtRef.current = performance.now();
      })().catch((cause) => {
        if (isCurrent()) setError(`Could not capture a frame: ${toErrorMessage(cause)}`);
      });
    };
    const { capture: captureFrame } = createFrameCaptureScheduler(runFrameCapture);
    captureFrameRef.current = captureFrame;

    const microphoneOptions: MicrophoneOptions = {
      onMicPacket: (pcm, timestampMs) => {
        callbackGate.run(() => {
          const turn = microphoneTurns.current();
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
        timelineNarrator.interruptForQuestion();
        const turnId = crypto.randomUUID();
        setResearchProgress([]);
        nextVoiceTurnIdRef.current = turnId;
        const turn: VoiceTurn = { turnId, pending: true, ended: false, packets: [], bytes: 0 };
        microphoneTurns.claim(turn);
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
          if (!isCurrent() || !microphoneTurns.isCurrent(turn)) return;
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
          const turn = microphoneTurns.current();
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
    };
    const startMicrophoneAttempt = () => mediaAudio.startMicrophone(microphoneOptions);
    retryMicrophoneRef.current = startMicrophoneAttempt;
    resourceLifecycle.register(() => {
      if (retryMicrophoneRef.current === startMicrophoneAttempt) {
        retryMicrophoneRef.current = null;
      }
    });
    const microphonePromise = startMicrophoneAttempt();

    setStatus("requesting_capture");
    setStatusText("Capturing the active tab without the StreamSense panel.");
    setError(null);
    setActiveSessionId(null);
    eventsRef.current = [];
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
            timelineNarrator.setTabActivity(active);
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
      const websocket = new WebSocket(configuredBackendWebSocketUrl());
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
        websocket.send(JSON.stringify({
          type: "session_config",
          narrationLevel: narrationLevelRef.current,
          voiceNarrationMode: voiceNarrationModeRef.current,
          researchMode: researchModeRef.current,
        }));
        void captureFrame({ force: false });
        frameTimerRef.current = window.setInterval(() => { void captureFrame({ force: false }); }, VIDEO_FRAME_INTERVAL_MS);
      });
      void microphonePromise.then(() => {
        callbackGate.run(() => publishVoiceStatus({ microphoneState: mediaState.microphoneState }));
      });
      let modelAudioDelivery = Promise.resolve();
      const deliverModelAudio = async (message: Extract<ServerMessage, { type: "model_audio" }>) => {
        const sampleRate = parsePcmRate(message.mimeType);
        if (!sampleRate) throw new Error("Invalid audio metadata");
        const pcm = base64ToArrayBuffer(message.data);
        if (preparedAudio.audioContext.state !== "running") {
          await preparedAudio.audioContext.resume();
        }
        if (preparedAudio.audioContext.state !== "running") {
          throw new Error("Model audio playback unavailable.");
        }
        callbackGate.run(() => {
          const accepted = coordinator.modelAudio({
            turnId: message.turnId,
            mode: message.mode,
            pcm,
            sampleRate,
            mimeType: message.mimeType,
          });
          if (accepted) {
            speakingTurnIdRef.current = message.turnId;
            publishVoiceStatus({ geminiSpeaking: true });
          }
        });
      };
      websocket.addEventListener("message", (event) => {
        if (!isCurrent()) return;
        let message: ServerMessage;
        try { message = parseServerMessage(String(event.data)); }
        catch { websocket.close(1002, "Invalid backend message"); setError("The backend sent an invalid message."); return; }
        switch (message.type) {
          case "connected":
            setStatus("connected"); setStatusText(`Connected to ${message.model ?? "Gemini"}.`); setError(null);
            setActiveSessionId(message.sessionId);
            publishLiveProviderState("connecting");
            publishVoiceStatus({ helloAccepted: true });
            break;
          case "provider_health":
            if (message.provider === "live") {
              if (message.state !== "ready") {
                retireMicrophoneTurn(undefined, { notifyBackend: false });
              }
              publishLiveProviderState(message.state);
              const ready = message.state === "ready";
              const degraded = message.state === "degraded" || message.state === "closed";
              publishVoiceStatus({ liveReady: ready, liveDegraded: degraded });
              mediaAudio.setUserActivityEnabled(ready && !degraded && mediaState.microphoneState === "ready");
            } else if (mediaState.tabAudioState !== "absent") {
              setTabContextStatus(message.state === "ready" ? "ready" : message.state === "connecting" ? "connecting" : "degraded");
            }
            break;
          case "research_progress":
            setResearchProgress((current) => [
              ...current.filter((item) => item.turnId === message.turnId && item.stage !== message.stage),
              message,
            ]);
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
            modelAudioDelivery = modelAudioDelivery
              .then(() => deliverModelAudio(message))
              .catch((cause) => {
                callbackGate.run(() => coordinator.failTurn(
                  message.turnId,
                  toErrorMessage(cause) || "Model audio playback unavailable.",
                ));
              });
            break;
          }
          case "playback_clear": {
            coordinator.clearPlayback(message.turnId);
            const speakingTurnId = speakingTurnIdRef.current;
            speakingTurnIdRef.current = speakingTurnAfterPlaybackIdle(speakingTurnId, message.turnId);
            if (speakingTurnId !== speakingTurnIdRef.current) {
              publishVoiceStatus({ geminiSpeaking: false });
            }
            if (
              message.mode === "narration"
              && (descriptionTurnIdRef.current === null || descriptionTurnIdRef.current === message.turnId)
            ) {
              descriptionTurnIdRef.current = null;
              narrationTranscriptRef.current = null;
              setDescription("");
            }
            break;
          }
          case "turn_complete": {
            modelAudioDelivery = modelAudioDelivery.then(() => {
              callbackGate.run(() => {
                setResearchProgress((current) => current.map((item) => (
                  item.turnId === message.turnId && item.stage === "synthesize" && item.status === "active"
                    ? { ...item, status: message.interrupted ? "failed" : "completed" }
                    : item
                )));
                settleTurnComplete(message);
              });
            });
            break;
          }
          case "status_text": if (message.text) setStatusText(message.text); break;
          case "narration_update":
            if (message.text) {
              descriptionTurnIdRef.current = message.turnId;
              const current = narrationTranscriptRef.current?.turnId === message.turnId
                ? narrationTranscriptRef.current.text
                : "";
              const text = mergeNarrationTranscript(current, message.text);
              narrationTranscriptRef.current = { turnId: message.turnId, text };
              setDescription(text);
            }
            break;
          case "event":
            if (message.event) {
              routeTimelineEvent(eventsRef.current, message.event, {
                answerOwnsSpeech: coordinator.answerOwnsSpeech(),
                commit: (nextEvents) => {
                  eventsRef.current = nextEvents;
                  setEvents(nextEvents);
                  setDescription(message.event!.description);
                },
                offer: (inserted) => timelineNarrator.offer(inserted),
              });
            }
            break;
          case "error": setError(message.text ?? "The realtime session reported an error."); setStatus("error"); break;
          case "analysis_error": setError(message.text ?? "The current frame could not be analyzed."); break;
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
      websocket.addEventListener("close", (event) => {
        protocol.close();
        if (!isCurrent()) return;
        releaseResources();
        setStatus("error");
        setStatusText(backendConnectionClosedStatus(event.code, event.reason));
      });
    } catch (cause) {
      if (!isCurrent()) { startupVideo?.pause(); if (startupVideo) startupVideo.srcObject = null; for (const track of startupStream?.getTracks() ?? []) track.stop(); return; }
      releaseResources();
      setStatus("error");
      setError(captureErrorMessage(cause));
      setStatusText("StreamSense could not start.");
    }
  }, [publishLiveProviderState, publishVoiceStatus, releaseResources, settleTurnComplete]);

  const ask = useCallback((question: string) => {
    const websocket = websocketRef.current;
    const coordinator = speechCoordinatorRef.current;
    if (!websocket || websocket.readyState !== WebSocket.OPEN || !coordinator) return false;
    if (!canAskRealtime(
      statusRef.current,
      voiceStateRef.current.helloAccepted,
      liveProviderStateRef.current,
    )) return false;
    timelineNarratorRef.current?.interruptForQuestion();
    return retireMicrophoneBeforeTypedAdmission(
      () => retireMicrophoneTurnRef.current?.(undefined, {
        notifyBackend: true,
        reason: "Typed question replaced the microphone turn.",
      }) ?? "none",
      () => {
        const turnId = crypto.randomUUID();
        setResearchProgress([]);
        activeTurnRef.current = createTurnRoleState(turnId, { userFinished: true });
        settlingTurnRef.current = null;
        if (settlingTurnTimerRef.current !== null) {
          window.clearTimeout(settlingTurnTimerRef.current);
          settlingTurnTimerRef.current = null;
        }
        coordinator.typedQuestionStarted(turnId);
        setError(null);
        speakingTurnIdRef.current = null;
        publishVoiceStatus({ geminiSpeaking: false });
        setMessages((current) => updateTurnChatMessages(current, { turnId, role: "user", text: question, finished: true }));
        void dispatchTypedQuestion({
          waitForFrame: () => Promise.race([
            captureFrameRef.current?.({ force: true }) ?? Promise.resolve(),
            delay(FORCED_FRAME_DEADLINE_MS),
          ]),
          isReady: () => (
            websocketRef.current === websocket
            && websocket.readyState === WebSocket.OPEN
            && speechCoordinatorRef.current === coordinator
            && canAskRealtime(
              statusRef.current,
              voiceStateRef.current.helloAccepted,
              liveProviderStateRef.current,
            )
          ),
          send: () => websocket.send(JSON.stringify({ type: "typed_question", turnId, text: question })),
          onUnavailable: () => settleTurnComplete({
            type: "turn_complete",
            turnId,
            mode: "answer",
            interrupted: true,
            retryable: true,
          }),
        });
      },
    );
  }, [publishVoiceStatus, settleTurnComplete]);

  const playResearchVoice = useCallback((sourceTurnId: string) => {
    const websocket = websocketRef.current;
    const coordinator = speechCoordinatorRef.current;
    if (
      !websocket
      || websocket.readyState !== WebSocket.OPEN
      || !coordinator
      || !canAskRealtime(
        statusRef.current,
        voiceStateRef.current.helloAccepted,
        liveProviderStateRef.current,
      )
    ) return false;
    timelineNarratorRef.current?.interruptForQuestion();
    const turnId = crypto.randomUUID();
    activeTurnRef.current = createTurnRoleState(turnId, {
      userFinished: true,
      assistantFinished: true,
    });
    settlingTurnRef.current = null;
    if (settlingTurnTimerRef.current !== null) {
      window.clearTimeout(settlingTurnTimerRef.current);
      settlingTurnTimerRef.current = null;
    }
    coordinator.typedQuestionStarted(turnId);
    setError(null);
    speakingTurnIdRef.current = null;
    publishVoiceStatus({ geminiSpeaking: false });
    websocket.send(JSON.stringify({ type: "play_research_voice", sourceTurnId, turnId }));
    return true;
  }, [publishVoiceStatus]);

  const setResearchMode = useCallback((mode: ResearchMode) => {
    researchModeRef.current = mode;
    setResearchModeState(mode);
    if (mode === "normal") setResearchProgress([]);
    const websocket = websocketRef.current;
    if (websocket?.readyState === WebSocket.OPEN) {
      websocket.send(JSON.stringify({
        type: "session_config",
        narrationLevel: narrationLevelRef.current,
        voiceNarrationMode: voiceNarrationModeRef.current,
        researchMode: mode,
      }));
    }
  }, []);

  const enableVoice = useCallback(() => {
    const retryMicrophone = retryMicrophoneRef.current;
    const microphoneState = voiceStateRef.current.microphoneState;
    if (
      !retryMicrophone
      || (microphoneState !== "denied" && microphoneState !== "degraded")
    ) {
      return false;
    }
    setError(null);
    if (microphoneState === "denied") {
      void chrome.tabs.create({ url: microphonePermissionPageUrl() });
      return true;
    }
    publishVoiceStatus({ microphoneState: "pending" });
    void retryMicrophone();
    return true;
  }, [publishVoiceStatus]);

  useEffect(() => {
    const handlePermissionGranted = (message: unknown) => {
      if (!isMicrophonePermissionGrantedMessage(message)) return;
      const retryMicrophone = retryMicrophoneRef.current;
      if (!retryMicrophone) return;
      setError(null);
      publishVoiceStatus({ microphoneState: "pending" });
      void retryMicrophone();
    };
    chrome.runtime.onMessage.addListener(handlePermissionGranted);
    return () => chrome.runtime.onMessage.removeListener(handlePermissionGranted);
  }, [publishVoiceStatus]);

  const startVoiceQuestion = useCallback(() => {
    if (!canAskRealtime(
      statusRef.current,
      voiceStateRef.current.helloAccepted,
      liveProviderStateRef.current,
    )) {
      return false;
    }
    const started = mediaAudioRef.current?.startPushToTalk() ?? false;
    if (started) setError(null);
    return started;
  }, []);

  const stopVoiceQuestion = useCallback(() => (
    mediaAudioRef.current?.stopPushToTalk() ?? false
  ), []);

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
    timelineNarratorRef.current?.setAutomaticNarrationEnabled(
      narrationLevel !== "question_only",
    );
    const websocket = websocketRef.current;
    if (websocket?.readyState === WebSocket.OPEN) websocket.send(JSON.stringify({
      type: "session_config",
      narrationLevel,
      voiceNarrationMode: voiceNarrationModeRef.current,
      researchMode: researchModeRef.current,
    }));
  }, [narrationLevel]);

  useEffect(() => {
    voiceNarrationModeRef.current = voiceNarrationMode;
    speechCoordinatorRef.current?.setVoiceNarrationMode(voiceNarrationMode);
    timelineNarratorRef.current?.setVoiceNarrationMode(voiceNarrationMode);
    const websocket = websocketRef.current;
    if (websocket?.readyState === WebSocket.OPEN) websocket.send(JSON.stringify({
      type: "session_config",
      narrationLevel: narrationLevelRef.current,
      voiceNarrationMode,
      researchMode: researchModeRef.current,
    }));
  }, [voiceNarrationMode]);

  useEffect(() => {
    const cleanup = () => releaseResources();
    window.addEventListener("pagehide", cleanup);
    return () => { window.removeEventListener("pagehide", cleanup); cleanup(); };
  }, [releaseResources]);

  const questionAvailability = questionAvailabilityFor(
    status,
    voiceStateRef.current.helloAccepted,
    liveProviderState,
  );
  const microphoneState = voiceStateRef.current.microphoneState;

  return {
    status, statusText, error, description, events, messages, voiceStatus, tabContextStatus,
    researchMode, researchProgress,
    microphoneState, activeSessionId,
    isRunning: status === "connecting" || status === "connected",
    isBusy: status === "requesting_capture",
    canStart: captureTarget.canStart,
    canAsk: questionAvailability === "ready",
    canEnableVoice: microphoneState === "denied" || microphoneState === "degraded",
    canStartVoice: questionAvailability === "ready" && microphoneState === "ready",
    questionAvailability,
    start, stop, ask, playResearchVoice, enableVoice, startVoiceQuestion, stopVoiceQuestion, setResearchMode,
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

async function consumeTabStreamId(streamId: string): Promise<MediaStream> {
  const audio = { mandatory: { chromeMediaSource: "tab", chromeMediaSourceId: streamId } } as unknown as MediaTrackConstraints;
  const video = { mandatory: { chromeMediaSource: "tab", chromeMediaSourceId: streamId, maxFrameRate: 10 } } as unknown as MediaTrackConstraints;
  return navigator.mediaDevices.getUserMedia({ audio, video });
}
