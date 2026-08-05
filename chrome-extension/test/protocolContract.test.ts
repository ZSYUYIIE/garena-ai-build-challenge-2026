import assert from "node:assert/strict";
import test from "node:test";

import {
  parseBrowserMessage,
  parseServerOutput,
  SERVER_MESSAGE_TYPES,
} from "../../ai-voice-realtime/src/protocol/browserMessages.js";
import {
  backpressureAction,
  backendConnectionClosedStatus,
  canAcceptTurnRoleUpdate,
  createTurnRoleState,
  finishTurnRole,
  parseServerMessage,
  SUPPORTED_SERVER_MESSAGE_TYPES,
  updateTurnChatMessages,
  voiceStatusForState,
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
    {
      type: "session_hello",
      protocolVersion: 2,
      tabAudioState: "captured",
      microphoneState: "ready",
    },
    { type: "media_state", tabAudioState: "degraded", microphoneState: "denied" },
    { type: "tab_audio_activity", active: true },
    {
      type: "tab_audio_discontinuity",
      timestampMs: 1200,
      reason: "websocket_backpressure",
    },
    { type: "user_activity_start", turnId: "123e4567-e89b-42d3-a456-426614174000" },
    { type: "user_activity_end", turnId: "123e4567-e89b-42d3-a456-426614174000" },
  ];

  assert.deepEqual(
    commands.map((command) => parseBrowserMessage(JSON.stringify(command)).type),
    [
      "capture_source",
      "video_frame",
      "session_config",
      "typed_question",
      "session_hello",
      "media_state",
      "tab_audio_activity",
      "tab_audio_discontinuity",
      "user_activity_start",
      "user_activity_end",
    ],
  );
});

test("uses bounded source-specific transport backpressure actions", () => {
  assert.equal(backpressureAction("frame", 128 * 1024 - 1), "send");
  assert.equal(backpressureAction("frame", 128 * 1024), "replace_latest_frame");
  assert.equal(backpressureAction("tab", 32 * 1024 - 1), "send");
  assert.equal(backpressureAction("tab", 32 * 1024), "tab_discontinuity");
  assert.equal(backpressureAction("microphone", 32 * 1024 - 1), "send");
  assert.equal(backpressureAction("microphone", 32 * 1024), "fail_microphone_turn");
});

test("reports backend WebSocket close details with a safe generic fallback", () => {
  assert.equal(
    backendConnectionClosedStatus(1008, "Rate limit exceeded."),
    "Backend connection closed (1008: Rate limit exceeded.)",
  );
  assert.equal(
    backendConnectionClosedStatus(1006, ""),
    "Backend connection closed (1006)",
  );
  assert.equal(
    backendConnectionClosedStatus(1000, ""),
    "Backend connection closed.",
  );
});

test("publishes voice availability only after live protocol readiness", () => {
  const ready = {
    sessionActive: true,
    microphoneState: "ready" as const,
    helloAccepted: true,
    liveReady: true,
    liveDegraded: false,
    userSpeaking: false,
    geminiSpeaking: false,
  };

  assert.equal(voiceStatusForState({ ...ready, helloAccepted: false }), "off");
  assert.equal(voiceStatusForState({ ...ready, liveReady: false }), "off");
  assert.equal(voiceStatusForState({ ...ready, microphoneState: "denied" }), "degraded");
  assert.equal(voiceStatusForState({ ...ready, liveDegraded: true }), "degraded");
  assert.equal(voiceStatusForState({ ...ready, sessionActive: false }), "off");
  assert.equal(voiceStatusForState({ ...ready, userSpeaking: true }), "user_speaking");
  assert.equal(voiceStatusForState({ ...ready, geminiSpeaking: true }), "gemini_speaking");
  assert.equal(voiceStatusForState(ready), "listening");
});

