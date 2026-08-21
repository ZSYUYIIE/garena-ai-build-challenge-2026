import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, truncate } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import { verifyVadAssets } from "../scripts/verify-vad-assets.mjs";

async function validFixture() {
  const root = await mkdtemp(path.join(tmpdir(), "streamsense-vad-assets-"));
  const assets = path.join(root, "assets");
  await mkdir(assets);
  await writeFile(path.join(root, "manifest.json"), JSON.stringify({
    content_security_policy: {
      extension_pages: "script-src 'self' 'wasm-unsafe-eval'; object-src 'self';",
    },
  }));
  const model = path.join(assets, "silero_vad_v5-test.onnx");
  const wasm = path.join(assets, "ort-wasm-simd-threaded-test.wasm");
  await writeFile(model, "");
  await writeFile(wasm, "");
  await truncate(model, 2_400_000);
  await truncate(wasm, 13_000_000);
  await writeFile(path.join(assets, "ort-wasm-simd-threaded-test.mjs"), "export default 1;");
  await writeFile(path.join(assets, "worker.js"), "const model = './silero_vad_v5-test.onnx';");
  return root;
}

test("accepts one local model and paired ONNX runtime", async () => {
  const root = await validFixture();
  const assets = await verifyVadAssets(root);
  assert.deepEqual(assets.map((asset) => asset.file), [
    "silero_vad_v5-test.onnx",
    "ort-wasm-simd-threaded-test.wasm",
    "ort-wasm-simd-threaded-test.mjs",
  ]);
});

test("rejects duplicate assets and remote model references", async () => {
  const duplicate = await validFixture();
  await writeFile(path.join(duplicate, "assets", "silero_vad_v5-copy.onnx"), "");
  await truncate(path.join(duplicate, "assets", "silero_vad_v5-copy.onnx"), 2_400_000);
  await assert.rejects(verifyVadAssets(duplicate), /exactly one Silero/i);

  const remote = await validFixture();
  await writeFile(path.join(remote, "assets", "worker.js"), "fetch('https://example.com/model.onnx')");
  await assert.rejects(verifyVadAssets(remote), /remote VAD/i);
});

test("rejects missing WASM CSP and unsafe asset sizes", async () => {
  const root = await validFixture();
  await writeFile(path.join(root, "manifest.json"), JSON.stringify({
    content_security_policy: { extension_pages: "script-src 'self';" },
  }));
  await assert.rejects(verifyVadAssets(root), /packaged WASM/i);

  const small = await validFixture();
  await truncate(path.join(small, "assets", "silero_vad_v5-test.onnx"), 10);
  await assert.rejects(verifyVadAssets(small), /unexpected size/i);
});

test("enforces the 20 MiB aggregate VAD asset budget", async () => {
  const root = await validFixture();
  await truncate(path.join(root, "assets", "silero_vad_v5-test.onnx"), 3 * 1024 ** 2);
  await truncate(path.join(root, "assets", "ort-wasm-simd-threaded-test.wasm"), 18 * 1024 ** 2);
  await truncate(path.join(root, "assets", "ort-wasm-simd-threaded-test.mjs"), 100 * 1024);
  await assert.rejects(verifyVadAssets(root), /20 MiB/i);
});
