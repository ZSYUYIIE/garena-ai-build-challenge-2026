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
  const label = isSpeaking
    ? "Now describing"
    : isRunning
      ? "Latest description"
      : "Video description";
  return (
    <div className="rounded-lg border border-[var(--border)] p-4">
      <p className="mb-1.5 text-[11px] uppercase tracking-wide text-muted-foreground">
        {label}
      </p>
      <p className="text-sm leading-relaxed">{description}</p>
      <p
        className={`mt-2 text-xs ${
          error ? "text-destructive" : "text-muted-foreground"
        }`}
        role={error ? "alert" : "status"}
      >
        {error ?? statusText}
      </p>
    </div>
  );
}
