import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type MutableRefObject,
} from "react";

import type { NarrationMode } from "../context/ConfigurationContext";
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
  const [status, setStatus] = useState<RealtimeStatus>("idle");
  const [statusText, setStatusText] = useState("Ready to describe this tab.");
  const [error, setError] = useState<string | null>(null);
  const [description, setDescription] = useState(
    "Start StreamSense to describe the selected tab.",
  );
  const [events, setEvents] = useState<StreamEvent[]>([]);
  const [messages, setMessages] = useState<RealtimeChatMessage[]>([]);

  const websocketRef = useRef<WebSocket | null>(null);
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const captureVideoRef = useRef<HTMLVideoElement | null>(null);
  const captureCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const frameTimerRef = useRef<number | null>(null);
  const frameInFlightRef = useRef(false);
  const lastFrameSignatureRef = useRef<Uint8Array | null>(null);
  const captureStartedAtRef = useRef<number | null>(null);
  const stoppingRef = useRef(false);
  const stopRef = useRef<() => void>(() => undefined);
  const narrationLevelRef = useRef(narrationLevel);

  const activeNarrationRef = useRef("");
  const narrationFlushTimerRef = useRef<number | null>(null);
  const activeAnswerRef = useRef<ActiveStream | null>(null);
  const answerFlushTimerRef = useRef<number | null>(null);

  const audioContextRef = useRef<AudioContext | null>(null);
  const nextPlaybackAtRef = useRef(0);

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
      stoppingRef.current = true;

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
    async (base64Audio: string, mimeType: string) => {
      const bytes = base64ToUint8Array(base64Audio);
      const audioContext = await ensureAudioContext();

      if (!/pcm|l16/i.test(mimeType)) {
        const decoded = await audioContext.decodeAudioData(bytes.buffer.slice(0));
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
    (message: ServerMessage) => {
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
            void playModelAudio(message.data, message.mimeType).catch((cause) => {
              setError(`Could not play narration audio: ${toErrorMessage(cause)}`);
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
    setStatusText("StreamSense stopped.");
    setDescription("StreamSense is stopped. Start it to describe the active tab.");
  }, [releaseResources]);
  stopRef.current = stop;

  const startFrameLoop = useCallback(() => {
    const video = captureVideoRef.current;
    const canvas = captureCanvasRef.current;
    if (!video || !canvas) return;

    const context = canvas.getContext("2d", { alpha: false });
    if (!context) throw new Error("Unable to create the frame capture canvas.");

    frameTimerRef.current = window.setInterval(() => {
      const websocket = websocketRef.current;
      if (
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
            const currentWebSocket = websocketRef.current;
            if (!blob || currentWebSocket?.readyState !== WebSocket.OPEN) return;

            currentWebSocket.send(
              JSON.stringify({
                type: "video_frame",
                timestampSeconds: currentTimestampSeconds(
                  video,
                  captureStartedAtRef.current,
                ),
                mimeType: "image/jpeg",
                data: await blobToBase64(blob),
              }),
            );
          } finally {
            frameInFlightRef.current = false;
          }
        },
        "image/jpeg",
        0.72,
      );
    }, VIDEO_FRAME_INTERVAL_MS);
  }, []);

  const start = useCallback(async () => {
    if (websocketRef.current || status === "requesting_capture") return;

    stoppingRef.current = false;
    setStatus("requesting_capture");
    setStatusText("Capturing the active tab without the StreamSense panel.");
    setError(null);
    setEvents([]);
    setMessages([]);
    setDescription("Waiting for the first description...");
    clearStreamTimers();

    try {
      await ensureAudioContext();
      const mediaStream = await captureActiveTab();
      mediaStreamRef.current = mediaStream;

      const video = document.createElement("video");
      video.muted = true;
      video.playsInline = true;
      video.srcObject = mediaStream;
      captureVideoRef.current = video;
      captureCanvasRef.current = document.createElement("canvas");
      await video.play();
      captureStartedAtRef.current = performance.now();

      mediaStream.getVideoTracks()[0]?.addEventListener(
        "ended",
        () => stopRef.current(),
        { once: true },
      );

      const websocket = new WebSocket(
        import.meta.env.VITE_STREAMSENSE_WS_URL || DEFAULT_WEBSOCKET_URL,
      );
      websocketRef.current = websocket;
      setStatus("connecting");
      setStatusText("Connecting to the local StreamSense backend...");

      websocket.addEventListener("open", () => {
        websocket.send(JSON.stringify({ type: "capture_source", source: "screen" }));
        websocket.send(
          JSON.stringify({
            type: "session_config",
            narrationLevel: narrationLevelRef.current,
          }),
        );
        startFrameLoop();
      });
      websocket.addEventListener("message", (event) => {
        try {
          handleServerMessage(JSON.parse(String(event.data)) as ServerMessage);
        } catch {
          setError("The backend sent an invalid message.");
        }
      });
      websocket.addEventListener("error", () => {
        setError(
          "Cannot reach StreamSense at 127.0.0.1:8000. Start the Express backend first.",
        );
        setStatus("error");
      });
      websocket.addEventListener("close", () => {
        if (stoppingRef.current) return;
        releaseResources(false);
        setStatus("error");
        setStatusText("Backend connection closed.");
      });
    } catch (cause) {
      releaseResources(true);
      setStatus("error");
      setError(toErrorMessage(cause));
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

async function captureActiveTab() {
  if (typeof chrome !== "undefined" && chrome.tabCapture) {
    const [activeTab] = await chrome.tabs.query({
      active: true,
      currentWindow: true,
    });
    if (activeTab?.id === undefined) {
      throw new Error("StreamSense could not find an active browser tab to capture.");
    }

    const streamId = await chrome.tabCapture.getMediaStreamId({
      targetTabId: activeTab.id,
    });
    const video = {
      mandatory: {
        chromeMediaSource: "tab",
        chromeMediaSourceId: streamId,
        maxFrameRate: 10,
      },
    } as unknown as MediaTrackConstraints;

    return navigator.mediaDevices.getUserMedia({ audio: false, video });
  }

  // Development-page fallback. The packaged extension always uses tabCapture,
  // which prevents its side panel from appearing inside the analyzed frames.
  return navigator.mediaDevices.getDisplayMedia({
    video: {
      displaySurface: "browser",
      width: { ideal: 1920 },
      height: { ideal: 1080 },
      frameRate: { ideal: 5, max: 10 },
    },
    audio: false,
  });
}
