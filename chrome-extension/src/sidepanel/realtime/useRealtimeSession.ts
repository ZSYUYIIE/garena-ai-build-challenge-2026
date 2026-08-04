import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type MutableRefObject,
} from "react";

import {
  beginAuthorizedCapture,
  captureErrorMessage,
  isCaptureAuthorizationError,
  targetChangeRequiresReset,
} from "../../services/captureTarget";
import type { NarrationMode } from "../context/ConfigurationContext";
import {
  createSessionGenerationGuard,
  shouldSyncIdleGuidance,
} from "./sessionLifecycle";
import { useCaptureTarget } from "./useCaptureTarget";
import type {
  RealtimeChatMessage,
  RealtimeStatus,
  ServerMessage,
  StreamEvent,
} from "./types";

const VIDEO_FRAME_INTERVAL_MS = 1_000;
const STREAM_FLUSH_MS = 900;
const DEFAULT_WEBSOCKET_URL = "ws://127.0.0.1:8000/ws";

type ActiveStream = {
  id: string;
  text: string;
};

export function useRealtimeSession(narrationLevel: NarrationMode) {
  const captureTarget = useCaptureTarget();
  const captureTargetRef = useRef(captureTarget);
  captureTargetRef.current = captureTarget;

  const [status, setStatus] = useState<RealtimeStatus>("idle");
  const [statusText, setStatusText] = useState("Ready to describe this tab.");
  const [error, setError] = useState<string | null>(null);
  const [description, setDescription] = useState(
    "Start StreamSense to describe the selected tab.",
  );
  const [events, setEvents] = useState<StreamEvent[]>([]);
  const [messages, setMessages] = useState<RealtimeChatMessage[]>([]);
  const statusRef = useRef(status);
  statusRef.current = status;
  const errorRef = useRef(error);
  errorRef.current = error;

  const websocketRef = useRef<WebSocket | null>(null);
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const captureVideoRef = useRef<HTMLVideoElement | null>(null);
  const captureCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const frameTimerRef = useRef<number | null>(null);
  const frameInFlightRef = useRef(false);
  const lastFrameSignatureRef = useRef<Uint8Array | null>(null);
  const captureStartedAtRef = useRef<number | null>(null);
  const capturedTabIdRef = useRef<number | null>(null);
  const sessionGenerationRef = useRef(createSessionGenerationGuard());
  const startingRef = useRef(false);
  const stopRef = useRef<() => void>(() => undefined);
  const narrationLevelRef = useRef(narrationLevel);

  const activeNarrationRef = useRef("");
  const narrationFlushTimerRef = useRef<number | null>(null);
  const activeAnswerRef = useRef<ActiveStream | null>(null);
  const answerFlushTimerRef = useRef<number | null>(null);

  const audioContextRef = useRef<AudioContext | null>(null);
  const nextPlaybackAtRef = useRef(0);
  const observedGuidanceRef = useRef<string | null>(null);

  const clearStreamTimers = useCallback(() => {
    if (narrationFlushTimerRef.current !== null) {
      window.clearTimeout(narrationFlushTimerRef.current);
      narrationFlushTimerRef.current = null;
    }
    if (answerFlushTimerRef.current !== null) {
      window.clearTimeout(answerFlushTimerRef.current);
      answerFlushTimerRef.current = null;
    }
    activeNarrationRef.current = "";
    activeAnswerRef.current = null;
  }, []);

  const releaseResources = useCallback(
    (closeWebSocket: boolean) => {
      sessionGenerationRef.current.invalidate();
      startingRef.current = false;

      if (frameTimerRef.current !== null) {
        window.clearInterval(frameTimerRef.current);
        frameTimerRef.current = null;
      }
      frameInFlightRef.current = false;
      lastFrameSignatureRef.current = null;

      const websocket = websocketRef.current;
      websocketRef.current = null;
      if (
        closeWebSocket &&
        websocket &&
        (websocket.readyState === WebSocket.OPEN ||
          websocket.readyState === WebSocket.CONNECTING)
      ) {
        websocket.close(1000, "Extension session stopped");
      }

      for (const track of mediaStreamRef.current?.getTracks() ?? []) {
        track.stop();
      }
      mediaStreamRef.current = null;

      if (captureVideoRef.current) {
        captureVideoRef.current.pause();
        captureVideoRef.current.srcObject = null;
      }
      captureVideoRef.current = null;
      captureCanvasRef.current = null;
      captureStartedAtRef.current = null;
      capturedTabIdRef.current = null;

      if (audioContextRef.current) {
        void audioContextRef.current.close();
      }
      window.speechSynthesis?.cancel();
      audioContextRef.current = null;
      nextPlaybackAtRef.current = 0;
      clearStreamTimers();
    },
    [clearStreamTimers],
  );

  const ensureAudioContext = useCallback(async () => {
    let audioContext = audioContextRef.current;
    if (!audioContext || audioContext.state === "closed") {
      audioContext = new AudioContext();
      audioContextRef.current = audioContext;
      nextPlaybackAtRef.current = audioContext.currentTime;
    }
    if (audioContext.state === "suspended") {
      await audioContext.resume();
    }
    return audioContext;
  }, []);

  const playModelAudio = useCallback(
    async (
      base64Audio: string,
      mimeType: string,
      isCurrentSession: () => boolean,
    ) => {
      const bytes = base64ToUint8Array(base64Audio);
      const audioContext = await ensureAudioContext();
      if (!isCurrentSession()) return;

      if (!/pcm|l16/i.test(mimeType)) {
        const decoded = await audioContext.decodeAudioData(bytes.buffer.slice(0));
        if (!isCurrentSession()) return;
        scheduleAudioBuffer(audioContext, decoded, nextPlaybackAtRef);
        return;
      }

      const sampleRate = parsePcmRate(mimeType) ?? 24_000;
      const pcm = bytesToInt16(bytes);
      if (!pcm.length) return;

      const buffer = audioContext.createBuffer(1, pcm.length, sampleRate);
      const channel = buffer.getChannelData(0);
      for (let index = 0; index < pcm.length; index += 1) {
        channel[index] = Math.max(-1, Math.min(1, pcm[index] / 32_768));
      }
      scheduleAudioBuffer(audioContext, buffer, nextPlaybackAtRef);
    },
    [ensureAudioContext],
  );

  const speakExactText = useCallback((text: string) => {
    const cleanText = text.trim();
    if (!cleanText || !window.speechSynthesis) return;

    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(cleanText);
    utterance.rate = 1;
    utterance.pitch = 1;
    window.speechSynthesis.speak(utterance);
  }, []);

  const appendNarration = useCallback((chunk: string) => {
    const cleanChunk = chunk.trim();
    if (!cleanChunk) return;

    activeNarrationRef.current = joinStreamChunk(
      activeNarrationRef.current,
      cleanChunk,
    );
    setDescription(activeNarrationRef.current);

    if (narrationFlushTimerRef.current !== null) {
      window.clearTimeout(narrationFlushTimerRef.current);
    }
    narrationFlushTimerRef.current = window.setTimeout(() => {
      activeNarrationRef.current = "";
      narrationFlushTimerRef.current = null;
    }, STREAM_FLUSH_MS);
  }, []);

  const appendAnswer = useCallback((chunk: string) => {
    const cleanChunk = chunk.trim();
    if (!cleanChunk) return;

    let activeAnswer = activeAnswerRef.current;
    if (!activeAnswer) {
      const newAnswer = { id: crypto.randomUUID(), text: cleanChunk };
      activeAnswer = newAnswer;
      activeAnswerRef.current = newAnswer;
      setMessages((current) => [
        ...current,
        { id: newAnswer.id, role: "assistant", text: cleanChunk },
      ]);
    } else {
      activeAnswer.text = joinStreamChunk(activeAnswer.text, cleanChunk);
      const nextText = activeAnswer.text;
      const activeId = activeAnswer.id;
      setMessages((current) =>
        current.map((message) =>
          message.id === activeId ? { ...message, text: nextText } : message,
        ),
      );
    }

    if (answerFlushTimerRef.current !== null) {
      window.clearTimeout(answerFlushTimerRef.current);
    }
    answerFlushTimerRef.current = window.setTimeout(() => {
      activeAnswerRef.current = null;
      answerFlushTimerRef.current = null;
    }, STREAM_FLUSH_MS);
  }, []);

  const replaceAnswer = useCallback((text: string) => {
    const cleanText = text.trim();
    if (!cleanText) return;

    const activeAnswer = activeAnswerRef.current;
    if (!activeAnswer) {
      const newAnswer = { id: crypto.randomUUID(), text: cleanText };
      activeAnswerRef.current = newAnswer;
      setMessages((current) => [
        ...current,
        { id: newAnswer.id, role: "assistant", text: cleanText },
      ]);
      return;
    }

    activeAnswer.text = cleanText;
    setMessages((current) =>
      current.map((message) =>
        message.id === activeAnswer.id
          ? { ...message, text: cleanText }
          : message,
      ),
    );
  }, []);

  const handleServerMessage = useCallback(
    (message: ServerMessage, isCurrentSession: () => boolean) => {
      switch (message.type) {
        case "connected":
          setStatus("connected");
          setStatusText(`Connected to ${message.model ?? "Gemini vision"}.`);
          setError(null);
          break;
        case "status_text":
          if (message.text) setStatusText(message.text);
          break;
        case "narration":
          if (message.text) appendNarration(message.text);
          break;
        case "narration_update":
          if (message.text) {
            activeNarrationRef.current = message.text;
            setDescription(message.text);
            speakExactText(message.text);
          }
          break;
        case "answer":
          if (message.text) appendAnswer(message.text);
          break;
        case "answer_update":
          if (message.text) {
            replaceAnswer(message.text);
            speakExactText(message.text);
          }
          break;
        case "user_transcript":
          if (message.text) {
            activeAnswerRef.current = null;
            setMessages((current) => [
              ...current,
              { id: crypto.randomUUID(), role: "user", text: message.text! },
            ]);
          }
          break;
        case "event":
          if (message.event) {
            setEvents((current) => {
              if (current.some((event) => event.id === message.event!.id)) {
                return current;
              }
              return [message.event!, ...current].slice(0, 100);
            });
          }
          break;
        case "model_audio":
          if (message.data && message.mimeType) {
            void playModelAudio(
              message.data,
              message.mimeType,
              isCurrentSession,
            ).catch((cause) => {
              if (isCurrentSession()) {
                setError(`Could not play narration audio: ${toErrorMessage(cause)}`);
              }
            });
          }
          break;
        case "status":
          if (message.mode === "narrating") activeAnswerRef.current = null;
          break;
        case "turn_complete":
          activeNarrationRef.current = "";
          activeAnswerRef.current = null;
          break;
        case "turn_started":
        case "telemetry":
          // These messages are part of the protocol but do not change panel state.
          break;
        case "error":
          setError(message.text ?? "The realtime session reported an error.");
          setStatus("error");
          break;
        case "analysis_error":
          setError(message.text ?? "The current frame could not be analyzed.");
          break;
      }
    },
    [appendAnswer, appendNarration, playModelAudio, replaceAnswer, speakExactText],
  );

  const stop = useCallback(() => {
    releaseResources(true);
    setStatus("idle");
    const targetSnapshot = captureTargetRef.current;
    setStatusText(
      targetSnapshot.canStart
        ? "StreamSense stopped."
        : targetSnapshot.guidance,
    );
    setDescription("StreamSense is stopped. Start it to describe the active tab.");
  }, [releaseResources]);
  stopRef.current = stop;

  const startFrameLoop = useCallback((generation: number) => {
    if (!sessionGenerationRef.current.isCurrent(generation)) return;
    const video = captureVideoRef.current;
    const canvas = captureCanvasRef.current;
    if (!video || !canvas) return;

    const context = canvas.getContext("2d", { alpha: false });
    if (!context) throw new Error("Unable to create the frame capture canvas.");

    frameTimerRef.current = window.setInterval(() => {
      const websocket = websocketRef.current;
      if (
        !sessionGenerationRef.current.isCurrent(generation) ||
        frameInFlightRef.current ||
        !websocket ||
        websocket.readyState !== WebSocket.OPEN ||
        video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA
      ) {
        return;
      }

      const sourceWidth = video.videoWidth || 640;
      const sourceHeight = video.videoHeight || 360;
      const targetWidth = 640;
      const targetHeight = Math.round(targetWidth * (sourceHeight / sourceWidth));
      canvas.width = targetWidth;
      canvas.height = targetHeight;
      context.drawImage(video, 0, 0, targetWidth, targetHeight);

      const frameSignature = createFrameSignature(
        context,
        targetWidth,
        targetHeight,
      );
      if (
        !hasMeaningfulVisualChange(
          lastFrameSignatureRef.current,
          frameSignature,
        )
      ) {
        return;
      }
      lastFrameSignatureRef.current = frameSignature;

      frameInFlightRef.current = true;
      canvas.toBlob(
        async (blob) => {
          try {
            if (
              !sessionGenerationRef.current.isCurrent(generation) ||
              !blob ||
              websocket.readyState !== WebSocket.OPEN
            ) {
              return;
            }
            const timestampSeconds = currentTimestampSeconds(
              video,
              captureStartedAtRef.current,
            );
            const data = await blobToBase64(blob);
            if (
              !sessionGenerationRef.current.isCurrent(generation) ||
              websocket.readyState !== WebSocket.OPEN
            ) {
              return;
            }

            websocket.send(
              JSON.stringify({
                type: "video_frame",
                timestampSeconds,
                mimeType: "image/jpeg",
                data,
              }),
            );
          } finally {
            if (sessionGenerationRef.current.isCurrent(generation)) {
              frameInFlightRef.current = false;
            }
          }
        },
        "image/jpeg",
        0.72,
      );
    }, VIDEO_FRAME_INTERVAL_MS);
  }, []);

  const start = useCallback(async () => {
    if (
      websocketRef.current ||
      startingRef.current ||
      status === "requesting_capture"
    ) {
      return;
    }

    const targetSnapshot = captureTargetRef.current;
    if (
      targetSnapshot.target?.status !== "ready" ||
      targetSnapshot.target.tabId !== targetSnapshot.activeTabId
    ) {
      setError(targetSnapshot.guidance);
      setStatusText(targetSnapshot.guidance);
      return;
    }

    const target = targetSnapshot.target;
    const generation = sessionGenerationRef.current.begin();
    startingRef.current = true;
    const mediaStreamPromise = beginAuthorizedCapture(target, {
      requestStreamId: (options) => chrome.tabCapture.getMediaStreamId(options),
      ensureAudioReady: ensureAudioContext,
      isCurrent: () => sessionGenerationRef.current.isCurrent(generation),
      consumeStreamId: consumeTabStreamId,
    });
    capturedTabIdRef.current = target.tabId;

    setStatus("requesting_capture");
    setStatusText("Capturing the active tab without the StreamSense panel.");
    setError(null);
    setEvents([]);
    setMessages([]);
    setDescription("Waiting for the first description...");
    clearStreamTimers();

    let startupStream: MediaStream | null = null;
    let startupVideo: HTMLVideoElement | null = null;
    try {
      const mediaStream = await mediaStreamPromise;
      startupStream = mediaStream;
      if (!sessionGenerationRef.current.isCurrent(generation)) {
        for (const track of mediaStream.getTracks()) {
          track.stop();
        }
        return;
      }
      mediaStreamRef.current = mediaStream;

      const video = document.createElement("video");
      video.muted = true;
      video.playsInline = true;
      video.srcObject = mediaStream;
      startupVideo = video;
      captureVideoRef.current = video;
      captureCanvasRef.current = document.createElement("canvas");
      await video.play();
      if (!sessionGenerationRef.current.isCurrent(generation)) {
        video.pause();
        video.srcObject = null;
        for (const track of mediaStream.getTracks()) {
          track.stop();
        }
        return;
      }
      captureStartedAtRef.current = performance.now();

      mediaStream.getVideoTracks()[0]?.addEventListener(
        "ended",
        () => {
          if (sessionGenerationRef.current.isCurrent(generation)) {
            stopRef.current();
          }
        },
        { once: true },
      );

      const websocket = new WebSocket(
        import.meta.env.VITE_STREAMSENSE_WS_URL || DEFAULT_WEBSOCKET_URL,
      );
      websocketRef.current = websocket;
      startingRef.current = false;
      setStatus("connecting");
      setStatusText("Connecting to the local StreamSense backend...");

      websocket.addEventListener("open", () => {
        if (!sessionGenerationRef.current.isCurrent(generation)) {
          websocket.close(1000, "Stale extension session");
          return;
        }
        websocket.send(JSON.stringify({ type: "capture_source", source: "screen" }));
        websocket.send(
          JSON.stringify({
            type: "session_config",
            narrationLevel: narrationLevelRef.current,
          }),
        );
        startFrameLoop(generation);
      });
      websocket.addEventListener("message", (event) => {
        if (!sessionGenerationRef.current.isCurrent(generation)) return;
        try {
          handleServerMessage(
            JSON.parse(String(event.data)) as ServerMessage,
            () => sessionGenerationRef.current.isCurrent(generation),
          );
        } catch {
          setError("The backend sent an invalid message.");
        }
      });
      websocket.addEventListener("error", () => {
        if (!sessionGenerationRef.current.isCurrent(generation)) return;
        setError(
          "Cannot reach StreamSense at 127.0.0.1:8000. Start the Express backend first.",
        );
        setStatus("error");
      });
      websocket.addEventListener("close", () => {
        if (!sessionGenerationRef.current.isCurrent(generation)) return;
        releaseResources(false);
        setStatus("error");
        setStatusText("Backend connection closed.");
      });
    } catch (cause) {
      if (!sessionGenerationRef.current.isCurrent(generation)) {
        startupVideo?.pause();
        if (startupVideo) startupVideo.srcObject = null;
        for (const track of startupStream?.getTracks() ?? []) {
          track.stop();
        }
        return;
      }
      releaseResources(true);
      setStatus("error");
      setError(captureErrorMessage(cause));
      setStatusText("StreamSense could not start.");
    }
  }, [
    clearStreamTimers,
    ensureAudioContext,
    handleServerMessage,
    releaseResources,
    startFrameLoop,
    status,
  ]);

  useEffect(() => {
    if (
      !targetChangeRequiresReset(
        capturedTabIdRef.current,
        captureTarget.target,
      )
    ) {
      return;
    }

    stopRef.current();
    setError(null);
    setStatusText(
      captureTarget.canStart
        ? "Capture target changed. Start StreamSense again."
        : captureTarget.guidance,
    );
  }, [captureTarget.target]);

  useEffect(() => {
    const previousGuidance = observedGuidanceRef.current;
    observedGuidanceRef.current = captureTarget.guidance;

    const authorizationRecovered =
      captureTarget.canStart &&
      isCaptureAuthorizationError(errorRef.current);
    if (authorizationRecovered) {
      setError(null);
      setStatus("idle");
      setStatusText(captureTarget.guidance);
    }
    if (
      !authorizationRecovered &&
      shouldSyncIdleGuidance(
        statusRef.current === "idle",
        previousGuidance,
        captureTarget.guidance,
      )
    ) {
      setStatusText(captureTarget.guidance);
    }
  }, [captureTarget.canStart, captureTarget.guidance, captureTarget.target]);

  const ask = useCallback((question: string) => {
    const websocket = websocketRef.current;
    if (websocket?.readyState !== WebSocket.OPEN) return false;
    websocket.send(JSON.stringify({ type: "typed_question", text: question }));
    return true;
  }, []);

  useEffect(() => {
    narrationLevelRef.current = narrationLevel;
    const websocket = websocketRef.current;
    if (websocket?.readyState === WebSocket.OPEN) {
      websocket.send(
        JSON.stringify({ type: "session_config", narrationLevel }),
      );
    }
  }, [narrationLevel]);

  useEffect(() => () => releaseResources(true), [releaseResources]);

  return {
    status,
    statusText,
    error,
    description,
    events,
    messages,
    isRunning: status === "connecting" || status === "connected",
    isBusy: status === "requesting_capture",
    canStart: captureTarget.canStart,
    canAsk: status === "connected",
    start,
    stop,
    ask,
  };
}

