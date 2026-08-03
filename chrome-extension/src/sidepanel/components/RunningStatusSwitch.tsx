import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";

type RunningStatusSwitchProps = {
  isRunning: boolean;
  isBusy: boolean;
  onChange: (isRunning: boolean) => void;
};

export function RunningStatusSwitch({
  isRunning,
  isBusy,
  onChange,
}: RunningStatusSwitchProps) {
  return (
    <div className="flex items-center space-x-2">
      <Switch
        id="is-extension-running"
        aria-label="Turn StreamSense on or off"
        isSelected={isRunning}
        isDisabled={isBusy}
        onChange={onChange}
      />
      <Label htmlFor="is-extension-running">
        {isBusy
          ? "Starting..."
          : isRunning
            ? "StreamSense running"
            : "StreamSense stopped"}
      </Label>
    </div>
  );
}
