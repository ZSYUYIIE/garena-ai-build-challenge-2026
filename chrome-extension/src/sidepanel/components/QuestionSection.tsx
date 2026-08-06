import { useEffect, useRef, useState } from "react";

import { Input } from "@/components/ui/input";
import {
  draftAfterAdmission,
  isEditableShortcutTarget,
  isVoiceHoldShortcut,
  questionCopyFor,
  voiceQuestionStatusFor,
  type QuestionAvailability,
} from "../realtime/typedQuestion";
import type { VoiceStatus } from "../realtime/types";
import type { MicrophoneState } from "../realtime/mediaAudio";

export type ChatMessage = {
  id: string;
  role: "user" | "assistant";
  text: string;
};

type QuestionSectionProps = {
  messages: ChatMessage[];
  onAsk: (question: string) => boolean;
  onEnableVoice: () => boolean;
  onStartVoice: () => boolean;
  onStopVoice: () => boolean;
  canEnableVoice: boolean;
  canStartVoice: boolean;
  questionAvailability: QuestionAvailability;
  voiceStatus?: VoiceStatus;
  microphoneState?: MicrophoneState;
  tabContextStatus?: "absent" | "connecting" | "ready" | "degraded";
};

export function QuestionSection({
  messages,
  onAsk,
  onEnableVoice,
  onStartVoice,
  onStopVoice,
  canEnableVoice,
  canStartVoice,
  questionAvailability,
  voiceStatus = "off",
  microphoneState = "pending",
  tabContextStatus = "absent",
}: QuestionSectionProps) {
  const [draft, setDraft] = useState("");
  const questionCopy = questionCopyFor(questionAvailability);
  const disabled = questionAvailability !== "ready";
  const voiceRetryEnabled = questionAvailability === "ready" && canEnableVoice;
  const voiceKeyHeldRef = useRef(false);

  useEffect(() => {
    const stopHeldVoice = () => {
      if (!voiceKeyHeldRef.current) return;
      voiceKeyHeldRef.current = false;
      onStopVoice();
    };
    const handleVoiceKeyDown = (event: KeyboardEvent) => {
      if (
        event.repeat
        || voiceKeyHeldRef.current
        || !canStartVoice
        || isEditableShortcutTarget(event.target)
        || !isVoiceHoldShortcut(event)
      ) {
        return;
      }
      event.preventDefault();
      voiceKeyHeldRef.current = onStartVoice();
    };
    const handleVoiceKeyUp = (event: KeyboardEvent) => {
      if (!isVoiceHoldShortcut(event)) return;
      event.preventDefault();
      stopHeldVoice();
    };
    window.addEventListener("keydown", handleVoiceKeyDown);
    window.addEventListener("keyup", handleVoiceKeyUp);
    window.addEventListener("blur", stopHeldVoice);
    return () => {
      stopHeldVoice();
      window.removeEventListener("keydown", handleVoiceKeyDown);
      window.removeEventListener("keyup", handleVoiceKeyUp);
      window.removeEventListener("blur", stopHeldVoice);
    };
  }, [canStartVoice, onStartVoice, onStopVoice]);

  function handleVoicePointerDown(event: React.PointerEvent<HTMLButtonElement>) {
    if (voiceRetryEnabled) {
      onEnableVoice();
      return;
    }
    if (!canStartVoice || !onStartVoice()) return;
    voiceKeyHeldRef.current = true;
    event.currentTarget.setPointerCapture(event.pointerId);
    event.preventDefault();
  }

  function handleVoicePointerUp(event: React.PointerEvent<HTMLButtonElement>) {
    if (!voiceKeyHeldRef.current) return;
    voiceKeyHeldRef.current = false;
    onStopVoice();
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    event.preventDefault();
  }

  function handleSubmit() {
    const question = draft.trim();
    if (!question || questionAvailability !== "ready") return;
    const accepted = onAsk(question);
    setDraft((current) => draftAfterAdmission(current, accepted));
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-2 overflow-hidden">
      <h3>Ask about this video</h3>

      <VoiceStatusLine
        voiceStatus={voiceStatus}
        microphoneState={microphoneState}
        questionAvailability={questionAvailability}
        tabContextStatus={tabContextStatus}
      />

      <ChatHistory messages={messages} />

      <div className="flex shrink-0 items-center gap-2">
        <Input
          aria-label="Ask about this video"
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") handleSubmit();
          }}
          placeholder={questionCopy.placeholder}
          disabled={disabled}
        />
        <button
          type="button"
          onPointerDown={handleVoicePointerDown}
          onPointerUp={handleVoicePointerUp}
          onPointerCancel={handleVoicePointerUp}
          aria-label={voiceRetryEnabled ? "Enable voice questions" : "Hold to ask by voice"}
          title={voiceRetryEnabled ? "Enable voice questions" : "Hold to ask by voice (S)"}
          className={`shrink-0 rounded-md p-1.5 disabled:opacity-40 ${
            voiceStatus === "listening" || voiceStatus === "user_speaking"
              ? "bg-question/15 text-question"
              : "text-muted-foreground"
          }`}
          disabled={!voiceRetryEnabled && !canStartVoice}
        >
          <MicrophoneIcon />
        </button>
        <button
          onClick={handleSubmit}
          aria-label="Send question"
          className="shrink-0 text-question disabled:opacity-40"
          disabled={disabled || !draft.trim()}
        >
          <ArrowIcon />
        </button>
      </div>

    </div>
  );
}

function VoiceStatusLine({
  voiceStatus,
  microphoneState,
  questionAvailability,
  tabContextStatus,
}: Pick<QuestionSectionProps, "voiceStatus" | "microphoneState" | "questionAvailability" | "tabContextStatus">) {
  const voiceText = voiceQuestionStatusFor(
    voiceStatus ?? "off",
    questionAvailability,
    microphoneState,
  );
  const tabText = tabContextStatus === "connecting" || tabContextStatus === "degraded"
    ? "Tab speech context unavailable — automatic narration paused"
    : null;
  return (
    <div aria-live="polite" className="min-h-14 text-xs text-muted-foreground">
      {voiceText ? <p>{voiceText}</p> : null}
      {tabText ? <p>{tabText}</p> : null}
    </div>
  );
}

function ChatHistory({ messages }: { messages: ChatMessage[] }) {
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const element = scrollRef.current;
    if (element) element.scrollTop = element.scrollHeight;
  }, [messages]);

  if (messages.length === 0) {
    return (
      <p className="min-h-0 flex-1 overflow-y-auto text-sm text-muted-foreground">
        Ask something about what&apos;s on screen.
      </p>
    );
  }

  return (
    <div ref={scrollRef} className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto">
      {messages.map((message) =>
        message.role === "user" ? (
          <ChatRequest key={message.id} text={message.text} />
        ) : (
          <ChatResponse key={message.id} text={message.text} />
        ),
      )}
    </div>
  );
}

function ChatRequest({ text }: { text: string }) {
  return <p className="max-w-10/12 text-sm text-muted-foreground">{text}</p>;
}

function ChatResponse({ text }: { text: string }) {
  return (
    <p className="max-w-10/12 self-end rounded-lg border border-border bg-card px-2.5 py-2 text-sm">
      {text}
    </p>
  );
}

function ArrowIcon() {
  return (
    <svg
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M5 12h14M12 5l7 7-7 7" />
    </svg>
  );
}

function MicrophoneIcon() {
  return (
    <svg
      width="18"
      height="18"
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
