import net from "node:net";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  buildProcessPlan,
  createChildEnvironment,
  findViteCli,
  validateProcessPlan,
  withResolvedViteCli,
} from "./dev-plan.js";
import { superviseProcessPlan } from "./process-supervisor.js";

export function probePort({ host, port }) {
  return new Promise((resolve, reject) => {
    const server = net.createServer();

    server.once("error", (error) => {
      reject(
        new Error(
          `${host}:${port} is unavailable (${error.code ?? error.message}). Stop the process using that port and try again. On Windows, run: Get-NetTCPConnection -LocalPort ${port} -State Listen`,
        ),
      );
    });

    server.once("listening", () => {
      server.close((error) => {
        if (error) {
          reject(error);
          return;
        }
        resolve();
      });
    });

    server.listen({ host, port, exclusive: true });
  });
}

export async function assertPortsAvailable(plan, probe = probePort) {
  await Promise.all(
    plan.processes.map(({ id, host, port }) => probe({ id, host, port })),
  );
}

export function makeRunnablePlan(plan, baseEnvironment = process.env) {
  return {
    ...plan,
    processes: plan.processes.map((processSpec) => ({
      ...processSpec,
      environment: createChildEnvironment(baseEnvironment, processSpec),
    })),
  };
}

export async function main(
  argv = process.argv.slice(2),
  {
    baseEnvironment = process.env,
    stderr = process.stderr,
    portProbe = probePort,
    supervise = superviseProcessPlan,
  } = {},
) {
  if (argv.length > 1) {
    stderr.write("Usage: node scripts/dev-runner.js [all|dashboard|realtime]\n");
    return 1;
  }

  try {
    const profile = argv[0] ?? "all";
    const draftPlan = validateProcessPlan(buildProcessPlan(profile));
    const viteCliPath = findViteCli();
    const plan = withResolvedViteCli(draftPlan, viteCliPath);

    await assertPortsAvailable(plan, portProbe);
    return await supervise(makeRunnablePlan(plan, baseEnvironment));
  } catch (error) {
    stderr.write(`[dev] ${error.message}\n`);
    return 1;
  }
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
      process.stderr.write(`[dev] ${error.stack ?? error.message}\n`);
      process.exitCode = 1;
    });
}
