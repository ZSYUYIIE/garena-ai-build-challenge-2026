import assert from "node:assert/strict";
import test from "node:test";

import { createExtensionManifest } from "../extensionManifest.ts";

test("ships only the permissions and entry points used by the side-panel demo", () => {
  const manifest = createExtensionManifest({
    name: "StreamSense test",
    version: "1.2.3",
  });

  assert.equal(manifest.name, "StreamSense test");
  assert.equal(manifest.version, "1.2.3");
  assert.equal("content_scripts" in manifest, false);
  assert.deepEqual(manifest.permissions, [
    "activeTab",
    "sidePanel",
    "storage",
    "tabCapture",
  ]);
});
