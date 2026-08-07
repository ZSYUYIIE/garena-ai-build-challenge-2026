import { spawn } from "node:child_process";
import { StringDecoder } from "node:string_decoder";

export function createLinePrefixer(prefix, writeLine) {
  const decoder = new StringDecoder("utf8");
  let buffered = "";

  function flushCompleteLines() {
    let newlineIndex = buffered.indexOf("\n");
    while (newlineIndex !== -1) {
      const line = buffered.slice(0, newlineIndex).replace(/\r$/, "");
      writeLine(`${prefix}${line}\n`);
      buffered = buffered.slice(newlineIndex + 1);
      newlineIndex = buffered.indexOf("\n");
    }
  }

  return {
    write(chunk) {
      buffered +=
        typeof chunk === "string" ? chunk : decoder.write(Buffer.from(chunk));
      flushCompleteLines();
    },
    end() {
      buffered += decoder.end();
      flushCompleteLines();
      if (buffered.length > 0) {
        writeLine(`${prefix}${buffered.replace(/\r$/, "")}\n`);
        buffered = "";
      }
    },
  };
}

export function signalExitCode(signal) {
  return {
    SIGINT: 130,
    SIGTERM: 143,
    SIGBREAK: 149,
  }[signal] ?? 1;
}

export function unexpectedExitCode(code) {
  return Number.isInteger(code) && code > 0 ? code : 1;
}

export function terminationAction(
  pid,
  platform = process.platform,
  { force = false } = {},
) {
  if (!Number.isInteger(pid) || pid <= 0) {
    throw new Error(`Cannot terminate an invalid process id: ${pid}.`);
  }

  if (platform === "win32") {
    return {
      command: "taskkill.exe",
      args: ["/PID", String(pid), "/T", ...(force ? ["/F"] : [])],
    };
  }

  return {
    pid: -pid,
    signal: "SIGTERM",
    forceSignal: "SIGKILL",
  };
}

function processHasExited(child) {
  return (
    (child.exitCode !== null && child.exitCode !== undefined) ||
    (child.signalCode !== null && child.signalCode !== undefined)
  );
}

export function waitForProcessExit(child, timeoutMs = 2500) {
  if (processHasExited(child)) {
    return Promise.resolve(true);
  }

  return new Promise((resolve) => {
    let settled = false;
    const finish = (exited) => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timer);
      child.off?.("exit", onExit);
      child.off?.("close", onExit);
      resolve(exited);
    };
    const onExit = () => finish(true);
    const timer = setTimeout(() => finish(false), timeoutMs);

    child.once?.("exit", onExit);
    child.once?.("close", onExit);
  });
}

function fallbackChildKill(child, signal = "SIGKILL") {
  try {
    child.kill?.(signal);
  } catch {
    // The process already exited or cannot be addressed directly.
  }
}

function runWindowsTreeKill(child, { force, spawnImpl, timeoutMs }) {
  const action = terminationAction(child.pid, "win32", { force });

  return new Promise((resolve) => {
    let settled = false;
    let killer;
    let timer;

    const finish = (succeeded) => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timer);
      resolve(succeeded);
    };

    try {
      killer = spawnImpl(action.command, action.args, {
        stdio: "ignore",
        windowsHide: true,
      });
    } catch {
      resolve(false);
      return;
    }

    timer = setTimeout(() => {
      fallbackChildKill(killer);
      finish(false);
    }, timeoutMs);

    killer.once("error", () => finish(false));
    killer.once("exit", (code) => finish(code === 0));
  });
}

async function terminateWindowsTree(
  child,
  {
    spawnImpl,
    waitForExit,
    gracefulTimeoutMs,
    timeoutMs,
  },
) {
  const gracefulTreeSignalSent = await runWindowsTreeKill(child, {
    force: false,
    spawnImpl,
    timeoutMs: gracefulTimeoutMs,
  });

  if (gracefulTreeSignalSent) {
    const exitedGracefully = await waitForExit(child, gracefulTimeoutMs);
    if (exitedGracefully) {
      return;
    }
  }

  const forcedTreeKillSucceeded = await runWindowsTreeKill(child, {
    force: true,
    spawnImpl,
    timeoutMs,
  });
  if (!forcedTreeKillSucceeded) {
    fallbackChildKill(child);
  }
}

