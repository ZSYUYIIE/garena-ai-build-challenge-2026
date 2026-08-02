import { useConfigurationOptions } from "../context/ConfigurationContext";

type VideoDescriptionSectionProps = {
  description?: string;
};

const NARRATION_LABELS: Record<string, string> = {
  minimal: "Minimal detail",
  standard: "Standard detail",
  detailed: "Detailed",
  question_only: "Question only",
};

export function VideoDescriptionSection({
  description,
}: VideoDescriptionSectionProps) {
  const { options } = useConfigurationOptions();

  return (
    <div className="rounded-lg border border-border bg-card p-4">
      <h3 className="mb-1.5">Now describing</h3>

      {description ? (
        <p className="text-sm leading-relaxed">{description}</p>
      ) : (
        <p className="text-sm leading-relaxed text-muted-foreground">
          Play a video to start getting live descriptions.
        </p>
      )}

      <div className="mt-2.5 flex gap-1.5">
        <span className="rounded-full bg-narrating/15 px-2 py-0.5 text-[11px] font-medium text-narrating-foreground">
          {NARRATION_LABELS[options.narrationLevel]}
        </span>
      </div>
    </div>
  );
}