export const MICROPHONE_PERMISSION_QUERY = "microphonePermission";
export const MICROPHONE_PERMISSION_GRANTED = "streamsense.microphonePermissionGranted";

export type MicrophonePermissionGrantedMessage = {
  type: typeof MICROPHONE_PERMISSION_GRANTED;
};

export function isMicrophonePermissionPage(search: string): boolean {
  return new URLSearchParams(search).get(MICROPHONE_PERMISSION_QUERY) === "1";
}

export function isMicrophonePermissionGrantedMessage(
  value: unknown,
): value is MicrophonePermissionGrantedMessage {
  return Boolean(
    value
    && typeof value === "object"
    && (value as { type?: unknown }).type === MICROPHONE_PERMISSION_GRANTED,
  );
}

export function microphonePermissionPageUrl(): string {
  const page = chrome.runtime.getURL("src/sidepanel/index.html");
  return `${page}?${MICROPHONE_PERMISSION_QUERY}=1`;
}