test("upserts ordered transcript chunks into one turn-bound chat entry", () => {
  const turnId = "123e4567-e89b-42d3-a456-426614174000";
  let messages = updateTurnChatMessages([], {
    turnId,
    role: "user",
    text: "what is",
    finished: false,
  });
  messages = updateTurnChatMessages(messages, {
    turnId,
    role: "user",
    text: "visible",
    finished: true,
  });
  messages = updateTurnChatMessages(messages, {
    turnId,
    role: "assistant",
    text: "A map",
    finished: false,
  });
  messages = updateTurnChatMessages(messages, {
    turnId,
    role: "assistant",
    text: "is visible.",
    finished: true,
  });

  assert.deepEqual(messages, [
    { id: `${turnId}:user`, role: "user", text: "what is visible" },
    { id: `${turnId}:assistant`, role: "assistant", text: "A map is visible." },
  ]);
});

test("keeps local typed text once while settling its echoed user role", () => {
  const turnId = "123e4567-e89b-42d3-a456-426614174000";
  const messages = updateTurnChatMessages([], {
    turnId,
    role: "user",
    text: "What changed?",
    finished: true,
  });
  const active = createTurnRoleState(turnId, { userFinished: true });

  assert.equal(canAcceptTurnRoleUpdate(turnId, "user", active, null), false);
  assert.deepEqual(messages, [
    { id: `${turnId}:user`, role: "user", text: "What changed?" },
  ]);
  assert.equal(canAcceptTurnRoleUpdate(turnId, "assistant", active, null), true);
  const assistantFinished = finishTurnRole(active, "assistant");
  assert.equal(canAcceptTurnRoleUpdate(turnId, "assistant", assistantFinished, null), false);
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
      finished: false,
    },
    {
      type: "model_audio",
      turnId,
      mode: "answer",
      mimeType: "audio/pcm;rate=24000",
      data: "AQI=",
    },
    { type: "playback_clear", turnId, mode: "answer", reason: "barge_in" },
    { type: "turn_complete", turnId, mode: "answer", interrupted: false, retryable: false },
    { type: "provider_health", provider: "live", state: "ready" },
  ];

  assert.deepEqual(messages.map((message) => parseServerOutput(message)), messages);
  assert.deepEqual(messages.map((message) => parseServerMessage(JSON.stringify(message))), messages);
});

test("parses a strict fixture for every advertised server message type", () => {
  const turnId = "123e4567-e89b-42d3-a456-426614174000";
  const fixtures = [
    { type: "analysis_error", text: "provider unavailable" },
    { type: "answer", text: "legacy answer" },
    {
      type: "answer_update",
      turnId,
      mode: "answer",
      text: "streamed answer",
      finished: false,
    },
    { type: "connected", protocolVersion: 2, model: "gemini-live" },
    { type: "error", text: "retryable error" },
    { type: "event" },
    {
      type: "model_audio",
      turnId,
      mode: "answer",
      mimeType: "audio/pcm;rate=24000",
      data: "AQI=",
    },
    { type: "playback_clear", turnId, mode: "answer" },
    { type: "provider_health", provider: "tab_stt", state: "degraded", message: "gap" },
    { type: "narration", text: "legacy narration" },
    { type: "narration_update", turnId, mode: "narration", text: "live narration", finished: true, languageCode: "en-US" },
    { type: "status", mode: "narrating" },
    { type: "status_text", text: "connected" },
    { type: "telemetry", text: "frame accepted" },
    { type: "turn_complete", turnId, mode: "answer", suppressed: false, retryable: false },
    { type: "turn_started", turnId, mode: "answer" },
    {
      type: "user_transcript",
      turnId,
      mode: "answer",
      text: "spoken question",
      finished: true,
    },
  ];

  assert.deepEqual(
    fixtures.map((fixture) => parseServerMessage(JSON.stringify(fixture)).type),
    SUPPORTED_SERVER_MESSAGE_TYPES,
  );
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
      mimeType: "audio/pcm;rate=99999",
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
    { type: "provider_health", provider: "live", state: "telemetry" },
  ];

  for (const message of invalid) {
    assert.throws(() => parseServerOutput(message));
    assert.throws(() => parseServerMessage(JSON.stringify(message)), /invalid server message/i);
  }
});
