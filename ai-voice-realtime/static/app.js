const preview = document.getElementById("preview");
const canvas = document.getElementById("frameCanvas");
const connectionEl = document.getElementById("connection");
const modeEl = document.getElementById("mode");
const audioStatusEl = document.getElementById("audioStatus");
const telemetryEl = document.getElementById("telemetry");
const transcriptEl = document.getElementById("transcript");
const startBtn = document.getElementById("startBtn");
const stopBtn = document.getElementById("stopBtn");
const sourceInputs = document.querySelectorAll("input[name='captureSource']");
const questionForm = document.getElementById("questionForm");
const questionInput = document.getElementById("questionInput");

// Controls how often a sampled JPEG frame is sent to the backend/Gemini.
// 1000 means one frame per second. Lower values reduce latency but increase cost/load.
const VIDEO_FRAME_SEND_INTERVAL_MS = 1000;
const STREAM_FLUSH_MS = 900;

let ws;
let mediaStream;
let playbackContext;
let nextPlaybackAt = 0;
let playedAudioChunks = 0;
let videoTimer;
let activeStreamEntry = null;
let activeStreamType = null;
let activeStreamText = "";
let streamFlushTimer = null;

startBtn.addEventListener("click", start);
stopBtn.addEventListener("click", stop);

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
  setSourceDisabled(true);
  const source = selectedSource();
  appendEntry("system", `Starting ${source} capture...`);
  await ensurePlaybackContext();
  playTestTone();

  try {
    mediaStream = await captureStream(source);
  } catch (error) {
    appendEntry("error", `Could not start ${source} capture: ${error.message}`);
    startBtn.disabled = false;
    stopBtn.disabled = true;
    setSourceDisabled(false);
    return;
  }

  mediaStream.getVideoTracks()[0]?.addEventListener("ended", () => {
    if (wsOpen()) {
      ws.close(1000, "Capture source ended");
    } else {
      stopMedia();
      startBtn.disabled = false;
      stopBtn.disabled = true;
      setSourceDisabled(false);
    }
  });

  preview.srcObject = mediaStream;
  await preview.play();

  ws = new WebSocket(wsUrl());
  ws.addEventListener("open", () => {
    connectionEl.textContent = "Connected";
    startVideoLoop();
  });
  ws.addEventListener("message", handleServerMessage);
  ws.addEventListener("close", () => {
    connectionEl.textContent = "Disconnected";
    appendEntry("system", "WebSocket closed.");
    stopMedia();
    startBtn.disabled = false;
    stopBtn.disabled = true;
    setSourceDisabled(false);
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
    setSourceDisabled(false);
  }
  modeEl.textContent = "stopped";
  telemetryEl.textContent = "idle";
  audioStatusEl.textContent = "audio idle";
}

function selectedSource() {
  return document.querySelector("input[name='captureSource']:checked")?.value || "camera";
}

function setSourceDisabled(disabled) {
  for (const input of sourceInputs) {
    input.disabled = disabled;
  }
}

async function captureStream(source) {
  if (source === "screen") {
    if (!navigator.mediaDevices.getDisplayMedia) {
      throw new Error("Screen capture is not supported by this browser.");
    }
    return navigator.mediaDevices.getDisplayMedia({
      video: {
        width: { ideal: 1920 },
        height: { ideal: 1080 },
        frameRate: { ideal: 5, max: 10 },
      },
      audio: false,
    });
  }

  return navigator.mediaDevices.getUserMedia({
    video: { width: { ideal: 1280 }, height: { ideal: 720 } },
    audio: false,
  });
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
  }, VIDEO_FRAME_SEND_INTERVAL_MS);
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
  } else if (message.type === "narration") {
    appendStreamChunk("narration", message.text);
  } else if (message.type === "answer") {
    appendStreamChunk("answer", message.text);
  } else if (message.type === "model_audio") {
    playModelAudio(message.data, message.mimeType);
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
  if (playbackContext) playbackContext.close();
  if (mediaStream) {
    for (const track of mediaStream.getTracks()) {
      track.stop();
    }
  }
  preview.srcObject = null;
  videoTimer = null;
  playbackContext = null;
  nextPlaybackAt = 0;
  playedAudioChunks = 0;
  mediaStream = null;
}

