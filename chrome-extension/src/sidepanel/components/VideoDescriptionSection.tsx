import { useId, useState } from "react";

type VideoDescriptionSectionProps = {
  description: string;
  statusText: string;
  error: string | null;
  isRunning: boolean;
  isSpeaking: boolean;
};

export function VideoDescriptionSection({
  description,
  statusText,
  error,
  isRunning,
  isSpeaking,
}: VideoDescriptionSectionProps) {
  const [expanded, setExpanded] = useState(false);
  const panelId = useId();
  const label = isSpeaking
    ? "Now describing"
    : isRunning
      ? "Latest description"
      : "Video description";
  return (
    <section className="overflow-hidden rounded-lg border border-[var(--border)]">
      <button
        type="button"
        aria-expanded={expanded}
        aria-controls={panelId}
        onClick={() => setExpanded((current) => !current)}
        className="flex min-h-12 w-full items-center gap-3 px-3 py-2 text-left focus-visible:outline-2 focus-visible:outline-offset-[-2px]"
      >
        <span className="min-w-0 flex-1">
          <span className="block text-[11px] uppercase tracking-wide text-muted-foreground">
            {label}
          </span>
          <span className="block truncate text-sm">{description}</span>
        </span>
        <ChevronIcon expanded={expanded} />
      </button>
      {expanded ? (
        <div id={panelId} className="max-h-28 overflow-y-auto border-t border-border px-3 pb-3 pt-2">
          <p className="text-sm leading-relaxed">{description}</p>
          <p
            className={`mt-1.5 text-xs ${error ? "text-destructive" : "text-muted-foreground"}`}
            role={error ? "alert" : "status"}
          >
            {error ?? statusText}
          </p>
        </div>
      ) : (
        <span className="sr-only" role={error ? "alert" : "status"}>
          {error ?? statusText}
        </span>
      )}
    </section>
  );
}

function ChevronIcon({ expanded }: { expanded: boolean }) {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 24 24"
      className={`h-4 w-4 shrink-0 text-muted-foreground transition-transform motion-reduce:transition-none ${expanded ? "rotate-180" : ""}`}
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="m6 9 6 6 6-6" />
    </svg>
  );
}
