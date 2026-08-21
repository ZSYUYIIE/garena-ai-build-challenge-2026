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

test("allows the loopback Vite loader only in the unpacked development manifest", () => {
  const productionManifest = createExtensionManifest({
    name: "StreamSense test",
    version: "1.2.3",
  });
  const developmentManifest = createExtensionManifest(
    {
      name: "StreamSense test",
      version: "1.2.3",
    },
    { development: true },
  );

  const productionPolicy =
    productionManifest.content_security_policy?.extension_pages ?? "";
  const developmentPolicy =
    developmentManifest.content_security_policy?.extension_pages ?? "";

  assert.equal(
    productionManifest.host_permissions?.some((permission) =>
      permission.includes(":5173"),
    ),
    false,
  );
  assert.equal(productionPolicy.includes(":5173"), false);

  assert.equal(
    developmentManifest.host_permissions?.includes(
      "http://localhost:5173/*",
    ),
    true,
  );
  assert.match(developmentPolicy, /script-src[^;]*http:\/\/localhost:5173/);
  assert.match(developmentPolicy, /connect-src[^;]*ws:\/\/localhost:5173/);
});

test("allows packaged WebAssembly without allowing arbitrary eval or remote scripts", () => {
  for (const development of [false, true]) {
    const manifest = createExtensionManifest(
      { name: "StreamSense test", version: "1.2.3" },
      { development },
    );
    const policy = manifest.content_security_policy?.extension_pages ?? "";
    assert.match(policy, /script-src[^;]*'self'[^;]*'wasm-unsafe-eval'/);
    assert.doesNotMatch(policy, /(?:^|\s)'unsafe-eval'(?:\s|;|$)/);
    if (!development) assert.doesNotMatch(policy, /script-src[^;]*https?:/);
  }
});
