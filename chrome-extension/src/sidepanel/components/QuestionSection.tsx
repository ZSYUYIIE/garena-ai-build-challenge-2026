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
import type { ResearchMode, ResearchProgress, ResearchStage, VoiceStatus } from "../realtime/types";
import type { MicrophoneState } from "../realtime/mediaAudio";
import { parseResearchAnswer } from "../realtime/researchAnswer";

export type ChatMessage = {
  id: string;
  role: "user" | "assistant";
  text: string;
};

type QuestionSectionProps = {
  messages: ChatMessage[];
  onAsk: (question: string) => boolean;
  onPlayResearchVoice: (sourceTurnId: string) => boolean;
  onEnableVoice: () => boolean;
  onStartVoice: () => boolean;
  onStopVoice: () => boolean;
  canEnableVoice: boolean;
  canStartVoice: boolean;
  questionAvailability: QuestionAvailability;
  canPlayResearchVoice: boolean;
  voiceStatus?: VoiceStatus;
  microphoneState?: MicrophoneState;
  tabContextStatus?: "absent" | "connecting" | "ready" | "degraded";
  researchMode: ResearchMode;
  researchProgress: ResearchProgress[];
  onResearchModeChange: (mode: ResearchMode) => void;
};

export function QuestionSection({
  messages,
  onAsk,
  onPlayResearchVoice,
  onEnableVoice,
  onStartVoice,
  onStopVoice,
  canEnableVoice,
  canStartVoice,
  questionAvailability,
  canPlayResearchVoice,
  voiceStatus = "off",
  microphoneState = "pending",
  tabContextStatus = "absent",
  researchMode,
  researchProgress,
  onResearchModeChange,
}: QuestionSectionProps) {
  const [draft, setDraft] = useState("");
  const questionCopy = questionCopyFor(questionAvailability);
  const disabled = questionAvailability !== "ready";
  const voiceRetryEnabled = questionAvailability === "ready" && canEnableVoice;
  const voiceKeyHeldRef = useRef(false);
  const researchRunning = researchProgress.some((item) => item.status === "active");

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

      <div role="tablist" aria-label="Answer mode" className="grid grid-cols-2 rounded-lg bg-muted p-1 text-xs">
        <ModeTab selected={researchMode === "normal"} disabled={researchRunning} onClick={() => onResearchModeChange("normal")}>Normal</ModeTab>
        <ModeTab selected={researchMode === "deep_research"} disabled={researchRunning} onClick={() => onResearchModeChange("deep_research")}>Deep Research</ModeTab>
      </div>

      <VoiceStatusLine
        voiceStatus={voiceStatus}
        microphoneState={microphoneState}
        questionAvailability={questionAvailability}
        tabContextStatus={tabContextStatus}
      />

      <ChatHistory
        messages={messages}
        researchProgress={researchProgress}
        canPlayResearchVoice={canPlayResearchVoice}
        onPlayResearchVoice={onPlayResearchVoice}
      />

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
    <div aria-live="polite" className="min-h-5 text-xs text-muted-foreground">
      {voiceText ? <p>{voiceText}</p> : null}
      {tabText ? <p>{tabText}</p> : null}
    </div>
  );
}

function ModeTab({ selected, disabled, onClick, children }: {
  selected: boolean;
  disabled: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={selected}
      disabled={disabled}
      onClick={onClick}
      className={`rounded-md px-2 py-1.5 disabled:opacity-50 ${selected ? "bg-card text-foreground shadow-sm" : "text-muted-foreground"}`}
    >
      {children}
    </button>
  );
}

function ChatHistory({
  messages,
  researchProgress,
  canPlayResearchVoice,
  onPlayResearchVoice,
}: {
  messages: ChatMessage[];
  researchProgress: ResearchProgress[];
  canPlayResearchVoice: boolean;
  onPlayResearchVoice: (sourceTurnId: string) => boolean;
}) {
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const element = scrollRef.current;
    if (element) element.scrollTop = element.scrollHeight;
  }, [messages, researchProgress]);

  if (messages.length === 0 && researchProgress.length === 0) {
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
          <ChatResponse
            key={message.id}
            text={message.text}
            canPlayResearchVoice={canPlayResearchVoice}
            onPlayResearchVoice={() => onPlayResearchVoice(message.id.split(":", 1)[0])}
          />
        ),
      )}
      <ResearchPipeline progress={researchProgress} />
    </div>
  );
}

const RESEARCH_STAGES: { stage: ResearchStage; label: string }[] = [
  { stage: "understand", label: "Understanding the question" },
  { stage: "search", label: "Searching the web" },
  { stage: "review", label: "Reviewing sources" },
  { stage: "synthesize", label: "Composing the answer" },
];

