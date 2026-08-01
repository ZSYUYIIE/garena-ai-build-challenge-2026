import asyncio
import base64
import json
import os
import time
from enum import Enum
from pathlib import Path
from typing import Any

import websockets
from dotenv import load_dotenv
from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.responses import FileResponse, Response
from fastapi.staticfiles import StaticFiles
from starlette.websockets import WebSocketDisconnect as StarletteWebSocketDisconnect

load_dotenv()

GEMINI_API_KEY = os.getenv("GOOGLE_API_KEY", "")
GEMINI_MODEL = os.getenv("GEMINI_LIVE_MODEL", "gemini-3.1-flash-live-preview")
GEMINI_WS_URL = (
    "wss://generativelanguage.googleapis.com/ws/"
    "google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContent"
    f"?key={GEMINI_API_KEY}"
)

NARRATION_TICK_SECONDS = 4.0
QUESTION_SILENCE_SECONDS = 3.0
MAX_AUDIO_QUESTION_SECONDS = 12.0

ROOT = Path(__file__).parent
STATIC_DIR = ROOT / "static"

app = FastAPI()
app.mount("/static", StaticFiles(directory=STATIC_DIR), name="static")


class Mode(str, Enum):
    NARRATING = "narrating"
    LISTENING = "listening"
    ANSWERING = "answering"


@app.get("/")
async def index() -> FileResponse:
    return FileResponse(STATIC_DIR / "index.html")


@app.get("/favicon.ico")
async def favicon() -> Response:
    return Response(status_code=204)


