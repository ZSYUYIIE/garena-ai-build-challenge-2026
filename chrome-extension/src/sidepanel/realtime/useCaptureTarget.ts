import { useEffect, useState } from "react";

import {
  CAPTURE_TARGETS_STORAGE_KEY,
  captureGuidance,
  captureTargetsFromValue,
  isTargetReadyForActiveTab,
  loadCaptureTarget,
  targetForWindow,
  type CaptureTargetState,
} from "../../services/captureTarget";

export type CaptureTargetSnapshot = {
  target: CaptureTargetState | null;
  activeTabId: number | null;
  canStart: boolean;
  guidance: string;
};

export function useCaptureTarget(): CaptureTargetSnapshot {
  const [target, setTarget] = useState<CaptureTargetState | null>(null);
  const [activeTabId, setActiveTabId] = useState<number | null>(null);

  useEffect(() => {
    let disposed = false;
    let currentWindowId: number | null = null;

    const handleStorageChange = (
      changes: Record<string, chrome.storage.StorageChange>,
      areaName: string,
    ) => {
      if (areaName !== "session" || currentWindowId === null) return;
      const change = changes[CAPTURE_TARGETS_STORAGE_KEY];
      if (!change) return;

      setTarget(
        targetForWindow(
          captureTargetsFromValue(change.newValue),
          currentWindowId,
        ),
      );
    };

    const handleTabActivated = (activeInfo: chrome.tabs.OnActivatedInfo) => {
      if (activeInfo.windowId === currentWindowId) {
        setActiveTabId(activeInfo.tabId);
      }
    };

    chrome.storage.onChanged.addListener(handleStorageChange);
    chrome.tabs.onActivated.addListener(handleTabActivated);

    const initialize = async () => {
      const currentWindow = await chrome.windows.getCurrent();
      if (currentWindow.id === undefined) {
        throw new Error("Unable to resolve the current Chrome window.");
      }
      currentWindowId = currentWindow.id;

      const [tabs, initialTarget] = await Promise.all([
        chrome.tabs.query({ active: true, windowId: currentWindowId }),
        loadCaptureTarget(currentWindowId),
      ]);
      if (disposed) return;

      setActiveTabId(tabs[0]?.id ?? null);
      setTarget(initialTarget);
    };

    void initialize().catch(() => {
      if (!disposed) {
        setActiveTabId(null);
        setTarget(null);
      }
    });

    return () => {
      disposed = true;
      chrome.storage.onChanged.removeListener(handleStorageChange);
      chrome.tabs.onActivated.removeListener(handleTabActivated);
    };
  }, []);

  return {
    target,
    activeTabId,
    canStart: isTargetReadyForActiveTab(target, activeTabId),
    guidance: captureGuidance(target, activeTabId),
  };
}
