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
    { type: "session_config", narrationLevel: "question_only" }
  );
  assert.deepEqual(
    parseBrowserMessage('{"type":"typed_question","text":"  What is visible?  "}'),
    { type: "typed_question", text: "What is visible?" }
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
    () => parseBrowserMessage('{"type":"typed_question","text":"   "}'),
    /invalid browser message/i
  );
  assert.throws(
    () =>
      parseBrowserMessage(
        JSON.stringify({ type: "typed_question", text: "q".repeat(501) })
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
