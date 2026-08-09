import assert from "node:assert/strict";
import test from "node:test";

import {
  DEFAULT_VOICE_NARRATION_MODE,
  VOICE_NARRATION_STORAGE_KEY,
  isVoiceNarrationShortcut,
  nextVoiceNarrationMode,
  readVoiceNarrationMode,
  voiceNarrationModeAfterShortcut,
  writeVoiceNarrationMode,
} from "../src/sidepanel/voiceNarration.ts";

test("cycles voice narration modes in the product order", () => {
  assert.equal(nextVoiceNarrationMode("smart"), "over_audio");
  assert.equal(nextVoiceNarrationMode("over_audio"), "narration_only");
  assert.equal(nextVoiceNarrationMode("narration_only"), "smart");
});

test("loads a persisted voice narration mode", () => {
  const storage = { getItem: () => "narration_only" };

  assert.equal(readVoiceNarrationMode(storage), "narration_only");
});

test("defaults safely when the persisted mode is missing, invalid, or unreadable", () => {
  assert.equal(
    readVoiceNarrationMode({ getItem: () => null }),
    DEFAULT_VOICE_NARRATION_MODE,
  );
  assert.equal(
    readVoiceNarrationMode({ getItem: () => "unknown" }),
    DEFAULT_VOICE_NARRATION_MODE,
  );
  assert.equal(
    readVoiceNarrationMode({
      getItem: () => {
        throw new Error("storage unavailable");
      },
    }),
    DEFAULT_VOICE_NARRATION_MODE,
  );
});

test("writes the voice narration mode under a versioned key", () => {
  const writes: Array<[string, string]> = [];

  assert.equal(
    writeVoiceNarrationMode("over_audio", {
      setItem: (key, value) => writes.push([key, value]),
    }),
    true,
  );
  assert.deepEqual(writes, [[VOICE_NARRATION_STORAGE_KEY, "over_audio"]]);
});

test("keeps the in-memory selection usable when persistence fails", () => {
  assert.equal(
    writeVoiceNarrationMode("narration_only", {
      setItem: () => {
        throw new Error("storage unavailable");
      },
    }),
    false,
  );
});

test("recognizes only an unmodified non-repeating N shortcut", () => {
  const shortcut = {
    code: "KeyN",
    repeat: false,
    altKey: false,
    ctrlKey: false,
    metaKey: false,
    shiftKey: false,
  };

  assert.equal(isVoiceNarrationShortcut(shortcut), true);
  assert.equal(isVoiceNarrationShortcut({ ...shortcut, code: "KeyS" }), false);
  assert.equal(isVoiceNarrationShortcut({ ...shortcut, repeat: true }), false);
  assert.equal(isVoiceNarrationShortcut({ ...shortcut, altKey: true }), false);
  assert.equal(isVoiceNarrationShortcut({ ...shortcut, ctrlKey: true }), false);
  assert.equal(isVoiceNarrationShortcut({ ...shortcut, metaKey: true }), false);
  assert.equal(isVoiceNarrationShortcut({ ...shortcut, shiftKey: true }), false);
});

test("cycles N outside editable controls and leaves form editing untouched", () => {
  const shortcut = {
    code: "KeyN",
    repeat: false,
    altKey: false,
    ctrlKey: false,
    metaKey: false,
    shiftKey: false,
  };

  assert.equal(
    voiceNarrationModeAfterShortcut("smart", shortcut, { tagName: "BUTTON" }),
    "over_audio",
  );
  assert.equal(
    voiceNarrationModeAfterShortcut("smart", shortcut, { tagName: "INPUT" }),
    null,
  );
  assert.equal(
    voiceNarrationModeAfterShortcut("smart", shortcut, {
      tagName: "DIV",
      isContentEditable: true,
    }),
    null,
  );
  assert.equal(
    voiceNarrationModeAfterShortcut(
      "smart",
      { ...shortcut, code: "KeyS" },
      { tagName: "BUTTON" },
    ),
    null,
  );
});
