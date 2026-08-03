export enum MessageAction {
  CheckExtensionStatus = "CHECK_EXTENSION_STATUS",
  ToggleExtensionStatus = "TOGGLE_EXTENSION_STATUS",
  SetExtensionStatus = "SET_EXTENSION_STATUS",
  StatusUpdate = "STATUS_UPDATE",
}

export type ExtensionStatusQuery =
  | {
      action: MessageAction.CheckExtensionStatus;
      tabId: number;
    }
  | {
      action: MessageAction.ToggleExtensionStatus;
      tabId: number;
    }
  | {
      action: MessageAction.SetExtensionStatus;
      isRunning: boolean;
      tabId: number;
    }
  | {
      action: MessageAction.StatusUpdate;
      isRunning: boolean;
      tabId: number;
    };

export type ExtensionStatusResponse =
  | {
      tabId: number;
      isRunning: boolean;
    }
  | { error: string };
