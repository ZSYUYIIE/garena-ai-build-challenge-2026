import { ConfigurationSection } from "./ConfigurationSection";
import { RunningStatusSwitch } from "./RunningStatusSwitch";

export function Header() {
  return (
    <div>
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="h-2 w-2 rounded-full bg-narrating" />
          <h2>Video description</h2>
        </div>
        <RunningStatusSwitch />
      </div>

      <div className="mt-1.5 border-t border-border pt-1.5">
        <ConfigurationSection />
      </div>
    </div>
  );
}