import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import test from "node:test";

import {
  createLinePrefixer,
  signalExitCode,
  superviseProcessPlan,
  terminateProcessTree,
  terminationAction,
  unexpectedExitCode,
} from "../scripts/process-supervisor.js";

test("line prefixer preserves split log lines and flushes the final fragment", () => {
  const output = [];
  const prefixer = createLinePrefixer("[backend] ", (line) => output.push(line));

  prefixer.write("first line\nsecond");
  prefixer.write(" line\r\nlast");
  prefixer.end();

  assert.deepEqual(output, [
    "[backend] first line\n",
    "[backend] second line\n",
    "[backend] last\n",
  ]);
});

test("Windows termination falls back to taskkill for the full child tree", async () => {
  const invocations = [];
  const childSignals = [];
  const child = {
    pid: 4321,
    exitCode: null,
    signalCode: null,
    kill(signal) {
      childSignals.push(signal);
    },
  };

  await terminateProcessTree(child, {
    platform: "win32",
    timeoutMs: 100,
    waitForExit: async () => false,
    spawnImpl(command, args, options) {
      invocations.push({ command, args, options });
      const killer = new EventEmitter();
      killer.kill = () => {};
      queueMicrotask(() => killer.emit("exit", 0));
      return killer;
    },
  });

  assert.deepEqual(invocations, [
    {
      command: "taskkill.exe",
      args: ["/PID", "4321", "/T"],
      options: { stdio: "ignore", windowsHide: true },
    },
    {
      command: "taskkill.exe",
      args: ["/PID", "4321", "/T", "/F"],
      options: { stdio: "ignore", windowsHide: true },
    },
  ]);
  assert.deepEqual(childSignals, []);
});

test("Windows termination gives the full tree a non-forced exit first", async () => {
  const childSignals = [];
  const invocations = [];
  const child = {
    pid: 9876,
    exitCode: null,
    signalCode: null,
    kill(signal) {
      childSignals.push(signal);
    },
  };

  await terminateProcessTree(child, {
    platform: "win32",
    gracefulTimeoutMs: 25,
    waitForExit: async (_child, timeoutMs) => {
      assert.equal(timeoutMs, 25);
      return true;
    },
    spawnImpl(command, args) {
      invocations.push([command, args]);
      const killer = new EventEmitter();
      killer.kill = () => {};
      queueMicrotask(() => killer.emit("exit", 0));
      return killer;
    },
  });

  assert.deepEqual(childSignals, []);
  assert.deepEqual(invocations, [
    ["taskkill.exe", ["/PID", "9876", "/T"]],
  ]);
});

test("POSIX termination escalates the detached process group after timeout", async () => {
  const signals = [];
  const child = {
    pid: 7654,
    exitCode: null,
    signalCode: null,
    kill() {
      assert.fail("direct child kill should not be needed");
    },
  };

  await terminateProcessTree(child, {
    platform: "linux",
    processKill(pid, signal) {
      signals.push([pid, signal]);
    },
    waitForExit: async () => false,
  });

  assert.deepEqual(signals, [
    [-7654, "SIGTERM"],
    [-7654, "SIGKILL"],
  ]);
});

test("termination skips a process that already exited", async () => {
  let spawned = false;

  await terminateProcessTree(
    { pid: 1234, exitCode: 0, signalCode: null },
    {
      platform: "win32",
      spawnImpl() {
        spawned = true;
      },
    },
  );

  assert.equal(spawned, false);
});

test("termination actions and exit codes are deterministic", () => {
  assert.deepEqual(terminationAction(99, "win32"), {
    command: "taskkill.exe",
    args: ["/PID", "99", "/T"],
  });
  assert.deepEqual(terminationAction(99, "win32", { force: true }), {
    command: "taskkill.exe",
    args: ["/PID", "99", "/T", "/F"],
  });
  assert.deepEqual(terminationAction(99, "linux"), {
    pid: -99,
    signal: "SIGTERM",
    forceSignal: "SIGKILL",
  });
  assert.equal(signalExitCode("SIGINT"), 130);
  assert.equal(signalExitCode("SIGTERM"), 143);
  assert.equal(unexpectedExitCode(7), 7);
  assert.equal(unexpectedExitCode(0), 1);
});

function fakeChild(pid) {
  const child = new EventEmitter();
  child.pid = pid;
  child.exitCode = null;
  child.signalCode = null;
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  return child;
}

function fakeProcessSpec(id, port) {
  return {
    id,
    host: "127.0.0.1",
    port,
    command: process.execPath,
    args: ["fake.js"],
    cwd: "C:\\workspace",
    environment: {},
  };
}

test("Ctrl+C shuts down every child tree and returns exit code 130", async () => {
  const processRef = new EventEmitter();
  const children = [fakeChild(1001), fakeChild(1002), fakeChild(1003)];
  const terminated = [];
  const output = { write() {} };

  const completion = superviseProcessPlan(
    {
      processes: [
        fakeProcessSpec("backend", 8000),
        fakeProcessSpec("extension", 5173),
        fakeProcessSpec("dashboard", 5174),
      ],
    },
    {
      platform: "win32",
      processRef,
      stdout: output,
      stderr: output,
      spawnImpl: () => children.shift(),
      terminate: async (child) => {
        terminated.push(child.pid);
      },
    },
  );

  processRef.emit("SIGINT");

  assert.equal(await completion, 130);
  assert.deepEqual(terminated, [1001, 1002, 1003]);
});

test("an early clean child exit is still fail-fast and stops siblings", async () => {
  const processRef = new EventEmitter();
  const spawnedChildren = [fakeChild(2001), fakeChild(2002)];
  const queue = [...spawnedChildren];
  const terminated = [];
  const output = { write() {} };

  const completion = superviseProcessPlan(
    {
      processes: [
        fakeProcessSpec("backend", 8000),
        fakeProcessSpec("extension", 5173),
      ],
    },
    {
      platform: "win32",
      processRef,
      stdout: output,
      stderr: output,
      spawnImpl: () => queue.shift(),
      terminate: async (child) => {
        terminated.push(child.pid);
      },
    },
  );

  spawnedChildren[0].emit("exit", 0, null);

  assert.equal(await completion, 1);
  assert.deepEqual(terminated, [2001, 2002]);
});
