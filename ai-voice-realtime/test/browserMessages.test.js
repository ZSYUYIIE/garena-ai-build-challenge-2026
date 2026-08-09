import assert from "node:assert/strict";
import test from "node:test";

import {
  MAX_WEBSOCKET_PAYLOAD_BYTES,
  parseBrowserMessage,
} from "../src/protocol/browserMessages.js";

test("accepts each supported extension command", () => {
  assert.deepEqual(
    parseBrowserMessage('{"type":"capture_source","source":"screen"}'),
    { type: "capture_source", source: "screen" }
  );
  assert.deepEqual(
    parseBrowserMessage(
      '{"type":"video_frame","timestampSeconds":12.5,"mimeType":"image/jpeg","data":"AQID"}'
    ),
    {
      type: "video_frame",
      timestampSeconds: 12.5,
      mimeType: "image/jpeg",
      data: "AQID",
    }
  );
  assert.deepEqual(
    parseBrowserMessage(
      '{"type":"session_config","narrationLevel":"question_only"}'
    ),
    { type: "session_config", narrationLevel: "question_only", researchMode: "normal" }
  );
  assert.deepEqual(
    parseBrowserMessage('{"type":"session_config","narrationLevel":"standard","researchMode":"deep_research"}'),
    { type: "session_config", narrationLevel: "standard", researchMode: "deep_research" }
  );
  assert.deepEqual(
    parseBrowserMessage(
      '{"type":"typed_question","text":"  What is visible?  ","turnId":"123e4567-e89b-42d3-a456-426614174000"}'
    ),
    {
      type: "typed_question",
      text: "What is visible?",
      turnId: "123e4567-e89b-42d3-a456-426614174000",
    }
  );
});

test("accepts strict protocol-v2 media and user-activity commands", () => {
  const commands = [
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
      timestampMs: 25,
      reason: "capture_gap",
    },
    { type: "user_activity_start", turnId: "123e4567-e89b-42d3-a456-426614174000" },
    { type: "user_activity_end", turnId: "123e4567-e89b-42d3-a456-426614174000" },
  ];

  assert.deepEqual(
    commands.map((command) => parseBrowserMessage(JSON.stringify(command))),
    commands,
  );
});

test("rejects malformed and non-object JSON without property access", () => {
  for (const raw of ["{", "null", "[]", '"video_frame"', "42", "true"]) {
    assert.throws(() => parseBrowserMessage(raw), /invalid browser message/i, raw);
  }
});

test("rejects unknown commands and unknown fields", () => {
  assert.throws(
    () => parseBrowserMessage('{"type":"unknown_command"}'),
    /invalid browser message/i
  );
  assert.throws(
    () =>
      parseBrowserMessage(
        '{"type":"capture_source","source":"screen","unexpected":true}'
      ),
    /invalid browser message/i
  );
});

test("rejects invalid questions and narration configuration", () => {
  assert.throws(
    () =>
      parseBrowserMessage(
        '{"type":"typed_question","text":"   ","turnId":"123e4567-e89b-42d3-a456-426614174000"}'
      ),
    /invalid browser message/i
  );
  assert.throws(
    () =>
      parseBrowserMessage(
        JSON.stringify({
          type: "typed_question",
          text: "q".repeat(501),
          turnId: "123e4567-e89b-42d3-a456-426614174000",
        })
      ),
    /invalid browser message/i
  );
  assert.throws(
    () =>
      parseBrowserMessage(
        '{"type":"session_config","narrationLevel":"automatic"}'
      ),
    /invalid browser message/i
  );
});

test("rejects invalid v2 versions, turn IDs, and unknown command fields", () => {
  const invalid = [
    {
      type: "session_hello",
      protocolVersion: 1,
      tabAudioState: "captured",
      microphoneState: "ready",
    },
    {
      type: "session_hello",
      protocolVersion: 2,
      tabAudioState: "captured",
      microphoneState: "ready",
      extra: true,
    },
    { type: "user_activity_start", turnId: "not-a-uuid" },
    { type: "tab_audio_discontinuity", timestampMs: -1, reason: "capture_gap" },
  ];

  for (const command of invalid) {
    assert.throws(
      () => parseBrowserMessage(JSON.stringify(command)),
      /invalid browser message/i,
    );
  }
});

test("rejects unsafe video frame fields", () => {
  const invalidFrames = [
    {
      type: "video_frame",
      timestampSeconds: -1,
      mimeType: "image/jpeg",
      data: "AQID",
    },
    {
      type: "video_frame",
      timestampSeconds: 1e999,
      mimeType: "image/jpeg",
      data: "AQID",
    },
    {
      type: "video_frame",
      timestampSeconds: 1,
      mimeType: "image/png",
      data: "AQID",
    },
    {
      type: "video_frame",
      timestampSeconds: 1,
      mimeType: "image/jpeg",
      data: "",
    },
    {
      type: "video_frame",
      timestampSeconds: 1,
      mimeType: "image/jpeg",
      data: "not-base64%%",
    },
  ];

  for (const frame of invalidFrames) {
    assert.throws(
      () => parseBrowserMessage(JSON.stringify(frame)),
      /invalid browser message/i
    );
  }
});

test("rejects frame text larger than the transport budget", () => {
  const oversized = JSON.stringify({
    type: "video_frame",
    timestampSeconds: 1,
    mimeType: "image/jpeg",
    data: "A".repeat(MAX_WEBSOCKET_PAYLOAD_BYTES + 1),
  });

  assert.throws(() => parseBrowserMessage(oversized), /invalid browser message/i);
});
