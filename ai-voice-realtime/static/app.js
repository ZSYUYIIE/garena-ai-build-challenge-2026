const preview = document.getElementById("preview");
const canvas = document.getElementById("frameCanvas");
const connectionEl = document.getElementById("connection");
const modeEl = document.getElementById("mode");
const levelEl = document.getElementById("level");
const telemetryEl = document.getElementById("telemetry");
const transcriptEl = document.getElementById("transcript");
const startBtn = document.getElementById("startBtn");
const stopBtn = document.getElementById("stopBtn");
const interruptToggle = document.getElementById("interruptToggle");
const questionForm = document.getElementById("questionForm");
const questionInput = document.getElementById("questionInput");

const VIDEO_INTERVAL_MS = 1000;
const AUDIO_CHUNK_MS = 100;
const SPEECH_THRESHOLD = 0.035;
const SPEECH_START_HITS = 3;
const SILENCE_AFTER_MS = 3000;

let ws;
let mediaStream;
let audioContext;
let processor;
let source;
let videoTimer;
let speechHits = 0;
let speaking = false;
let lastSpeechAt = 0;
let interruptsAllowed = false;
let activeStreamEntry = null;
let activeStreamType = null;
let activeStreamText = "";
let streamFlushTimer = null;

const STREAM_FLUSH_MS = 900;

startBtn.addEventListener("click", start);
stopBtn.addEventListener("click", stop);
interruptToggle.addEventListener("change", () => {
  interruptsAllowed = interruptToggle.checked;
  sendJson({ type: "interrupts", allowed: interruptsAllowed });
});

questionForm.addEventListener("submit", (event) => {
  event.preventDefault();
  const text = questionInput.value.trim();
  if (!text) return;
  sendJson({ type: "typed_question", text });
  questionInput.value = "";
});

async function start() {
  startBtn.disabled = true;
  stopBtn.disabled = false;
  appendEntry("system", "Starting camera and microphone...");

  mediaStream = await navigator.mediaDevices.getUserMedia({
    video: { width: { ideal: 1280 }, height: { ideal: 720 } },
    audio: {
      echoCancellation: true,
      noiseSuppression: true,
      autoGainControl: true,
    },
  });

  preview.srcObject = mediaStream;
  await preview.play();

  ws = new WebSocket(wsUrl());
  ws.addEventListener("open", () => {
    connectionEl.textContent = "Connected";
    sendJson({ type: "interrupts", allowed: interruptsAllowed });
    startVideoLoop();
    startAudioLoop();
  });
  ws.addEventListener("message", handleServerMessage);
  ws.addEventListener("close", () => {
    connectionEl.textContent = "Disconnected";
    appendEntry("system", "WebSocket closed.");
    stopMedia();
    startBtn.disabled = false;
    stopBtn.disabled = true;
  });
  ws.addEventListener("error", () => {
    appendEntry("error", "Browser WebSocket error.");
  });
}

function stop() {
  finishStreamEntry();
  appendEntry("system", "Stopping session...");
  if (wsOpen()) {
    ws.close(1000, "User stopped session");
  } else {
    stopMedia();
    connectionEl.textContent = "Disconnected";
    startBtn.disabled = false;
    stopBtn.disabled = true;
  }
  modeEl.textContent = "stopped";
  telemetryEl.textContent = "idle";
  levelEl.textContent = "mic 0.00";
}

function wsUrl() {
  const proto = window.location.protocol === "https:" ? "wss" : "ws";
  return `${proto}://${window.location.host}/ws`;
}

function startVideoLoop() {
  const ctx = canvas.getContext("2d", { alpha: false });
  videoTimer = setInterval(() => {
    if (!wsOpen() || preview.readyState < HTMLMediaElement.HAVE_CURRENT_DATA) return;

    const sourceWidth = preview.videoWidth || 640;
    const sourceHeight = preview.videoHeight || 360;
    const targetWidth = 640;
    const targetHeight = Math.round(targetWidth * (sourceHeight / sourceWidth));

    canvas.width = targetWidth;
    canvas.height = targetHeight;
    ctx.drawImage(preview, 0, 0, targetWidth, targetHeight);
    canvas.toBlob(
      async (blob) => {
        if (!blob || !wsOpen()) return;
        const data = await blobToBase64(blob);
        sendJson({ type: "video_frame", mimeType: "image/jpeg", data });
      },
      "image/jpeg",
      0.72
    );
  }, VIDEO_INTERVAL_MS);
}

async function startAudioLoop() {
  audioContext = new AudioContext();
  source = audioContext.createMediaStreamSource(mediaStream);
  processor = audioContext.createScriptProcessor(4096, 1, 1);

  let pending = [];
  let pendingMs = 0;

  processor.onaudioprocess = (event) => {
    const input = event.inputBuffer.getChannelData(0);
    const rms = rootMeanSquare(input);
    levelEl.textContent = `mic ${rms.toFixed(3)}`;

    if (!interruptsAllowed) {
      speaking = false;
      speechHits = 0;
      return;
    }

    if (rms >= SPEECH_THRESHOLD) {
      speechHits += 1;
      lastSpeechAt = performance.now();
      sendJson({ type: "speech_activity", level: rms });
      if (!speaking && speechHits >= SPEECH_START_HITS) {
        speaking = true;
        sendJson({ type: "speech_start" });
      }
    } else {
      speechHits = Math.max(0, speechHits - 1);
      if (speaking && performance.now() - lastSpeechAt > SILENCE_AFTER_MS) {
        speaking = false;
      }
    }

    if (!speaking) return;

    const pcm = resampleTo16k(input, audioContext.sampleRate);
    pending.push(pcm);
    pendingMs += (pcm.length / 16000) * 1000;

    if (pendingMs >= AUDIO_CHUNK_MS) {
      const merged = mergeInt16(pending);
      pending = [];
      pendingMs = 0;
      sendJson({
        type: "audio_chunk",
        mimeType: "audio/pcm;rate=16000",
        data: arrayBufferToBase64(merged.buffer),
      });
    }
  };

  source.connect(processor);
  processor.connect(audioContext.destination);
}

