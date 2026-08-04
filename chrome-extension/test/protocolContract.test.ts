import assert from "node:assert/strict";
import test from "node:test";

import {
  parseBrowserMessage,
  SERVER_MESSAGE_TYPES,
} from "../../ai-voice-realtime/src/protocol/browserMessages.js";
import { SUPPORTED_SERVER_MESSAGE_TYPES } from "../src/sidepanel/realtime/types.ts";

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
    { type: "typed_question", text: "What is visible?" },
  ];

  assert.deepEqual(
    commands.map((command) => parseBrowserMessage(JSON.stringify(command)).type),
    ["capture_source", "video_frame", "session_config", "typed_question"],
  );
});
