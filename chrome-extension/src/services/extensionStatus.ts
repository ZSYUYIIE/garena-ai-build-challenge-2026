/**
 * This file is a wrapper service for checking and toggling the extension status for a given tab.
 * It abstracts the message listening by a background script.
 */
import {
  MessageAction,
  ExtensionStatusQuery,
  ExtensionStatusResponse,
} from "@/types";

export class ExtensionStatusService {
  /**
   * Resolve the current Active Tab ID if not provided.
   * @param tabId the tabId to resolve, if undefined, it will query the active tab
   * @returns the resolved tabid or undefined if no active tab is found
   */
  private static async resolveTabId(
    tabId?: number,
  ): Promise<number | undefined> {
    if (tabId !== undefined) {
      return tabId;
    }

    // Fallback for UI contexts (like Popup) where sender.tab is undefined
    const [activeTab] = await chrome.tabs.query({
      active: true,
      currentWindow: true,
    });

    return activeTab?.id;
  }
  /**
   * Checks if the extension is running for a given tab (or current tab if omitted)
   */
  static async isRunning(tabId?: number): Promise<boolean> {
    const targetTabId = await this.resolveTabId(tabId);
    if (targetTabId === undefined) {
      throw new Error("No active tab found to check extension status.");
    }

    const request: ExtensionStatusQuery = {
      action: MessageAction.CheckExtensionStatus,
      tabId: targetTabId,
    };
    const response: ExtensionStatusResponse =
      await chrome.runtime.sendMessage(request);

    if ("error" in response) {
      throw new Error(response.error);
    }

    return Boolean(response?.isRunning);
  }

  /**
   * Toggles the extension status for a given tab (or current tab if omitted)
   */
  static async toggle(tabId?: number): Promise<boolean> {
    const targetTabId = await this.resolveTabId(tabId);
    if (targetTabId === undefined) {
      throw new Error("No active tab found to check extension status.");
    }

    const request: ExtensionStatusQuery = {
      action: MessageAction.ToggleExtensionStatus,
      tabId: targetTabId,
    };
    const response: ExtensionStatusResponse =
      await chrome.runtime.sendMessage(request);

    if ("error" in response) {
      throw new Error(response.error);
    }

    return Boolean(response?.isRunning);
  }

  /** Sets the extension badge state for the active tab. */
  static async setRunning(isRunning: boolean, tabId?: number): Promise<boolean> {
    const targetTabId = await this.resolveTabId(tabId);
    if (targetTabId === undefined) {
      throw new Error("No active tab found to update extension status.");
    }

    const request: ExtensionStatusQuery = {
      action: MessageAction.SetExtensionStatus,
      isRunning,
      tabId: targetTabId,
    };
    const response: ExtensionStatusResponse =
      await chrome.runtime.sendMessage(request);

    if ("error" in response) {
      throw new Error(response.error);
    }

    return Boolean(response.isRunning);
  }

  /**
   * Registers a callback to be invoked whenever the extension status changes for a given tab
   * @param callback the callback to invoke with the new status
   * @param tabId the tabId to listen for
   * @returns a function to remove the listener when no longer needed
   */
  static onStatusUpdate(callback: (isRunning: boolean) => void): () => void {
    const listener = (message: ExtensionStatusQuery) => {
      if (message.action === MessageAction.StatusUpdate) {
        callback(message.isRunning);
      }
    };

    chrome.runtime.onMessage.addListener(listener);

    return () => {
      chrome.runtime.onMessage.removeListener(listener);
    };
  }
}
