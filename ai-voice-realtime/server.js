import "dotenv/config";

import express from "express";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { WebSocket, WebSocketServer } from "ws";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const GOOGLE_API_KEY = process.env.GOOGLE_API_KEY || "";
const GEMINI_MODEL =
  process.env.GEMINI_LIVE_MODEL || "gemini-3.1-flash-live-preview";
const GEMINI_WS_URL =
  "wss://generativelanguage.googleapis.com/ws/" +
  "google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContent" +
  `?key=${GOOGLE_API_KEY}`;

const PORT = Number(process.env.PORT || 8000);
const HOST = process.env.HOST || "127.0.0.1";

const CAMERA_NARRATION_TICK_SECONDS = 4.0;
const SCREEN_NARRATION_TICK_SECONDS = 3.0;
const GEMINI_SETUP_TIMEOUT_MS = 10_000;

const Mode = Object.freeze({
  NARRATING: "narrating",
  ANSWERING: "answering",
});

const app = express();
const server = http.createServer(app);
const browserWss = new WebSocketServer({ server, path: "/ws" });

app.use("/static", express.static(path.join(__dirname, "static")));

app.get("/", (_req, res) => {
  res.sendFile(path.join(__dirname, "static", "index.html"));
});

app.get("/favicon.ico", (_req, res) => {
  res.status(204).end();
});

browserWss.on("connection", (browser) => {
  const session = new ClientSession(browser);
  session.start().catch((error) => {
    session.sendBrowser({ type: "error", text: error.message });
    session.close();
  });
});

server.listen(PORT, HOST, () => {
  console.log(`Server running on http://${HOST}:${PORT}`);
});

server.on("error", (error) => {
  console.error(`Failed to start server on http://${HOST}:${PORT}: ${error.message}`);
  process.exitCode = 1;
});

class ClientSession {
  constructor(browser) {
    this.browser = browser;
    this.gemini = null;
    this.mode = Mode.NARRATING;
    this.closed = false;
    this.geminiReady = false;
    this.firstVideoFrame = false;
    this.videoFrames = 0;
    this.modelAudioChunks = 0;
    this.captureSource = "camera";
    this.pendingScreenModeInstruction = false;
    this.narrationTimer = null;
    this.waitingForFirstFrameResolvers = [];
  }

  async start() {
    if (!GOOGLE_API_KEY) {
      this.sendBrowser({
        type: "error",
        text: "Missing GOOGLE_API_KEY. Add it to .env or export it in your shell.",
      });
      this.closeSoon();
      return;
    }

    this.sendBrowser({
      type: "status_text",
      text: "Connecting to Gemini Live...",
    });

    this.attachBrowserHandlers();
    await this.connectGemini();

    if (this.pendingScreenModeInstruction) {
      this.sendScreenModeInstruction();
    }

    this.sendBrowser({
      type: "status_text",
      text: `Waiting for the first ${this.captureSource} frame...`,
    });
    this.sendBrowser({ type: "status", mode: this.mode });
    this.startNarrationLoop();
  }

  async connectGemini() {
    this.gemini = new WebSocket(GEMINI_WS_URL, {
      perMessageDeflate: false,
      maxPayload: 16 * 1024 * 1024,
    });

    this.gemini.on("message", (raw) => this.handleGeminiMessage(raw));
    this.gemini.on("close", (code, reason) => {
      if (!this.closed) {
        const suffix = reason?.length ? `: ${reason.toString()}` : "";
        this.sendBrowser({
          type: "error",
          text: `Gemini connection closed (${code})${suffix}`,
        });
      }
      this.close();
    });
    this.gemini.on("error", (error) => {
      this.sendBrowser({ type: "error", text: `Gemini error: ${error.message}` });
      this.close();
    });

    await waitForOpen(this.gemini);
    this.sendGemini(this.geminiSetup());

    await waitUntil(
      () => this.geminiReady || this.closed,
      GEMINI_SETUP_TIMEOUT_MS
    );

    if (!this.geminiReady) {
      this.sendBrowser({
        type: "error",
        text:
          "Gemini Live did not finish setup. Check the API key, " +
          `model access, and model name: ${GEMINI_MODEL}.`,
      });
      this.closeSoon();
    }
  }

  attachBrowserHandlers() {
    this.browser.on("message", (raw, isBinary) => {
      if (isBinary) {
        this.sendVideo(Buffer.from(raw), "image/jpeg");
        return;
      }

      let message;
      try {
        message = JSON.parse(raw.toString());
      } catch {
        this.sendBrowser({ type: "error", text: "Invalid browser message JSON." });
        return;
      }
      this.handleBrowserJson(message);
    });

    this.browser.on("close", () => this.close());
    this.browser.on("error", () => this.close());
  }

