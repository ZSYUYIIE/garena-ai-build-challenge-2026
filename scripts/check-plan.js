import { PROJECT_ROOT } from "./dev-plan.js";

export function npmExecutable(platform = process.platform) {
  return platform === "win32" ? "npm.cmd" : "npm";
}

export function buildCheckPlan({
  rootDir = PROJECT_ROOT,
  platform = process.platform,
} = {}) {
  const command = npmExecutable(platform);
  const shell = platform === "win32";

  return [
    {
      id: "orchestration",
      label: "root orchestration tests",
      command,
      shell,
      args: ["run", "check:orchestration"],
      cwd: rootDir,
    },
    {
      id: "backend",
      label: "backend checks",
      command,
      shell,
      args: ["run", "check", "--workspace", "ai-voice-realtime"],
      cwd: rootDir,
    },
    {
      id: "extension-test",
      label: "extension tests",
      command,
      shell,
      args: ["run", "test", "--workspace", "chrome-extension"],
      cwd: rootDir,
    },
    {
      id: "extension-build",
      label: "extension build",
      command,
      shell,
      args: ["run", "build", "--workspace", "chrome-extension"],
      cwd: rootDir,
    },
    {
      id: "dashboard",
      label: "dashboard checks",
      command,
      shell,
      args: ["run", "check", "--workspace", "session-dashboard"],
      cwd: rootDir,
    },
  ];
}
