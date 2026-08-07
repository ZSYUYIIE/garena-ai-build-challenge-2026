import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import net from "node:net";
import test from "node:test";

import {
  buildProcessPlan,
  createChildEnvironment,
  validateProcessPlan,
} from "../scripts/dev-plan.js";
import {
  assertPortsAvailable,
  makeRunnablePlan,
  probePort,
} from "../scripts/dev-runner.js";

const FAKE_VITE_CLI = "C:\\workspace\\node_modules\\vite\\bin\\vite.js";
const ROOT_PACKAGE = JSON.parse(
  readFileSync(new URL("../package.json", import.meta.url), "utf8"),
);

test("root build and demo scripts stay workspace-based and single-backend", () => {
  assert.equal(ROOT_PACKAGE.dependencies["better-sqlite3"], "13.0.2");
  assert.equal(
    ROOT_PACKAGE.scripts.build,
    "npm run build --workspace chrome-extension --workspace session-dashboard",
  );
  assert.equal(ROOT_PACKAGE.scripts.predemo, "npm run build");
  assert.equal(
    ROOT_PACKAGE.scripts.demo,
    "npm run start:dashboard-demo --workspace ai-voice-realtime",
  );
  assert.equal(ROOT_PACKAGE.scripts.check, "node scripts/check-runner.js");
  assert.match(ROOT_PACKAGE.scripts["check:orchestration"], /^node --test /);
});

test("all profile starts one backend plus extension and dashboard on fixed ports", () => {
  const plan = validateProcessPlan(
    buildProcessPlan("all", { viteCliPath: FAKE_VITE_CLI }),
  );

  assert.deepEqual(
    plan.processes.map(({ id, port }) => [id, port]),
    [
      ["backend", 8000],
      ["extension", 5173],
      ["dashboard", 5174],
    ],
  );
  assert.equal(
    plan.processes.filter(({ role }) => role === "backend").length,
    1,
  );
  assert.deepEqual(plan.processes[0].args, ["--watch", "server.js"]);
  assert.equal(
    plan.processes[1].env.VITE_STREAMSENSE_DASHBOARD_URL,
    "http://127.0.0.1:5174/dashboard/",
  );
});

test("dashboard profile runs the demo-history backend watcher and dashboard only", () => {
  const plan = validateProcessPlan(
    buildProcessPlan("dashboard", { viteCliPath: FAKE_VITE_CLI }),
  );

  assert.deepEqual(
    plan.processes.map(({ id, port }) => [id, port]),
    [
      ["backend", 8000],
      ["dashboard", 5174],
    ],
  );
  assert.deepEqual(plan.processes[0].args, [
    "--watch",
    "scripts/startDashboardDemo.js",
  ]);
});

test("realtime profile pins an empty dashboard override and runs no dashboard", () => {
  const plan = validateProcessPlan(
    buildProcessPlan("realtime", { viteCliPath: FAKE_VITE_CLI }),
  );
  const extension = plan.processes.find(({ id }) => id === "extension");

  assert.deepEqual(
    plan.processes.map(({ id, port }) => [id, port]),
    [
      ["backend", 8000],
      ["extension", 5173],
    ],
  );
  assert.equal(extension.env.VITE_STREAMSENSE_DASHBOARD_URL, "");
  assert.deepEqual(extension.unsetEnv, []);
});

test("realtime child environment overrides inherited dashboard values with empty", () => {
  const realtimePlan = buildProcessPlan("realtime", {
    viteCliPath: FAKE_VITE_CLI,
  });
  const extension = realtimePlan.processes.find(({ id }) => id === "extension");
  const environment = createChildEnvironment(
    {
      PATH: "C:\\tools",
      VITE_STREAMSENSE_DASHBOARD_URL: "http://stale.example/",
    },
    extension,
  );

  assert.equal(environment.PATH, "C:\\tools");
  assert.equal(environment.VITE_STREAMSENSE_DASHBOARD_URL, "");
});

test("plan validation rejects a second backend", () => {
  const plan = buildProcessPlan("all", { viteCliPath: FAKE_VITE_CLI });
  plan.processes[1].role = "backend";

  assert.throws(
    () => validateProcessPlan(plan),
    /exactly one backend; found 2/,
  );
});

test("plan validation rejects duplicate host and port pairs", () => {
  const plan = buildProcessPlan("all", { viteCliPath: FAKE_VITE_CLI });
  plan.processes[2].port = 5173;

  assert.throws(() => validateProcessPlan(plan), /Duplicate dev endpoint/);
});

test("port preflight probes every planned service before spawning", async () => {
  const plan = validateProcessPlan(
    buildProcessPlan("all", { viteCliPath: FAKE_VITE_CLI }),
  );
  const probed = [];

  await assertPortsAvailable(plan, async (endpoint) => {
    probed.push(endpoint);
  });

  assert.deepEqual(
    probed.map(({ id, port }) => [id, port]),
    [
      ["backend", 8000],
      ["extension", 5173],
      ["dashboard", 5174],
    ],
  );
});

test("port preflight rejects an occupied fixed port", async () => {
  const plan = validateProcessPlan(
    buildProcessPlan("realtime", { viteCliPath: FAKE_VITE_CLI }),
  );

  await assert.rejects(
    assertPortsAvailable(plan, async ({ port }) => {
      if (port === 5173) {
        throw new Error("5173 is occupied");
      }
    }),
    /5173 is occupied/,
  );
});

test("real port probe reports an occupied loopback endpoint clearly", async () => {
  const occupiedServer = net.createServer();
  await new Promise((resolve, reject) => {
    occupiedServer.once("error", reject);
    occupiedServer.listen({ host: "127.0.0.1", port: 0 }, resolve);
  });

  try {
    const address = occupiedServer.address();
    assert.ok(address && typeof address !== "string");

    await assert.rejects(
      probePort({ host: "127.0.0.1", port: address.port }),
      new RegExp(
        `127\\.0\\.0\\.1:${address.port} is unavailable \\(EADDRINUSE\\).*Stop the process`,
      ),
    );
  } finally {
    await new Promise((resolve, reject) => {
      occupiedServer.close((error) => (error ? reject(error) : resolve()));
    });
  }
});

test("runnable plans build isolated child environments", () => {
  const plan = buildProcessPlan("all", { viteCliPath: FAKE_VITE_CLI });
  const runnable = makeRunnablePlan(plan, { PATH: "C:\\tools" });

  assert.notEqual(runnable.processes[0].environment, runnable.processes[1].environment);
  assert.equal(runnable.processes[0].environment.PORT, "8000");
  assert.equal(
    runnable.processes[1].environment.VITE_STREAMSENSE_DASHBOARD_URL,
    "http://127.0.0.1:5174/dashboard/",
  );
});
