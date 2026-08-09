import assert from "node:assert/strict";
import test from "node:test";

import { createExtensionManifest } from "../extensionManifest.ts";

test("ships only the permissions and entry points used by the side-panel demo", () => {
  const manifest = createExtensionManifest({
    name: "StreamSense test",
    version: "1.2.3",
  });

  assert.equal(manifest.name, "StreamSense");
  assert.equal(manifest.short_name, "StreamSense");
  assert.deepEqual(manifest.icons, {
    16: "public/assets/streamsense.png",
    32: "public/assets/streamsense.png",
    48: "public/assets/streamsense.png",
    128: "public/assets/streamsense.png",
  });
  assert.deepEqual(manifest.action?.default_icon, manifest.icons);
  assert.equal(manifest.version, "1.2.3");
  assert.equal("content_scripts" in manifest, false);
  assert.deepEqual(manifest.permissions, [
    "activeTab",
    "sidePanel",
    "storage",
    "tabCapture",
    "tts",
  ]);
  assert.equal(manifest.permissions?.includes("ttsEngine"), false);
});
