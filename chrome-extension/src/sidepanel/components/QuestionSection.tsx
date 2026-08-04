import { useEffect, useRef, useState } from "react";

import { Input } from "@/components/ui/input";

export type ChatMessage = {
  id: string;
  role: "user" | "assistant";
  text: string;
};

type QuestionSectionProps = {
  messages: ChatMessage[];
  onAsk: (question: string) => void;
  disabled?: boolean;
  voiceStatus?: "off" | "listening" | "user_speaking" | "gemini_speaking" | "degraded";
  tabContextStatus?: "absent" | "connecting" | "ready" | "degraded";
};

export function QuestionSection({
  messages,
  onAsk,
  disabled = false,
  voiceStatus = "off",
  tabContextStatus = "absent",
}: QuestionSectionProps) {
  const [draft, setDraft] = useState("");

  function handleSubmit() {
    const question = draft.trim();
    if (!question || disabled) return;
    onAsk(question);
    setDraft("");
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-2">
      <h3>Ask about this video</h3>

      <VoiceStatusLine
        voiceStatus={voiceStatus}
        tabContextStatus={tabContextStatus}
      />

      <div className="flex items-center gap-2">
        <Input
          aria-label="Ask about this video"
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") handleSubmit();
          }}
          placeholder={
            disabled ? "Start StreamSense to ask a question" : "Ask a question..."
          }
          disabled={disabled}
        />
        <button
          onClick={handleSubmit}
          aria-label="Send question"
          className="shrink-0 text-question disabled:opacity-40"
          disabled={disabled || !draft.trim()}
        >
          <ArrowIcon />
        </button>
      </div>

      <ChatHistory messages={messages} />
    </div>
  );
}

function VoiceStatusLine({
  voiceStatus,
  tabContextStatus,
}: Pick<QuestionSectionProps, "voiceStatus" | "tabContextStatus">) {
  const voiceText = {
    off: null,
    listening: "Mic open — ask a question",
    user_speaking: "Listening to you…",
    gemini_speaking: "Gemini is replying…",
    degraded: "Voice unavailable — typed questions still work",
  }[voiceStatus ?? "off"];
  const tabText = tabContextStatus === "connecting" || tabContextStatus === "degraded"
    ? "Tab speech context unavailable — automatic narration paused"
    : null;
  if (!voiceText && !tabText) return null;
  return (
    <div aria-live="polite" className="text-xs text-muted-foreground">
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
      <p className="text-sm text-muted-foreground">
        Ask something about what&apos;s on screen.
      </p>
    );
  }

  return (
    <div ref={scrollRef} className="flex flex-col gap-2 overflow-y-auto">
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
