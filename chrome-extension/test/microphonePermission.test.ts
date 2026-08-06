import assert from "node:assert/strict";
import test from "node:test";

import {
  MICROPHONE_PERMISSION_GRANTED,
  isMicrophonePermissionGrantedMessage,
  isMicrophonePermissionPage,
} from "../src/services/microphonePermission.ts";

test("routes only the explicit microphone permission query to the permission page", () => {
  assert.equal(isMicrophonePermissionPage("?microphonePermission=1"), true);
  assert.equal(isMicrophonePermissionPage("?microphonePermission=0"), false);
  assert.equal(isMicrophonePermissionPage(""), false);
});

test("accepts only the exact microphone permission completion message", () => {
  assert.equal(isMicrophonePermissionGrantedMessage({ type: MICROPHONE_PERMISSION_GRANTED }), true);
  assert.equal(isMicrophonePermissionGrantedMessage({ type: "other" }), false);
  assert.equal(isMicrophonePermissionGrantedMessage(null), false);
});