class ClientSession:
    def __init__(self, browser: WebSocket):
        self.browser = browser
        self.gemini: websockets.ClientConnection | None = None
        self.mode = Mode.NARRATING
        self.interrupts_allowed = False
        self.last_speech_at = 0.0
        self.question_started_at = 0.0
        self.audio_seen = False
        self.closed = asyncio.Event()
        self.gemini_ready = asyncio.Event()
        self.first_video_frame = asyncio.Event()
        self.send_lock = asyncio.Lock()
        self.video_frames = 0
        self.audio_chunks = 0
        self.model_audio_chunks = 0

    async def run(self) -> None:
        if not GEMINI_API_KEY:
            await self.send_browser(
                {
                    "type": "error",
                    "text": "Missing GOOGLE_API_KEY. Add it to .env or export it in your shell.",
                }
            )
            await asyncio.sleep(0.25)
            return

        await self.send_browser(
            {"type": "status_text", "text": "Connecting to Gemini Live..."}
        )

        async with websockets.connect(
            GEMINI_WS_URL,
            max_size=16 * 1024 * 1024,
            ping_interval=20,
            ping_timeout=20,
        ) as gemini:
            self.gemini = gemini
            await self.send_gemini_setup()

            gemini_task = asyncio.create_task(self.gemini_to_browser())
            ready_task = asyncio.create_task(self.gemini_ready.wait())
            done, pending = await asyncio.wait(
                [gemini_task, ready_task],
                timeout=10,
                return_when=asyncio.FIRST_COMPLETED,
            )

            if ready_task not in done:
                ready_task.cancel()
                if gemini_task in done:
                    gemini_task.result()
                await self.send_browser(
                    {
                        "type": "error",
                        "text": (
                            "Gemini Live did not finish setup. Check the API key, "
                            f"model access, and model name: {GEMINI_MODEL}."
                        ),
                    }
                )
                await asyncio.sleep(0.25)
                return

            await self.send_browser(
                {"type": "status_text", "text": "Waiting for the first camera frame..."}
            )
            await self.send_browser({"type": "status", "mode": self.mode})

            tasks = [
                gemini_task,
                asyncio.create_task(self.browser_to_gemini()),
                asyncio.create_task(self.narration_loop()),
                asyncio.create_task(self.question_watchdog()),
            ]
            done, pending = await asyncio.wait(
                tasks, return_when=asyncio.FIRST_COMPLETED
            )
            self.closed.set()
            for task in pending:
                task.cancel()
            for task in done:
                task.result()

    async def send_gemini_setup(self) -> None:
        setup = {
            "setup": {
                "model": f"models/{GEMINI_MODEL}",
                "generationConfig": {
                    # Gemini 3.1 Flash Live requires AUDIO responses. The UI still
                    # displays text by reading outputAudioTranscription events.
                    "responseModalities": ["AUDIO"],
                    "temperature": 0.4,
                    "maxOutputTokens": 240,
                    "speechConfig": {
                        "voiceConfig": {
                            "prebuiltVoiceConfig": {
                                "voiceName": "Puck",
                            }
                        }
                    },
                },
                "inputAudioTranscription": {},
                "outputAudioTranscription": {},
                "systemInstruction": {
                    "parts": [
                        {
                            "text": (
                                "You are a live video narrator and question-answering assistant. "
                                "Default behavior: briefly describe meaningful visual changes in the "
                                "live camera feed. Avoid repeating unchanged details. When the user "
                                "speaks or asks a question, stop passive narration, infer the user's "
                                "request from audio/transcription and current video, answer directly, "
                                "then return to concise passive narration. If no clear user request "
                                "was spoken, say nothing about it and continue narrating."
                            )
                        }
                    ]
                },
            }
        }
        await self.send_gemini(setup)

    async def browser_to_gemini(self) -> None:
        while not self.closed.is_set():
            raw = await self.browser.receive()
            if raw.get("type") == "websocket.disconnect":
                self.closed.set()
                return

            if "text" in raw:
                message = json.loads(raw["text"])
                await self.handle_browser_json(message)
            elif "bytes" in raw:
                # Raw binary frames are treated as JPEG video for convenience.
                await self.send_video(raw["bytes"])

    async def handle_browser_json(self, message: dict[str, Any]) -> None:
        kind = message.get("type")

        if kind == "video_frame":
            data = base64.b64decode(message["data"])
            await self.send_video(data, message.get("mimeType", "image/jpeg"))
            return

        if kind == "audio_chunk":
            if self.interrupts_allowed and self.mode in (
                Mode.LISTENING,
                Mode.ANSWERING,
            ):
                audio = base64.b64decode(message["data"])
                await self.send_audio(
                    audio, message.get("mimeType", "audio/pcm;rate=16000")
                )
            return

        if kind == "speech_start":
            if self.interrupts_allowed:
                await self.enter_listening()
            return

        if kind == "speech_activity":
            self.last_speech_at = time.monotonic()
            self.audio_seen = True
            return

        if kind == "typed_question":
            await self.answer_text_question(message.get("text", ""))
            return

        if kind == "interrupts":
            self.interrupts_allowed = bool(message.get("allowed", True))
            if not self.interrupts_allowed and self.mode != Mode.NARRATING:
                self.mode = Mode.NARRATING
                await self.send_browser({"type": "status", "mode": self.mode})
            await self.send_browser(
                {"type": "interrupts", "allowed": self.interrupts_allowed}
            )

    async def gemini_to_browser(self) -> None:
        assert self.gemini is not None
        async for raw in self.gemini:
            message = json.loads(raw)

            if "setupComplete" in message:
                self.gemini_ready.set()
                await self.send_browser({"type": "connected", "model": GEMINI_MODEL})
                continue

            if "error" in message:
                await self.send_browser(
                    {
                        "type": "error",
                        "text": f"Gemini error: {json.dumps(message['error'])}",
                    }
                )
                continue

            if "inputTranscription" in message:
                transcript = message["inputTranscription"].get("text")
                if transcript:
                    await self.send_browser(
                        {"type": "user_transcript", "text": transcript}
                    )
                continue

            if "outputTranscription" in message:
                transcript = message["outputTranscription"].get("text")
                if transcript:
                    await self.send_model_text(transcript)
                continue

            if "serverContent" in message:
                server = message["serverContent"]

                input_transcription = server.get("inputTranscription", {}).get("text")
                if input_transcription:
                    await self.send_browser(
                        {"type": "user_transcript", "text": input_transcription}
                    )

                output_transcription = server.get("outputTranscription", {}).get("text")
                if output_transcription:
                    await self.send_model_text(output_transcription)

                for text in extract_text_parts(server):
                    await self.send_model_text(text)

                audio_count = count_audio_parts(server)
                if audio_count:
                    self.model_audio_chunks += audio_count
                    if self.model_audio_chunks == audio_count:
                        await self.send_browser(
                            {
                                "type": "status_text",
                                "text": (
                                    "Gemini is producing audio output. Waiting for "
                                    "output transcription text..."
                                ),
                            }
                        )
                    await self.send_browser(
                        {
                            "type": "telemetry",
                            "text": f"model audio chunks: {self.model_audio_chunks}",
                        }
                    )

                if server.get("turnComplete") and self.mode == Mode.ANSWERING:
                    self.mode = Mode.NARRATING
                    await self.send_browser({"type": "status", "mode": self.mode})

            if "goAway" in message:
                await self.send_browser(
                    {"type": "error", "text": "Gemini requested connection close."}
                )

    async def narration_loop(self) -> None:
        await self.gemini_ready.wait()
        await self.first_video_frame.wait()
        await self.send_browser(
            {"type": "status_text", "text": "First frame received."}
        )
        await self.send_client_text(
            "Describe the live camera frame now in one concise sentence.",
            turn_complete=True,
        )
        while not self.closed.is_set():
            await asyncio.sleep(NARRATION_TICK_SECONDS)
            if self.mode != Mode.NARRATING:
                continue
            await self.send_browser(
                {"type": "telemetry", "text": "narration prompt sent"}
            )
            await self.send_client_text(
                "Describe the latest live camera frame now in one concise sentence. "
                "Do not say you cannot see the image if video frames have been provided.",
                turn_complete=True,
            )

    async def question_watchdog(self) -> None:
        while not self.closed.is_set():
            await asyncio.sleep(0.2)
            if self.mode != Mode.LISTENING:
                continue

            now = time.monotonic()
            silence_elapsed = now - self.last_speech_at
            total_elapsed = now - self.question_started_at
            if self.audio_seen and (
                silence_elapsed >= QUESTION_SILENCE_SECONDS
                or total_elapsed >= MAX_AUDIO_QUESTION_SECONDS
            ):
                await self.finish_listening()
            elif not self.audio_seen and total_elapsed >= QUESTION_SILENCE_SECONDS:
                self.mode = Mode.NARRATING
                await self.send_browser({"type": "status", "mode": self.mode})

    async def enter_listening(self) -> None:
        if self.mode == Mode.LISTENING:
            return
        self.mode = Mode.LISTENING
        self.audio_seen = False
        self.question_started_at = time.monotonic()
        self.last_speech_at = self.question_started_at
        await self.send_browser({"type": "status", "mode": self.mode})
        await self.send_client_text(
            "Pause passive narration. Listen for the user's spoken question now.",
            turn_complete=False,
        )

    async def finish_listening(self) -> None:
        self.mode = Mode.ANSWERING
        await self.send_browser({"type": "status", "mode": self.mode})
        await self.send_client_text(
            "The user has stopped speaking. Transcribe or infer their spoken request from "
            "the recent audio, then answer it directly using the current video feed when useful. "
            "If no actual question or command was spoken, say nothing and return to passive narration.",
            turn_complete=True,
        )

    async def answer_text_question(self, question: str) -> None:
        question = question.strip()
        if not question:
            return
        self.mode = Mode.ANSWERING
        await self.send_browser({"type": "status", "mode": self.mode})
        await self.send_browser({"type": "user_transcript", "text": question})
        await self.send_client_text(
            f"Stop passive narration and answer this user question directly: {question}",
            turn_complete=True,
        )

    async def send_model_text(self, text: str) -> None:
        text = text.strip()
        if not text:
            return
        event_type = "answer" if self.mode == Mode.ANSWERING else "narration"
        await self.send_browser({"type": event_type, "text": text})

    async def send_video(
        self, jpeg_bytes: bytes, mime_type: str = "image/jpeg"
    ) -> None:
        self.video_frames += 1
        self.first_video_frame.set()
        if self.video_frames == 1 or self.video_frames % 10 == 0:
            await self.send_browser(
                {"type": "telemetry", "text": f"video frames sent: {self.video_frames}"}
            )
        await self.send_gemini(
            {
                "realtimeInput": {
                    "video": {
                        "data": base64.b64encode(jpeg_bytes).decode("ascii"),
                        "mimeType": mime_type,
                    }
                }
            }
        )

    async def send_audio(self, pcm_bytes: bytes, mime_type: str) -> None:
        self.audio_chunks += 1
        if self.audio_chunks == 1:
            await self.send_browser(
                {"type": "telemetry", "text": "microphone audio sent"}
            )
        await self.send_gemini(
            {
                "realtimeInput": {
                    "audio": {
                        "data": base64.b64encode(pcm_bytes).decode("ascii"),
                        "mimeType": mime_type,
                    }
                }
            }
        )

    async def send_client_text(self, text: str, turn_complete: bool) -> None:
        await self.send_gemini(
            {
                "clientContent": {
                    "turns": [
                        {
                            "role": "user",
                            "parts": [{"text": text}],
                        }
                    ],
                    "turnComplete": turn_complete,
                }
            }
        )

    async def send_gemini(self, message: dict[str, Any]) -> None:
        assert self.gemini is not None
        async with self.send_lock:
            await self.gemini.send(json.dumps(message))

    async def send_browser(self, message: dict[str, Any]) -> None:
        await self.browser.send_text(json.dumps(message))


def extract_text_parts(server_content: dict[str, Any]) -> list[str]:
    parts = server_content.get("modelTurn", {}).get("parts", [])
    text_parts: list[str] = []
    for part in parts:
        if isinstance(part, dict) and "text" in part:
            text_parts.append(part["text"])
    return text_parts


def count_audio_parts(server_content: dict[str, Any]) -> int:
    parts = server_content.get("modelTurn", {}).get("parts", [])
    count = 0
    for part in parts:
        inline_data = part.get("inlineData") or part.get("inline_data")
        if not isinstance(inline_data, dict):
            continue
        mime_type = inline_data.get("mimeType") or inline_data.get("mime_type") or ""
        if mime_type.startswith("audio/"):
            count += 1
    return count


@app.websocket("/ws")
async def websocket_endpoint(websocket: WebSocket) -> None:
    await websocket.accept()
    session = ClientSession(websocket)
    try:
        await session.run()
    except (WebSocketDisconnect, StarletteWebSocketDisconnect):
        return
    except Exception as exc:
        try:
            await websocket.send_text(json.dumps({"type": "error", "text": str(exc)}))
        except Exception:
            pass