export async function terminateProcessTree(
  child,
  {
    platform = process.platform,
    spawnImpl = spawn,
    processKill = process.kill.bind(process),
    waitForExit = waitForProcessExit,
    gracefulTimeoutMs = 750,
    timeoutMs = 2500,
  } = {},
) {
  if (!child?.pid || processHasExited(child)) {
    return;
  }

  if (platform === "win32") {
    await terminateWindowsTree(child, {
      spawnImpl,
      waitForExit,
      gracefulTimeoutMs,
      timeoutMs,
    });
    return;
  }

  const action = terminationAction(child.pid, platform);
  try {
    processKill(action.pid, action.signal);
  } catch (error) {
    if (error?.code === "ESRCH") {
      return;
    }
    fallbackChildKill(child, action.signal);
  }

  const exited = await waitForExit(child, timeoutMs);
  if (!exited) {
    try {
      processKill(action.pid, action.forceSignal);
    } catch (error) {
      if (error?.code !== "ESRCH") {
        fallbackChildKill(child);
      }
    }
  }
}

export async function superviseProcessPlan(
  plan,
  {
    spawnImpl = spawn,
    platform = process.platform,
    processRef = process,
    stdout = process.stdout,
    stderr = process.stderr,
    terminate = terminateProcessTree,
  } = {},
) {
  const children = [];
  let shutdownPromise;
  let resolveCompletion;
  const completion = new Promise((resolve) => {
    resolveCompletion = resolve;
  });

  const signalHandlers = new Map();

  const removeSignalHandlers = () => {
    for (const [signal, handler] of signalHandlers) {
      processRef.off(signal, handler);
    }
    signalHandlers.clear();
  };

  const shutdown = (reason, exitCode) => {
    if (shutdownPromise) {
      return shutdownPromise;
    }

    stderr.write(`[dev] ${reason}\n`);
    shutdownPromise = Promise.allSettled(
      children.map(({ child }) => terminate(child, { platform })),
    ).then(() => {
      removeSignalHandlers();
      resolveCompletion(exitCode);
      return exitCode;
    });
    return shutdownPromise;
  };

  const signals = [
    "SIGINT",
    "SIGTERM",
    ...(platform === "win32" ? ["SIGBREAK"] : []),
  ];
  for (const signal of signals) {
    const handler = () => {
      void shutdown(
        `Received ${signal}; stopping all dev processes.`,
        signalExitCode(signal),
      );
    };
    signalHandlers.set(signal, handler);
    processRef.on(signal, handler);
  }

  try {
    for (const processSpec of plan.processes) {
      const child = spawnImpl(processSpec.command, processSpec.args, {
        cwd: processSpec.cwd,
        env: processSpec.environment,
        stdio: ["ignore", "pipe", "pipe"],
        windowsHide: true,
        detached: platform !== "win32",
      });
      children.push({ child, processSpec });

      stdout.write(
        `[dev] ${processSpec.id} starting on http://${processSpec.host}:${processSpec.port}\n`,
      );

      const stdoutPrefixer = createLinePrefixer(
        `[${processSpec.id}] `,
        (line) => stdout.write(line),
      );
      const stderrPrefixer = createLinePrefixer(
        `[${processSpec.id}] `,
        (line) => stderr.write(line),
      );

      child.stdout?.on("data", (chunk) => stdoutPrefixer.write(chunk));
      child.stdout?.once("end", () => stdoutPrefixer.end());
      child.stderr?.on("data", (chunk) => stderrPrefixer.write(chunk));
      child.stderr?.once("end", () => stderrPrefixer.end());

      child.once("error", (error) => {
        void shutdown(
          `${processSpec.id} failed to start: ${error.message}`,
          1,
        );
      });

      child.once("exit", (code, signal) => {
        if (shutdownPromise) {
          return;
        }
        const detail = signal ? `signal ${signal}` : `code ${code}`;
        void shutdown(
          `${processSpec.id} exited unexpectedly (${detail}); stopping the remaining processes.`,
          unexpectedExitCode(code),
        );
      });
    }
  } catch (error) {
    await shutdown(`Unable to start a dev process: ${error.message}`, 1);
  }

  return completion;
}
