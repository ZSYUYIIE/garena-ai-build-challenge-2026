import assert from "node:assert/strict";
import test from "node:test";

import {
  parseBrowserMessage,
  SERVER_MESSAGE_TYPES,
} from "../../ai-voice-realtime/src/protocol/browserMessages.js";
import {
  parseServerMessage,
  SUPPORTED_SERVER_MESSAGE_TYPES,
} from "../src/sidepanel/realtime/types.ts";

test("extension supports every server message in the backend contract", () => {
  const supported = new Set<string>(SUPPORTED_SERVER_MESSAGE_TYPES);
  const missing = SERVER_MESSAGE_TYPES.filter((type) => !supported.has(type));

  assert.deepEqual(missing, []);
});

test("backend accepts every extension command fixture", () => {
  const commands = [
    { type: "capture_source", source: "screen" },
    {
      type: "video_frame",
      timestampSeconds: 1.25,
      mimeType: "image/jpeg",
      data: "AQID",
    },
    { type: "session_config", narrationLevel: "standard" },
    {
      type: "typed_question",
      text: "What is visible?",
      turnId: "123e4567-e89b-42d3-a456-426614174000",
    },
  ];

  assert.deepEqual(
    commands.map((command) => parseBrowserMessage(JSON.stringify(command)).type),
    ["capture_source", "video_frame", "session_config", "typed_question"],
  );
});

test("strictly parses protocol-v2 turn-bound server messages", () => {
  const turnId = "123e4567-e89b-42d3-a456-426614174000";
  const messages = [
    { type: "connected", protocolVersion: 2 },
    { type: "turn_started", turnId, mode: "answer" },
    {
      type: "user_transcript",
      turnId,
      mode: "answer",
      text: "what is visible",
      finished: true,
      languageCode: "en",
    },
    {
      type: "answer_update",
      turnId,
      mode: "answer",
      text: "A monitor is visible.",
      finished: false,
    },
    {
      type: "narration_update",
      turnId,
      mode: "narration",
      text: "The page has loaded.",
    },
    {
      type: "model_audio",
      turnId,
      mode: "answer",
      mimeType: "audio/pcm;rate=24000",
      data: "AQI=",
    },
    { type: "playback_clear", turnId, mode: "answer", reason: "barge_in" },
    { type: "turn_complete", turnId, mode: "answer", interrupted: false },
    { type: "provider_health", provider: "live", state: "ready" },
  ];

  assert.deepEqual(messages.map((message) => parseServerMessage(JSON.stringify(message))), messages);
});

test("rejects malformed strict server messages", () => {
  const turnId = "123e4567-e89b-42d3-a456-426614174000";
  const invalid = [
    { type: "connected", protocolVersion: 1 },
    { type: "turn_started", turnId, mode: "automatic" },
    { type: "answer_update", turnId, mode: "answer", text: "missing finished" },
    {
      type: "model_audio",
      turnId,
      mode: "answer",
      mimeType: "audio/mp3",
      data: "AQI=",
    },
    {
      type: "model_audio",
      turnId,
      mode: "answer",
      mimeType: "audio/pcm;rate=not-a-rate",
      data: "AQI=",
    },
    {
      type: "model_audio",
      turnId,
      mode: "answer",
      mimeType: "audio/pcm;rate=24000",
      data: "not-base64%%",
    },
    { type: "provider_health", provider: "live", state: "ready", text: "leak" },
  ];

  for (const message of invalid) {
    assert.throws(() => parseServerMessage(JSON.stringify(message)), /invalid server message/i);
  }
});
