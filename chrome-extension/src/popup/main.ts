import { ExtensionStatusService } from "@/services/extensionStatus";
import "./style.css";

const toggleBtn = document.getElementById(
  "is-extension-running",
) as HTMLInputElement;

const runningStatus = document.getElementById(
  "running-status",
) as HTMLLabelElement;

if (!toggleBtn || !runningStatus) {
  throw new Error("Missing required elements.");
}

async function getCurrentTabId(): Promise<number> {
  const [activeTab] = await chrome.tabs.query({
    active: true,
    currentWindow: true,
  });

  if (!activeTab || activeTab.id === undefined) {
    throw new Error("No active tab found.");
  }

  return activeTab.id;
}

function updateUI(isRunning: boolean) {
  runningStatus.innerText = isRunning
    ? "Extension running"
    : "Extension stopped";
  toggleBtn.setAttribute("aria-checked", isRunning ? "true" : "false");
}

async function init() {
  await ExtensionStatusService.isRunning().then((isRunning) => {
    updateUI(isRunning);
  });
}

init();

// Toggle extension state
toggleBtn.addEventListener("click", async () => {
  const tabId = await getCurrentTabId();
  await ExtensionStatusService.toggle(tabId);
  await ExtensionStatusService.isRunning(tabId).then((isRunning) => {
    updateUI(isRunning);
  });
});

ExtensionStatusService.onStatusUpdate((isRunning) => {
  updateUI(isRunning);
});
