export const CAPTURE_TARGETS_STORAGE_KEY = "streamsense.captureTargets";

export type ReadyCaptureTarget = {
  status: "ready";
  tabId: number;
  windowId: number;
  origin: string;
  authorizedAt: number;
};

export type UnavailableCaptureTarget = {
  status: "unavailable";
  windowId: number;
  reason: "restricted_page" | "missing_tab";
};

export type CaptureTargetState = ReadyCaptureTarget | UnavailableCaptureTarget;
export type CaptureTargetsByWindow = Record<string, CaptureTargetState>;

export type CaptureTab = {
  id?: number;
  windowId: number;
  url?: string;
};

export function createCaptureTargetState(
  tab: CaptureTab,
  now = Date.now(),
): CaptureTargetState {
  if (tab.id === undefined) {
    return {
      status: "unavailable",
      windowId: tab.windowId,
      reason: "missing_tab",
    };
  }

  let url: URL;
  try {
    url = new URL(tab.url ?? "");
  } catch {
    return {
      status: "unavailable",
      windowId: tab.windowId,
      reason: "restricted_page",
    };
  }

  const allowedProtocol = url.protocol === "http:" || url.protocol === "https:";
  if (!allowedProtocol || url.hostname === "chromewebstore.google.com") {
    return {
      status: "unavailable",
      windowId: tab.windowId,
      reason: "restricted_page",
    };
  }

  return {
    status: "ready",
    tabId: tab.id,
    windowId: tab.windowId,
    origin: url.origin,
    authorizedAt: now,
  };
}

export function targetForWindow(
  states: CaptureTargetsByWindow,
  windowId: number,
): CaptureTargetState | null {
  return states[String(windowId)] ?? null;
}

export function replaceTargetForWindow(
  states: CaptureTargetsByWindow,
  target: CaptureTargetState,
): CaptureTargetsByWindow {
  return {
    ...states,
    [String(target.windowId)]: target,
  };
}

export function isTargetReadyForActiveTab(
  target: CaptureTargetState | null,
  activeTabId: number | null,
): target is ReadyCaptureTarget {
  return target?.status === "ready" && target.tabId === activeTabId;
}

export function targetChangeRequiresReset(
  capturedTabId: number | null,
  target: CaptureTargetState | null,
): boolean {
  if (capturedTabId === null) return false;
  return target?.status !== "ready" || target.tabId !== capturedTabId;
}

export function captureErrorMessage(cause: unknown): string {
  const message = cause instanceof Error ? cause.message : String(cause);

  if (/activeTab|not been invoked|permission/i.test(message)) {
    return "Page access changed. Click the StreamSense icon again.";
  }
  if (/Chrome pages cannot be captured|not allowed to capture/i.test(message)) {
    return "Chrome internal and Web Store pages cannot be captured.";
  }
  return "StreamSense could not capture this tab. Click the toolbar icon and try again.";
}

export async function beginAuthorizedCapture<T>(
  target: ReadyCaptureTarget,
  dependencies: {
    requestStreamId: (options: { targetTabId: number }) => Promise<string>;
    ensureAudioReady: () => Promise<unknown>;
    consumeStreamId: (streamId: string) => Promise<T>;
  },
): Promise<T> {
  const streamIdPromise = dependencies.requestStreamId({
    targetTabId: target.tabId,
  });
  await dependencies.ensureAudioReady();
  const streamId = await streamIdPromise;
  return dependencies.consumeStreamId(streamId);
}