function handleServerMessage(event) {
  const message = JSON.parse(event.data);

  if (message.type === "connected") {
    connectionEl.textContent = `Connected: ${message.model}`;
    appendEntry("system", `Gemini session ready: ${message.model}`);
  } else if (message.type === "status_text") {
    appendEntry("system", message.text);
  } else if (message.type === "telemetry") {
    telemetryEl.textContent = message.text;
  } else if (message.type === "status") {
    modeEl.textContent = message.mode;
    finishStreamEntry();
  } else if (message.type === "interrupts") {
    interruptToggle.checked = message.allowed;
  } else if (message.type === "narration") {
    appendStreamChunk("narration", message.text);
  } else if (message.type === "answer") {
    appendStreamChunk("answer", message.text);
  } else if (message.type === "user_transcript") {
    finishStreamEntry();
    appendEntry("user", message.text);
  } else if (message.type === "error") {
    finishStreamEntry();
    appendEntry("error", message.text);
  }
}

function sendJson(payload) {
  if (!wsOpen()) return;
  ws.send(JSON.stringify(payload));
}

function wsOpen() {
  return ws && ws.readyState === WebSocket.OPEN;
}

function appendEntry(type, text) {
  const entry = document.createElement("div");
  entry.className = `entry ${type}`;
  const label = document.createElement("small");
  label.textContent = type;
  const body = document.createElement("div");
  body.textContent = text;
  entry.append(label, body);
  transcriptEl.append(entry);
  transcriptEl.scrollTop = transcriptEl.scrollHeight;
  return entry;
}

function appendStreamChunk(type, chunk) {
  const text = chunk.trim();
  if (!text) return;

  if (activeStreamType && activeStreamType !== type) {
    finishStreamEntry();
  }

  if (!activeStreamEntry) {
    activeStreamEntry = appendEntry(type, "");
    activeStreamType = type;
    activeStreamText = "";
  }

  activeStreamText = joinTranscriptChunk(activeStreamText, text);
  activeStreamEntry.lastElementChild.textContent = activeStreamText;
  transcriptEl.scrollTop = transcriptEl.scrollHeight;

  if (streamFlushTimer) clearTimeout(streamFlushTimer);
  streamFlushTimer = setTimeout(finishStreamEntry, STREAM_FLUSH_MS);
}

function finishStreamEntry() {
  if (streamFlushTimer) {
    clearTimeout(streamFlushTimer);
    streamFlushTimer = null;
  }
  activeStreamEntry = null;
  activeStreamType = null;
  activeStreamText = "";
}

function joinTranscriptChunk(current, next) {
  if (!current) return next;
  if (/^[,.;:!?)]/.test(next)) return `${current}${next}`;
  if (/[(]$/.test(current)) return `${current}${next}`;
  return `${current} ${next}`;
}

function rootMeanSquare(samples) {
  let sum = 0;
  for (let i = 0; i < samples.length; i += 1) {
    sum += samples[i] * samples[i];
  }
  return Math.sqrt(sum / samples.length);
}

function resampleTo16k(input, inputRate) {
  if (inputRate === 16000) return floatToInt16(input);

  const ratio = inputRate / 16000;
  const outputLength = Math.floor(input.length / ratio);
  const output = new Float32Array(outputLength);

  for (let i = 0; i < outputLength; i += 1) {
    const sourceIndex = i * ratio;
    const before = Math.floor(sourceIndex);
    const after = Math.min(before + 1, input.length - 1);
    const weight = sourceIndex - before;
    output[i] = input[before] * (1 - weight) + input[after] * weight;
  }

  return floatToInt16(output);
}

function floatToInt16(input) {
  const output = new Int16Array(input.length);
  for (let i = 0; i < input.length; i += 1) {
    const s = Math.max(-1, Math.min(1, input[i]));
    output[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
  }
  return output;
}

function mergeInt16(chunks) {
  const total = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
  const merged = new Int16Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    merged.set(chunk, offset);
    offset += chunk.length;
  }
  return merged;
}

function arrayBufferToBase64(buffer) {
  const bytes = new Uint8Array(buffer);
  let binary = "";
  for (let i = 0; i < bytes.byteLength; i += 1) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

function blobToBase64(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => resolve(String(reader.result).split(",")[1]);
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}

function stopMedia() {
  if (videoTimer) clearInterval(videoTimer);
  if (processor) processor.disconnect();
  if (source) source.disconnect();
  if (audioContext) audioContext.close();
  if (mediaStream) {
    for (const track of mediaStream.getTracks()) {
      track.stop();
    }
  }
  preview.srcObject = null;
  videoTimer = null;
  processor = null;
  source = null;
  audioContext = null;
  mediaStream = null;
  speaking = false;
  speechHits = 0;
}
