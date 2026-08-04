import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const projectDirectory = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  ".."
);

test("server entrypoint reports its actual ephemeral port", async (t) => {
  const child = spawn(process.execPath, ["server.js"], {
    cwd: projectDirectory,
    env: {
      ...process.env,
      GOOGLE_API_KEY: "test-key",
      GEMINI_VISION_MODEL: "test-model",
      EVENT_DB_PATH: ":memory:",
      HOST: "127.0.0.1",
      PORT: "0",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  t.after(() => child.kill("SIGTERM"));

  const line = await readStartupLine(child);
  const match = /Server running on http:\/\/127\.0\.0\.1:(\d+)/.exec(line);

  assert.ok(match, line);
  assert.ok(Number(match[1]) > 0, line);
});

function readStartupLine(child) {
  return new Promise((resolve, reject) => {
    let stdout = "";
    let stderr = "";
    const timeout = setTimeout(() => {
      reject(new Error(`Server startup timed out. stderr: ${stderr}`));
    }, 2_000);

    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
      const line = stdout.split("\n").find((entry) => entry.includes("Server running"));
      if (line) {
        clearTimeout(timeout);
        resolve(line);
      }
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    child.once("exit", (code, signal) => {
      clearTimeout(timeout);
      reject(
        new Error(
          `Server exited before startup (code ${code}, signal ${signal}). ${stderr}`
        )
      );
    });
  });
}
