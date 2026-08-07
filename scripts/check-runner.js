import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { buildCheckPlan } from "./check-plan.js";
import { signalExitCode, unexpectedExitCode } from "./process-supervisor.js";

export function runCheckStep(step, spawnImpl = spawn) {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (result) => {
      if (settled) {
        return;
      }
      settled = true;
      resolve(result);
    };

    let child;
    try {
      child = spawnImpl(step.command, step.args, {
        cwd: step.cwd,
        stdio: "inherit",
        windowsHide: true,
        shell: step.shell,
      });
    } catch (error) {
      finish({ code: 1, error });
      return;
    }

    child.once("error", (error) => finish({ code: 1, error }));
    child.once("exit", (code, signal) => {
      finish({
        code:
          code === 0 && !signal
            ? 0
            : signal
              ? signalExitCode(signal)
              : unexpectedExitCode(code),
        signal,
        succeeded: code === 0 && !signal,
      });
    });
  });
}

export async function runCheckPlan(
  plan,
  {
    spawnImpl = spawn,
    stdout = process.stdout,
    stderr = process.stderr,
  } = {},
) {
  for (const step of plan) {
    stdout.write(`[check] ${step.label}\n`);
    const result = await runCheckStep(step, spawnImpl);

    if (!result.succeeded) {
      const detail = result.error
        ? result.error.message
        : result.signal
          ? `signal ${result.signal}`
          : `exit code ${result.code}`;
      stderr.write(`[check] ${step.label} failed (${detail}).\n`);
      return result.code;
    }
  }

  stdout.write("[check] All workspace checks passed.\n");
  return 0;
}

export async function main() {
  return runCheckPlan(buildCheckPlan());
}

const isMainModule =
  process.argv[1] &&
  path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url));

if (isMainModule) {
  main()
    .then((exitCode) => {
      process.exitCode = exitCode;
    })
    .catch((error) => {
      process.stderr.write(`[check] ${error.stack ?? error.message}\n`);
      process.exitCode = 1;
    });
}