  geminiSetup() {
    return {
      setup: {
        model: `models/${GEMINI_MODEL}`,
        generationConfig: {
          responseModalities: ["AUDIO"],
          temperature: 0.4,
          maxOutputTokens: 240,
          speechConfig: {
            voiceConfig: {
              prebuiltVoiceConfig: {
                voiceName: "Puck",
              },
            },
          },
        },
        outputAudioTranscription: {},
        systemInstruction: {
          parts: [
            {
              text:
                "You are a live video narrator and question-answering assistant. " +
                "Default behavior: briefly describe meaningful visual changes in the " +
                "live camera feed. Avoid repeating unchanged details. When the user " +
                "asks a typed question, answer directly using the current video when " +
                "useful, then return to concise passive narration. In screen capture " +
                "mode, briefly describe the visible screen content, not the user's " +
                "interaction mechanics. Name the page, app, video, panel, or main " +
                "visible content. Do not say scrolling, clicked, loading, or playback " +
                "continues unless that is the main visible change.",
            },
          ],
        },
      },
    };
  }

  handleBrowserJson(message) {
    const kind = message.type;

    if (kind === "capture_source") {
      const source = message.source;
      if (source === "camera" || source === "screen") {
        this.captureSource = source;
        if (source === "screen") {
          this.pendingScreenModeInstruction = true;
          if (this.geminiReady) {
            this.sendScreenModeInstruction();
          }
        }
        this.sendBrowser({
          type: "telemetry",
          text: `${source} narration every ${this.narrationTickSeconds}s`,
        });
      }
      return;
    }

    if (kind === "video_frame") {
      this.sendVideo(
        Buffer.from(message.data || "", "base64"),
        message.mimeType || "image/jpeg"
      );
      return;
    }

    if (kind === "typed_question") {
      this.answerTextQuestion(message.text || "");
    }
  }

  handleGeminiMessage(raw) {
    let message;
    try {
      message = JSON.parse(raw.toString());
    } catch {
      this.sendBrowser({ type: "error", text: "Invalid Gemini message JSON." });
      return;
    }

    if (message.setupComplete) {
      this.geminiReady = true;
      this.sendBrowser({ type: "connected", model: GEMINI_MODEL });
      return;
    }

    if (message.error) {
      this.sendBrowser({
        type: "error",
        text: `Gemini error: ${JSON.stringify(message.error)}`,
      });
      return;
    }

    const topLevelTranscript = message.outputTranscription?.text;
    if (topLevelTranscript) {
      this.sendModelText(topLevelTranscript);
      return;
    }

    if (message.serverContent) {
      const serverContent = message.serverContent;

      const outputTranscript = serverContent.outputTranscription?.text;
      if (outputTranscript) {
        this.sendModelText(outputTranscript);
      }

      for (const text of extractTextParts(serverContent)) {
        this.sendModelText(text);
      }

      const audioParts = extractAudioParts(serverContent);
      if (audioParts.length) {
        for (const audioPart of audioParts) {
          this.sendBrowser({
            type: "model_audio",
            mimeType: audioPart.mimeType,
            data: audioPart.data,
          });
        }

        this.modelAudioChunks += audioParts.length;
        if (this.modelAudioChunks === audioParts.length) {
          this.sendBrowser({
            type: "status_text",
            text: `Gemini is producing audio output: ${audioParts[0].mimeType}`,
          });
        }
        this.sendBrowser({
          type: "telemetry",
          text: `model audio chunks: ${this.modelAudioChunks}`,
        });
      }

      if (serverContent.turnComplete && this.mode === Mode.ANSWERING) {
        this.mode = Mode.NARRATING;
        this.sendBrowser({ type: "status", mode: this.mode });
      }
    }

    if (message.goAway) {
      this.sendBrowser({
        type: "error",
        text: "Gemini requested connection close.",
      });
    }
  }

  async startNarrationLoop() {
    await this.waitForFirstVideoFrame();
    if (this.closed) return;

    this.sendBrowser({ type: "status_text", text: "First frame received." });
    this.sendClientText(this.narrationPrompt(true), true);

    const tick = () => {
      if (this.closed) return;
      if (this.mode === Mode.NARRATING) {
        this.sendBrowser({ type: "telemetry", text: "narration prompt sent" });
        this.sendClientText(this.narrationPrompt(false), true);
      }
      this.narrationTimer = setTimeout(
        tick,
        this.narrationTickSeconds * 1000
      );
    };

    this.narrationTimer = setTimeout(tick, this.narrationTickSeconds * 1000);
  }

  get narrationTickSeconds() {
    return this.captureSource === "screen"
      ? SCREEN_NARRATION_TICK_SECONDS
      : CAMERA_NARRATION_TICK_SECONDS;
  }

