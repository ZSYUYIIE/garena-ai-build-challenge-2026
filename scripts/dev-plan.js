import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const PROJECT_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);

export const DEV_HOST = "127.0.0.1";

const PROFILE_PORTS = Object.freeze({
  all: [8000, 5173, 5174],
  dashboard: [8000, 5174],
  realtime: [8000, 5173],
});

function backendProcess(rootDir, demoHistory) {
  return {
    id: "backend",
    role: "backend",
    cwd: path.join(rootDir, "ai-voice-realtime"),
    command: process.execPath,
    args: [
      "--watch",
      demoHistory ? "scripts/startDashboardDemo.js" : "server.js",
    ],
    host: DEV_HOST,
    port: 8000,
    env: {
      HOST: DEV_HOST,
      PORT: "8000",
    },
  };
}

function viteProcess({ id, rootDir, port, env, unsetEnv, viteCliPath }) {
  const workspace =
    id === "extension" ? "chrome-extension" : "session-dashboard";
  const cwd = path.join(rootDir, workspace);

  return {
    id,
    role: id,
    cwd,
    command: process.execPath,
    args: [
      viteCliPath ?? path.join(rootDir, "node_modules", "vite", "bin", "vite.js"),
      "--host",
      DEV_HOST,
      "--port",
      String(port),
      "--strictPort",
    ],
    host: DEV_HOST,
    port,
    env: env ?? {},
    unsetEnv: unsetEnv ?? [],
  };
}

export function buildProcessPlan(
  profile,
  { rootDir = PROJECT_ROOT, viteCliPath } = {},
) {
  if (!(profile in PROFILE_PORTS)) {
    throw new Error(
      `Unknown dev profile "${profile}". Expected one of: ${Object.keys(PROFILE_PORTS).join(", ")}.`,
    );
  }

  const processes = [];

  if (profile === "all" || profile === "dashboard") {
    processes.push(backendProcess(rootDir, true));
  } else {
    processes.push(backendProcess(rootDir, false));
  }

  if (profile === "all" || profile === "realtime") {
    processes.push(
      viteProcess({
        id: "extension",
        rootDir,
        port: 5173,
        viteCliPath,
        env:
          profile === "all"
            ? {
                VITE_STREAMSENSE_DASHBOARD_URL:
                  "http://127.0.0.1:5174/dashboard/",
              }
            : { VITE_STREAMSENSE_DASHBOARD_URL: "" },
      }),
    );
  }

  if (profile === "all" || profile === "dashboard") {
    processes.push(
      viteProcess({
        id: "dashboard",
        rootDir,
        port: 5174,
        viteCliPath,
      }),
    );
  }

  return { profile, processes };
}

export function validateProcessPlan(plan) {
  if (!plan || !Array.isArray(plan.processes) || plan.processes.length === 0) {
    throw new Error("The dev process plan must contain at least one process.");
  }

  const expectedPorts = PROFILE_PORTS[plan.profile];
  if (!expectedPorts) {
    throw new Error(`The dev process plan has an unknown profile: ${plan.profile}.`);
  }

  const ids = new Set();
  const endpoints = new Set();
  const backends = [];

  for (const processSpec of plan.processes) {
    if (ids.has(processSpec.id)) {
      throw new Error(`Duplicate process id in dev plan: ${processSpec.id}.`);
    }
    ids.add(processSpec.id);

    if (processSpec.role === "backend") {
      backends.push(processSpec);
    }

    if (
      !Number.isInteger(processSpec.port) ||
      processSpec.port < 1 ||
      processSpec.port > 65535
    ) {
      throw new Error(`Invalid port for ${processSpec.id}: ${processSpec.port}.`);
    }

    const endpoint = `${processSpec.host}:${processSpec.port}`;
    if (endpoints.has(endpoint)) {
      throw new Error(`Duplicate dev endpoint: ${endpoint}.`);
    }
    endpoints.add(endpoint);
  }

  if (backends.length !== 1) {
    throw new Error(
      `A dev plan must contain exactly one backend; found ${backends.length}.`,
    );
  }

  if (backends[0].port !== 8000) {
    throw new Error("The backend must listen on port 8000.");
  }

  const actualPorts = plan.processes.map(({ port }) => port).sort((a, b) => a - b);
  const sortedExpectedPorts = [...expectedPorts].sort((a, b) => a - b);
  if (
    actualPorts.length !== sortedExpectedPorts.length ||
    actualPorts.some((port, index) => port !== sortedExpectedPorts[index])
  ) {
    throw new Error(
      `Profile "${plan.profile}" must use exactly ports ${expectedPorts.join(", ")}.`,
    );
  }

  return plan;
}

export function createChildEnvironment(baseEnvironment, processSpec) {
  const environment = { ...baseEnvironment, ...processSpec.env };
  for (const key of processSpec.unsetEnv ?? []) {
    delete environment[key];
  }
  return environment;
}

export function findViteCli(
  rootDir = PROJECT_ROOT,
  { fileExists = existsSync } = {},
) {
  const candidates = [
    path.join(rootDir, "node_modules", "vite", "bin", "vite.js"),
    path.join(
      rootDir,
      "chrome-extension",
      "node_modules",
      "vite",
      "bin",
      "vite.js",
    ),
    path.join(
      rootDir,
      "session-dashboard",
      "node_modules",
      "vite",
      "bin",
      "vite.js",
    ),
  ];

  const viteCliPath = candidates.find((candidate) => fileExists(candidate));
  if (!viteCliPath) {
    throw new Error(
      `Vite is not installed. Run "npm install" from ${rootDir} first.`,
    );
  }

  return viteCliPath;
}

export function withResolvedViteCli(plan, viteCliPath) {
  return {
    ...plan,
    processes: plan.processes.map((processSpec) => {
      if (processSpec.role !== "extension" && processSpec.role !== "dashboard") {
        return processSpec;
      }

      return {
        ...processSpec,
        args: [viteCliPath, ...processSpec.args.slice(1)],
      };
    }),
  };
}