function joinStreamChunk(current: string, next: string) {
  if (!current) return next;
  if (/^[,.;:!?)]/.test(next) || /[(]$/.test(current)) return `${current}${next}`;
  return `${current} ${next}`;
}

function currentTimestampSeconds(
  video: HTMLVideoElement,
  captureStartedAt: number | null,
) {
  if (Number.isFinite(video.currentTime) && video.currentTime > 0) {
    return Math.round(video.currentTime * 1_000) / 1_000;
  }
  if (captureStartedAt !== null) {
    return Math.round(performance.now() - captureStartedAt) / 1_000;
  }
  return 0;
}

function blobToBase64(blob: Blob) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => resolve(String(reader.result).split(",")[1] ?? "");
    reader.onerror = () => reject(reader.error ?? new Error("Frame encoding failed."));
    reader.readAsDataURL(blob);
  });
}

function base64ToUint8Array(base64: string) {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}

function bytesToInt16(bytes: Uint8Array) {
  const sampleCount = Math.floor(bytes.byteLength / 2);
  const pcm = new Int16Array(sampleCount);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  for (let index = 0; index < sampleCount; index += 1) {
    pcm[index] = view.getInt16(index * 2, true);
  }
  return pcm;
}

function parsePcmRate(mimeType: string) {
  const match = /rate=(\d+)/i.exec(mimeType);
  return match ? Number(match[1]) : null;
}

