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

type SessionStorageArea = {
  get(key: string): Promise<Record<string, unknown>>;
  set(items: Record<string, unknown>): Promise<void>;
};

const pendingWritesByStorage = new WeakMap<SessionStorageArea, Promise<void>>();

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

export function captureGuidance(
  target: CaptureTargetState | null,
  activeTabId: number | null,
): string {
  if (!target || (target.status === "unavailable" && target.reason === "missing_tab")) {
    return "Click the StreamSense toolbar icon on the tab you want to capture.";
  }
  if (target.status === "unavailable") {
    return "Chrome internal and Web Store pages cannot be captured.";
  }
  if (target.tabId !== activeTabId) {
    return "This tab is not authorized. Click the StreamSense icon here first.";
  }
  return "Ready to describe this tab.";
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

export async function loadCaptureTarget(
  windowId: number,
  storage?: SessionStorageArea,
): Promise<CaptureTargetState | null> {
  const area = storage ?? chrome.storage.session;
  const stored = await area.get(CAPTURE_TARGETS_STORAGE_KEY);
  return targetForWindow(
    captureTargetsFromValue(stored[CAPTURE_TARGETS_STORAGE_KEY]),
    windowId,
  );
}

export function saveCaptureTarget(
  target: CaptureTargetState,
  storage?: SessionStorageArea,
): Promise<void> {
  const area = storage ?? chrome.storage.session;
  const previousWrite = pendingWritesByStorage.get(area) ?? Promise.resolve();
  const nextWrite = previousWrite.catch(() => undefined).then(async () => {
    const stored = await area.get(CAPTURE_TARGETS_STORAGE_KEY);
    const current = captureTargetsFromValue(
      stored[CAPTURE_TARGETS_STORAGE_KEY],
    );
    await area.set({
      [CAPTURE_TARGETS_STORAGE_KEY]: replaceTargetForWindow(current, target),
    });
  });
  pendingWritesByStorage.set(area, nextWrite);
  return nextWrite;
}

export function captureTargetsFromValue(value: unknown): CaptureTargetsByWindow {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return value as CaptureTargetsByWindow;
}

export async function authorizeCaptureTarget(
  tab: CaptureTab,
  dependencies: {
    persistTarget: (target: CaptureTargetState) => Promise<void>;
    openPanel: (tabId: number) => Promise<void>;
  },
  now = Date.now(),
): Promise<void> {
  const target = createCaptureTargetState(tab, now);
  const persistTarget = dependencies.persistTarget(target);
  const openPanel =
    tab.id === undefined
      ? Promise.resolve()
      : dependencies.openPanel(tab.id);
  await Promise.all([persistTarget, openPanel]);
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
