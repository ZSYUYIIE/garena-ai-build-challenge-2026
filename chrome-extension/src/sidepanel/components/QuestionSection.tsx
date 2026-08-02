import { useState } from "react";
import { Input } from "@/components/ui/input";

export type ChatMessage = {
  id: string;
  role: "user" | "assistant";
  text: string;
};

type QuestionSectionProps = {
  messages: ChatMessage[];
  onAsk: (question: string) => void;
};

export function QuestionSection({ messages, onAsk }: QuestionSectionProps) {
  const [draft, setDraft] = useState("");

  function handleSubmit() {
    const question = draft.trim();
    if (!question) return;
    onAsk(question);
    setDraft("");
  }

  return (
    <div className="flex flex-col flex-1 gap-2">
      <h3>Ask about this video</h3>

      <ChatHistory messages={messages} />

      <div className="flex items-center gap-2">
        <Input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") handleSubmit();
          }}
          placeholder="Ask a question…"
        />
        <button
          onClick={handleSubmit}
          aria-label="Send question"
          className="shrink-0 text-question disabled:opacity-40"
          disabled={!draft.trim()}
        >
          <ArrowIcon />
        </button>
      </div>
    </div>
  );
}

function ChatHistory({ messages }: { messages: ChatMessage[] }) {
  if (messages.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        Ask something about what's on screen.
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-2 overflow-y-auto max-h-48">
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
  return <p className="text-sm text-muted-foreground max-w-10/12">{text}</p>;
}

function ChatResponse({ text }: { text: string }) {
  return (
    <p className="self-end max-w-10/12 rounded-lg border border-border bg-card px-2.5 py-2 text-sm">
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
    >
      <path d="M5 12h14M12 5l7 7-7 7" />
    </svg>
  );
}