function scheduleAudioBuffer(
  audioContext: AudioContext,
  buffer: AudioBuffer,
  nextPlaybackAtRef: MutableRefObject<number>,
) {
  const source = audioContext.createBufferSource();
  source.buffer = buffer;
  source.connect(audioContext.destination);
  const startAt = Math.max(
    audioContext.currentTime + 0.03,
    nextPlaybackAtRef.current,
  );
  source.start(startAt);
  nextPlaybackAtRef.current = startAt + buffer.duration;
}

function toErrorMessage(cause: unknown) {
  if (cause instanceof Error) return cause.message;
  return String(cause);
}

function createFrameSignature(
  context: CanvasRenderingContext2D,
  width: number,
  height: number,
) {
  const columns = 48;
  const rows = Math.max(1, Math.round(columns * (height / width)));
  const pixels = context.getImageData(0, 0, width, height).data;
  const signature = new Uint8Array(columns * rows);

  for (let row = 0; row < rows; row += 1) {
    const y = Math.min(height - 1, Math.floor(((row + 0.5) / rows) * height));
    for (let column = 0; column < columns; column += 1) {
      const x = Math.min(
        width - 1,
        Math.floor(((column + 0.5) / columns) * width),
      );
      const pixelIndex = (y * width + x) * 4;
      signature[row * columns + column] = Math.round(
        pixels[pixelIndex] * 0.2126 +
          pixels[pixelIndex + 1] * 0.7152 +
          pixels[pixelIndex + 2] * 0.0722,
      );
    }
  }
  return signature;
}

function hasMeaningfulVisualChange(
  previous: Uint8Array | null,
  current: Uint8Array,
) {
  if (!previous || previous.length !== current.length) return true;

  let changedSamples = 0;
  let totalDifference = 0;
  for (let index = 0; index < current.length; index += 1) {
    const difference = Math.abs(current[index] - previous[index]);
    totalDifference += difference;
    if (difference >= 18) changedSamples += 1;
  }

  const changedRatio = changedSamples / current.length;
  const averageDifference = totalDifference / current.length;
  return changedRatio >= 0.012 || averageDifference >= 5;
}

async function consumeTabStreamId(streamId: string) {
  const video = {
    mandatory: {
      chromeMediaSource: "tab",
      chromeMediaSourceId: streamId,
      maxFrameRate: 10,
    },
  } as unknown as MediaTrackConstraints;

  return navigator.mediaDevices.getUserMedia({ audio: false, video });
}