  narrationPrompt(initial) {
    const frameLabel = initial ? "live" : "latest live";
    if (this.captureSource === "screen") {
      return (
        `Describe what is visible in the ${frameLabel} screen frame in one short sentence. ` +
        "Name the page, app, video, panel, or main content. Do not describe user actions " +
        "like scrolling, clicking, loading, or playback unless the visible content changed. " +
        "If unchanged, say nothing."
      );
    }
    return (
      `Describe the ${frameLabel} camera frame now in one concise sentence. ` +
      "Do not say you cannot see the image if video frames have been provided."
    );
  }

  answerTextQuestion(question) {
    const cleanQuestion = question.trim();
    if (!cleanQuestion) return;

    this.mode = Mode.ANSWERING;
    this.sendBrowser({ type: "status", mode: this.mode });
    this.sendBrowser({ type: "user_transcript", text: cleanQuestion });
    this.sendClientText(
      `Stop passive narration and answer this user question directly: ${cleanQuestion}`,
      true
    );
  }

  sendModelText(text) {
    const cleanText = text.trim();
    if (!cleanText) return;
    this.sendBrowser({
      type: this.mode === Mode.ANSWERING ? "answer" : "narration",
      text: cleanText,
    });
  }

  sendVideo(jpegBytes, mimeType) {
    if (!this.geminiReady) return;
    if (!jpegBytes.length) return;

    this.videoFrames += 1;
    this.firstVideoFrame = true;
    for (const resolve of this.waitingForFirstFrameResolvers.splice(0)) {
      resolve();
    }

    if (this.videoFrames === 1 || this.videoFrames % 10 === 0) {
      this.sendBrowser({
        type: "telemetry",
        text: `video frames sent: ${this.videoFrames}`,
      });
    }

    this.sendGemini({
      realtimeInput: {
        video: {
          data: Buffer.from(jpegBytes).toString("base64"),
          mimeType,
        },
      },
    });
  }

  sendClientText(text, turnComplete) {
    this.sendGemini({
      clientContent: {
        turns: [
          {
            role: "user",
            parts: [{ text }],
          },
        ],
        turnComplete,
      },
    });
  }

  sendScreenModeInstruction() {
    this.pendingScreenModeInstruction = false;
    this.sendClientText(
      "Screen capture mode is active. Briefly describe visible screen content, " +
        "not user interaction mechanics. Name the current page, app, video, " +
        "panel, or main visible content. Avoid saying scrolling, clicked, loading, " +
        "or playback continues unless that is the main visible change.",
      true
    );
  }

  sendGemini(message) {
    if (this.gemini?.readyState === WebSocket.OPEN) {
      this.gemini.send(JSON.stringify(message));
    }
  }

  sendBrowser(message) {
    if (this.browser.readyState === WebSocket.OPEN) {
      this.browser.send(JSON.stringify(message));
    }
  }

  waitForFirstVideoFrame() {
    if (this.firstVideoFrame) return Promise.resolve();
    return new Promise((resolve) => {
      this.waitingForFirstFrameResolvers.push(resolve);
    });
  }

  closeSoon() {
    setTimeout(() => this.close(), 250);
  }

  close() {
    if (this.closed) return;
    this.closed = true;
    if (this.narrationTimer) clearTimeout(this.narrationTimer);
    for (const resolve of this.waitingForFirstFrameResolvers.splice(0)) {
      resolve();
    }
    if (this.gemini?.readyState === WebSocket.OPEN) {
      this.gemini.close(1000, "Browser session closed");
    }
    if (this.browser.readyState === WebSocket.OPEN) {
      this.browser.close(1000, "Session closed");
    }
  }
}

function extractTextParts(serverContent) {
  const parts = serverContent.modelTurn?.parts || [];
  return parts
    .filter((part) => typeof part?.text === "string")
    .map((part) => part.text);
}

function extractAudioParts(serverContent) {
  const parts = serverContent.modelTurn?.parts || [];
  const audioParts = [];

  for (const part of parts) {
    const inlineData = part.inlineData || part.inline_data;
    if (!inlineData) continue;

    const mimeType = inlineData.mimeType || inlineData.mime_type || "";
    if (!mimeType.startsWith("audio/")) continue;
    if (!inlineData.data) continue;

    audioParts.push({ mimeType, data: inlineData.data });
  }

  return audioParts;
}

function waitForOpen(socket) {
  if (socket.readyState === WebSocket.OPEN) return Promise.resolve();
  return new Promise((resolve, reject) => {
    socket.once("open", resolve);
    socket.once("error", reject);
  });
}

function waitUntil(predicate, timeoutMs) {
  const startedAt = Date.now();

  return new Promise((resolve) => {
    const poll = () => {
      if (predicate() || Date.now() - startedAt >= timeoutMs) {
        resolve();
        return;
      }
      setTimeout(poll, 25);
    };
    poll();
  });
}
