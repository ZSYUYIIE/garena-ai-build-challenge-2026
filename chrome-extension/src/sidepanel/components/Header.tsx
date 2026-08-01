import { ConfigurationSection } from "./ConfigurationSection";
import { RunningStatusSwitch } from "./RunningStatusSwitch";

export function Header() {
  return (
    <div className="flex">
      <h2>Video Description Extension</h2>
      <RunningStatusSwitch />
    </div>
  );
}