async function playModelAudio(base64Audio, mimeType) {
  const sampleRate = parsePcmRate(mimeType) || 24000;
  const bytes = base64ToUint8Array(base64Audio);
  audioStatusEl.textContent = `audio rx ${bytes.byteLength}b ${mimeType || ""}`;

  if (!/pcm|l16/i.test(mimeType || "")) {
    playEncodedAudio(bytes);
    return;
  }

  const pcm = bytesToInt16(bytes);
  if (!pcm.length) return;

  await ensurePlaybackContext();

  const buffer = playbackContext.createBuffer(1, pcm.length, sampleRate);
  const channel = buffer.getChannelData(0);
  for (let i = 0; i < pcm.length; i += 1) {
    channel[i] = Math.max(-1, Math.min(1, pcm[i] / 32768));
  }

  const node = playbackContext.createBufferSource();
  node.buffer = buffer;
  node.connect(playbackContext.destination);

  const startAt = Math.max(playbackContext.currentTime + 0.03, nextPlaybackAt);
  node.start(startAt);
  nextPlaybackAt = startAt + buffer.duration;
  playedAudioChunks += 1;
  audioStatusEl.textContent = `audio queued ${playedAudioChunks}`;
}

async function ensurePlaybackContext() {
  if (!playbackContext || playbackContext.state === "closed") {
    playbackContext = new AudioContext();
    nextPlaybackAt = playbackContext.currentTime;
  }
  if (playbackContext.state === "suspended") {
    await playbackContext.resume();
  }
}

function playTestTone() {
  if (!playbackContext) return;
  const oscillator = playbackContext.createOscillator();
  const gain = playbackContext.createGain();
  oscillator.frequency.value = 660;
  gain.gain.setValueAtTime(0.0001, playbackContext.currentTime);
  gain.gain.exponentialRampToValueAtTime(0.06, playbackContext.currentTime + 0.01);
  gain.gain.exponentialRampToValueAtTime(0.0001, playbackContext.currentTime + 0.16);
  oscillator.connect(gain);
  gain.connect(playbackContext.destination);
  oscillator.start();
  oscillator.stop(playbackContext.currentTime + 0.18);
  audioStatusEl.textContent = `audio ${playbackContext.state}`;
}

async function playEncodedAudio(bytes) {
  await ensurePlaybackContext();
  try {
    const decoded = await playbackContext.decodeAudioData(bytes.buffer.slice(0));
    const node = playbackContext.createBufferSource();
    node.buffer = decoded;
    node.connect(playbackContext.destination);
    const startAt = Math.max(playbackContext.currentTime + 0.03, nextPlaybackAt);
    node.start(startAt);
    nextPlaybackAt = startAt + decoded.duration;
    playedAudioChunks += 1;
    audioStatusEl.textContent = `encoded audio queued ${playedAudioChunks}`;
  } catch (error) {
    audioStatusEl.textContent = "audio decode failed";
    appendEntry("error", `Could not decode model audio: ${error.message}`);
  }
}

function parsePcmRate(mimeType) {
  const match = /rate=(\d+)/i.exec(mimeType || "");
  return match ? Number(match[1]) : null;
}

function bytesToInt16(bytes) {
  const sampleCount = Math.floor(bytes.byteLength / 2);
  const pcm = new Int16Array(sampleCount);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  for (let i = 0; i < sampleCount; i += 1) {
    pcm[i] = view.getInt16(i * 2, true);
  }
  return pcm;
}

function base64ToUint8Array(base64) {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}
