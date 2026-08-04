import {
  authorizeCaptureTarget,
  saveCaptureTarget,
} from "./captureTarget";
import { syncCaptureBadge } from "./captureBadge";

void chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: false });

chrome.action.onClicked.addListener((tab) => {
  void authorizeCaptureTarget(tab, {
    persistTarget: saveCaptureTarget,
    openPanel: (tabId) => chrome.sidePanel.open({ tabId }),
  }).catch((error) => {
    console.error("Could not authorize StreamSense capture:", error);
  });
});

chrome.tabCapture.onStatusChanged.addListener((info) => {
  void syncCaptureBadge(info, (details) =>
    chrome.action.setBadgeText(details),
  ).catch((error) => {
    console.error("Could not update the StreamSense capture badge:", error);
  });
});

chrome.runtime.onInstalled.addListener(() => {
  void chrome.action.setBadgeText({ text: "OFF" });
});
