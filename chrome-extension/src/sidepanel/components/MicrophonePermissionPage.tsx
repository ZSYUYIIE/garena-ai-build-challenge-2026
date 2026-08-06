import { useState } from "react";

import { MICROPHONE_PERMISSION_GRANTED } from "../../services/microphonePermission";

type PermissionState = "idle" | "requesting" | "granted" | "denied" | "unavailable";

export function MicrophonePermissionPage() {
  const [state, setState] = useState<PermissionState>("idle");

  async function requestMicrophone() {
    setState("requesting");
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
          channelCount: 1,
        },
      });
      for (const track of stream.getTracks()) track.stop();
      setState("granted");
      await chrome.runtime.sendMessage({ type: MICROPHONE_PERMISSION_GRANTED });
    } catch (cause) {
      const errorName = cause instanceof DOMException ? cause.name : "";
      setState(errorName === "NotFoundError" ? "unavailable" : "denied");
    }
  }

  return (
    <main className="mx-auto flex min-h-screen max-w-lg flex-col justify-center gap-5 p-8 text-center">
      <div className="mx-auto rounded-full bg-question/15 p-4 text-question">
        <MicrophoneIcon />
      </div>
      <div className="space-y-2">
        <h1 className="text-2xl">Enable StreamSense voice questions</h1>
        <p className="text-sm text-muted-foreground">
          Chrome requires microphone permission on a full extension page before the side panel can record your voice.
        </p>
      </div>
      <button
        type="button"
        onClick={() => { void requestMicrophone(); }}
        disabled={state === "requesting" || state === "granted"}
        className="rounded-lg bg-primary px-4 py-3 text-primary-foreground disabled:opacity-50"
      >
        {state === "requesting"
          ? "Waiting for Chrome…"
          : state === "granted"
            ? "Microphone enabled"
            : "Allow microphone"}
      </button>
      {state === "granted" ? (
        <p className="text-sm text-question">
          Permission granted. Return to the StreamSense side panel and hold S to speak.
        </p>
      ) : null}
      {state === "denied" ? (
        <p className="text-sm text-destructive">
          Chrome still blocked access. Enable Chrome in macOS Privacy &amp; Security → Microphone, then try again.
        </p>
      ) : null}
      {state === "unavailable" ? (
        <p className="text-sm text-destructive">
          No microphone was found. Select a working input device in Chrome microphone settings.
        </p>
      ) : null}
    </main>
  );
}

function MicrophoneIcon() {
  return (
    <svg
      width="32"
      height="32"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <rect x="9" y="2" width="6" height="11" rx="3" />
      <path d="M5 10a7 7 0 0 0 14 0M12 17v5M8 22h8" />
    </svg>
  );
}
