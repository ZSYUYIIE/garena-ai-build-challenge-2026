import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import test from "node:test";

import { buildCheckPlan, npmExecutable } from "../scripts/check-plan.js";
import { runCheckPlan } from "../scripts/check-runner.js";

test("check plan covers every workspace in deterministic order", () => {
  const rootDir = "C:\\workspace";
  const plan = buildCheckPlan({ rootDir, platform: "win32" });

  assert.deepEqual(
    plan.map(({ id, args }) => [id, args]),
    [
      ["orchestration", ["run", "check:orchestration"]],
      [
        "backend",
        ["run", "check", "--workspace", "ai-voice-realtime"],
      ],
      [
        "extension-test",
        ["run", "test", "--workspace", "chrome-extension"],
      ],
      [
        "extension-build",
        ["run", "build", "--workspace", "chrome-extension"],
      ],
      [
        "dashboard",
        ["run", "check", "--workspace", "session-dashboard"],
      ],
    ],
  );
  assert.ok(plan.every(({ command }) => command === "npm.cmd"));
  assert.ok(plan.every(({ shell }) => shell === true));
  assert.ok(plan.every(({ cwd }) => cwd === rootDir));
});

test("npm executable is portable across Windows and POSIX", () => {
  assert.equal(npmExecutable("win32"), "npm.cmd");
  assert.equal(npmExecutable("linux"), "npm");
  assert.equal(npmExecutable("darwin"), "npm");
  assert.ok(
    buildCheckPlan({ rootDir: "/workspace", platform: "linux" }).every(
      ({ shell }) => shell === false,
    ),
  );
});

test("aggregate check is sequential and stops at the first failed step", async () => {
  const plan = buildCheckPlan({ rootDir: "C:\\workspace", platform: "win32" });
  const exitCodes = [0, 7, 0];
  const started = [];
  const output = [];

  const exitCode = await runCheckPlan(plan, {
    stdout: { write: (message) => output.push(message) },
    stderr: { write: (message) => output.push(message) },
    spawnImpl(command, args, options) {
      started.push({ command, args, options });
      const child = new EventEmitter();
      const childExitCode = exitCodes.shift();
      queueMicrotask(() => child.emit("exit", childExitCode, null));
      return child;
    },
  });

  assert.equal(exitCode, 7);
  assert.equal(started.length, 2);
  assert.equal(started[0].args[1], "check:orchestration");
  assert.equal(started[1].args.at(-1), "ai-voice-realtime");
  assert.match(output.join(""), /backend checks failed \(exit code 7\)/);
});

test("aggregate check reports success only after every step passes", async () => {
  const plan = buildCheckPlan({ rootDir: "/workspace", platform: "linux" });
  let started = 0;
  const output = [];

  const exitCode = await runCheckPlan(plan, {
    stdout: { write: (message) => output.push(message) },
    stderr: { write: (message) => output.push(message) },
    spawnImpl() {
      started += 1;
      const child = new EventEmitter();
      queueMicrotask(() => child.emit("exit", 0, null));
      return child;
    },
  });

  assert.equal(exitCode, 0);
  assert.equal(started, plan.length);
  assert.match(output.at(-1), /All workspace checks passed/);
});
