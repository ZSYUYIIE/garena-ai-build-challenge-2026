import {
  MessageAction,
  ExtensionStatusQuery,
  ExtensionStatusResponse,
} from "@/types";

chrome.runtime.onInstalled.addListener(() => {
  // Configures clicking the extension action icon to open the side panel
  chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });
});

const EXTENSION_STATUS_ON = "ON";
const EXTENSION_STATUS_OFF = "OFF";
function isExtensionStatusOn(badgeText: string): boolean {
  return badgeText === EXTENSION_STATUS_ON;
}

// When the extension is installed, set the default badge text to "OFF"
chrome.runtime.onInstalled.addListener(() => {
  chrome.action.setBadgeText({
    text: EXTENSION_STATUS_OFF,
  });
});

chrome.runtime.onMessage.addListener(
  (
    message: ExtensionStatusQuery,
    sender: chrome.runtime.MessageSender,
    sendResponse: (response: ExtensionStatusResponse) => void,
  ) => {
    const targetTabId = message.tabId ?? sender.tab?.id;

    if (targetTabId === undefined) {
      sendResponse({
        error: "Unable to resolve target tab ID.",
      });
      return true;
    }

    switch (message.action) {
      case MessageAction.CheckExtensionStatus: {
        handleCheckStatus(targetTabId, sendResponse);
        return true; // Keep async channel open for sendResponse
      }

      case MessageAction.ToggleExtensionStatus: {
        handleToggleStatus(targetTabId, sendResponse);
        return true; // Keep async channel open for sendResponse
      }

      case MessageAction.SetExtensionStatus: {
        handleSetStatus(targetTabId, message.isRunning, sendResponse);
        return true;
      }

      case MessageAction.StatusUpdate: {
        // The action is listened to in ExtensionStatusService.onStatusUpdate, so we don't need to handle it here
        return;
      }

      default: {
        // Unrecognized action type
        return false;
      }
    }
  },
);

/**
 * Checks badge text for a specific tab
 */
function handleCheckStatus(
  tabId: number,
  sendResponse: (response: ExtensionStatusResponse) => void,
) {
  chrome.action
    .getBadgeText({ tabId })
    .then((badgeText) => {
      sendResponse({ tabId: tabId, isRunning: isExtensionStatusOn(badgeText) });
    })
    .catch((error) => {
      sendResponse({ error: error.message });
    });
}

/**
 * Flips badge text for a specific tab and broadcasts status update
 */
function handleToggleStatus(
  tabId: number,
  sendResponse: (response: ExtensionStatusResponse) => void,
) {
  chrome.action
    .getBadgeText({ tabId })
    .then((currentText) => {
      const nextState = !isExtensionStatusOn(currentText);
      const nextText = nextState ? EXTENSION_STATUS_ON : EXTENSION_STATUS_OFF;

      // Update badge text for the target tab
      return chrome.action
        .setBadgeText({ tabId, text: nextText })
        .then(() => nextState);
    })

    .then((nextState) => {
      // Broadcast update to active tab (if present)
      chrome.tabs
        .sendMessage<ExtensionStatusQuery>(tabId, {
          action: MessageAction.StatusUpdate,
          isRunning: nextState,
          tabId: tabId,
        })
        .catch(() => {
          // Ignore error if content script isn't active on target tab
        });
      sendResponse({ tabId: tabId, isRunning: nextState });
    })
    .catch((error) => {
      sendResponse({ error: error.message });
    });
}

function handleSetStatus(
  tabId: number,
  isRunning: boolean,
  sendResponse: (response: ExtensionStatusResponse) => void,
) {
  chrome.action
    .setBadgeText({
      tabId,
      text: isRunning ? EXTENSION_STATUS_ON : EXTENSION_STATUS_OFF,
    })
    .then(() => {
      sendResponse({ tabId, isRunning });
      return chrome.tabs
        .sendMessage<ExtensionStatusQuery>(tabId, {
          action: MessageAction.StatusUpdate,
          isRunning,
          tabId,
        })
        .catch(() => undefined);
    })
    .catch((error: Error) => {
      sendResponse({ error: error.message });
    });
}
