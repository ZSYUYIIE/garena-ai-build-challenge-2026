import type { RealtimeStatus } from "../realtime/types";
import { ConfigurationSection } from "./ConfigurationSection";
import { RunningStatusSwitch } from "./RunningStatusSwitch";

type HeaderProps = {
  status: RealtimeStatus;
  isRunning: boolean;
  isBusy: boolean;
  onRunningChange: (isRunning: boolean) => void;
};

export function Header({
  status,
  isRunning,
  isBusy,
  onRunningChange,
}: HeaderProps) {
  const statusColor =
    status === "connected"
      ? "bg-narrating"
      : status === "connecting" || status === "requesting_capture"
        ? "bg-question"
        : "bg-border";

  return (
    <div>
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <span className={`h-2 w-2 shrink-0 rounded-full ${statusColor}`} />
          <h2>Video description</h2>
        </div>
        <RunningStatusSwitch
          isRunning={isRunning}
          isBusy={isBusy}
          onChange={onRunningChange}
        />
      </div>

      <div className="mt-1.5 border-t border-border pt-1.5">
        <ConfigurationSection />
      </div>
    </div>
  );
}
