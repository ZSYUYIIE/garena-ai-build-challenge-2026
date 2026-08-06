export type CaptureStatus = "pending" | "active" | "stopped" | "error";

type CaptureBadgeInfo = {
  tabId?: number;
  status: CaptureStatus;
};

type SetBadgeText = (details: {
  tabId: number;
  text: "ON" | "OFF";
}) => Promise<unknown> | unknown;

export function badgeTextForCaptureStatus(
  status: CaptureStatus,
): "ON" | "OFF" {
  return status === "active" ? "ON" : "OFF";
}

export async function syncCaptureBadge(
  info: CaptureBadgeInfo,
  setBadgeText: SetBadgeText,
): Promise<void> {
  if (!Number.isInteger(info.tabId)) return;

  await setBadgeText({
    tabId: info.tabId!,
    text: badgeTextForCaptureStatus(info.status),
  });
}