function ResearchPipeline({ progress }: { progress: ResearchProgress[] }) {
  if (progress.length === 0 || progress.every((item) => item.status === "completed")) return null;
  const byStage = new Map(progress.map((item) => [item.stage, item]));
  return (
    <section aria-live="polite" aria-label="Deep Research progress" className="rounded-lg border border-question/25 bg-question/5 p-3 text-xs">
      <div className="mb-3 flex items-center gap-2">
        <span className="relative flex size-2" aria-hidden="true">
          <span className="absolute inline-flex size-full animate-ping rounded-full bg-question opacity-60 motion-reduce:animate-none" />
          <span className="relative inline-flex size-2 rounded-full bg-question" />
        </span>
        <p className="font-medium text-foreground">Deep Research plan</p>
      </div>
      <ol className="space-y-0">
        {RESEARCH_STAGES.map(({ stage, label }) => {
          const item = byStage.get(stage);
          const status = item?.status ?? "pending";
          return (
            <li
              key={stage}
              aria-current={status === "active" ? "step" : undefined}
              className={`relative flex gap-2.5 pb-3 last:pb-0 ${item ? "text-foreground" : "text-muted-foreground"}`}
            >
              <span className="relative z-10 mt-0.5 flex size-4 shrink-0 items-center justify-center bg-card" aria-hidden="true">
                <ResearchStageMarker status={status} />
              </span>
              {stage !== "synthesize" ? <span aria-hidden="true" className="absolute left-[7px] top-4 h-[calc(100%-0.5rem)] w-px bg-border" /> : null}
              <div className="min-w-0">
                <p className={status === "active" ? "font-medium" : undefined}>{label}</p>
                {item?.detail ? <p className="mt-0.5 text-muted-foreground">{item.detail}</p> : null}
                <span className="sr-only">{status}</span>
              </div>
            </li>
          );
        })}
      </ol>
    </section>
  );
}

function ResearchStageMarker({ status }: { status: ResearchProgress["status"] | "pending" }) {
  if (status === "active") {
    return (
      <svg viewBox="0 0 16 16" className="size-4 animate-spin text-question motion-reduce:animate-none" fill="none">
        <circle cx="8" cy="8" r="6" stroke="currentColor" strokeWidth="2" opacity="0.2" />
        <path d="M8 2a6 6 0 0 1 6 6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
      </svg>
    );
  }
  if (status === "completed") {
    return (
      <svg viewBox="0 0 16 16" className="size-4 text-question" fill="none">
        <circle cx="8" cy="8" r="7" fill="currentColor" />
        <path d="m4.5 8 2.2 2.2 4.8-4.8" stroke="white" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    );
  }
  if (status === "failed") {
    return <span className="flex size-4 items-center justify-center rounded-full bg-destructive text-[10px] font-bold text-white">!</span>;
  }
  return <span className="size-3 rounded-full border border-muted-foreground/40 bg-card" />;
}

function ChatRequest({ text }: { text: string }) {
  return <p className="max-w-10/12 text-sm text-muted-foreground">{text}</p>;
}

function ChatResponse({
  text,
  canPlayResearchVoice,
  onPlayResearchVoice,
}: {
  text: string;
  canPlayResearchVoice: boolean;
  onPlayResearchVoice: () => void;
}) {
  const answer = parseResearchAnswer(text);
  return (
    <article className="max-w-10/12 self-end rounded-lg border border-border bg-card px-3 py-2.5 text-sm">
      <div className="space-y-2 leading-relaxed">
        {answer.paragraphs.map((paragraph, index) => <p key={`${index}-${paragraph}`}>{paragraph}</p>)}
      </div>
      {answer.sources.length > 0 ? (
        <>
        <section aria-label="Research sources" className="mt-3 border-t border-border pt-2.5">
          <h4 className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Sources</h4>
          <ol className="space-y-1.5 pl-5 text-xs text-muted-foreground">
            {answer.sources.map((source) => (
              <li key={`${source.index}-${source.url}`} className="list-decimal pl-0.5">
                <a
                  href={source.url}
                  target="_blank"
                  rel="noreferrer"
                  className="break-words underline decoration-border underline-offset-2 hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2"
                >
                  {source.title}
                </a>
              </li>
            ))}
          </ol>
        </section>
        <button
          type="button"
          disabled={!canPlayResearchVoice}
          onClick={onPlayResearchVoice}
          className="mt-3 inline-flex items-center gap-1.5 rounded-md border border-border bg-background px-2.5 py-1.5 text-xs font-medium hover:bg-muted focus-visible:outline-2 focus-visible:outline-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
        >
          <SpeakerIcon />
          Debug: Play with Gemini Live
        </button>
        </>
      ) : null}
    </article>
  );
}

function SpeakerIcon() {
  return (
    <svg viewBox="0 0 20 20" className="size-3.5" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden="true">
      <path d="M3 8h3l4-3v10l-4-3H3z" strokeLinejoin="round" />
      <path d="M13 7a4 4 0 0 1 0 6M15 5a7 7 0 0 1 0 10" strokeLinecap="round" />
    </svg>
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
