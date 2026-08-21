import { readFile, readdir, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

async function collectFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const nested = await Promise.all(entries.map(async (entry) => {
    const absolute = path.join(directory, entry.name);
    return entry.isDirectory() ? collectFiles(absolute) : [absolute];
  }));
  return nested.flat();
}

function requireOne(files, pattern, label) {
  const matches = files.filter((file) => pattern.test(path.basename(file)));
  if (matches.length !== 1) {
    throw new Error(`Expected exactly one ${label}; found ${matches.length}.`);
  }
  return matches[0];
}

async function assertSize(file, minimum, maximum, label) {
  const { size } = await stat(file);
  if (size < minimum || size > maximum) {
    throw new Error(`${label} has unexpected size ${size}.`);
  }
  return size;
}

export async function verifyVadAssets(distDirectory) {
  const files = await collectFiles(distDirectory);
  const model = requireOne(files, /^silero_vad_v5.*\.onnx$/, "Silero V5 model");
  const wasm = requireOne(files, /^ort-wasm-simd-threaded.*\.wasm$/, "ONNX WASM binary");
  const module = requireOne(files, /^ort-wasm-simd-threaded.*\.mjs$/, "ONNX WASM module");
  const manifest = JSON.parse(await readFile(path.join(distDirectory, "manifest.json"), "utf8"));
  const policy = manifest.content_security_policy?.extension_pages ?? "";
  const scriptSource = policy.split(";").find((part) => part.trim().startsWith("script-src")) ?? "";
  if (!scriptSource.includes("'wasm-unsafe-eval'") || /https?:/i.test(scriptSource)) {
    throw new Error("Production script-src must allow packaged WASM and reject remote scripts.");
  }

  const forbidden = /(?:cdn\.jsdelivr\.net|unpkg\.com|https?:\/\/[^\s"'`]+\.(?:onnx|wasm)\b)/i;
  for (const file of files.filter((candidate) => /\.(?:js|mjs)$/.test(candidate))) {
    if (forbidden.test(await readFile(file, "utf8"))) {
      throw new Error(`Remote VAD runtime or model reference found in ${path.basename(file)}.`);
    }
  }

  const sizes = [
    await assertSize(model, 2 * 1024 ** 2, 3 * 1024 ** 2, "Silero V5 model"),
    await assertSize(wasm, 10 * 1024 ** 2, 20 * 1024 ** 2, "ONNX WASM binary"),
    await assertSize(module, 1, 100 * 1024, "ONNX WASM module"),
  ];
  return [model, wasm, module].map((file, index) => ({
    file: path.basename(file),
    bytes: sizes[index],
  }));
}

const isMain = process.argv[1]
  && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url));
if (isMain) {
  verifyVadAssets(path.resolve("dist"))
    .then((assets) => {
      for (const asset of assets) process.stdout.write(`${asset.file} ${asset.bytes}\n`);
    })
    .catch((error) => {
      process.stderr.write(`${error instanceof Error ? error.message : "VAD asset verification failed."}\n`);
      process.exitCode = 1;
    });
}
