import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { ExtensionStatusService } from "@/services/extensionStatus";
import { useEffect, useState } from "react";

export function RunningStatusSwitch() {
  const [isRunning, setIsRunning] = useState(false);

  useEffect(() => {
    ExtensionStatusService.isRunning().then(setIsRunning);

    const unsubscribe = ExtensionStatusService.onStatusUpdate((isRunning) => {
      setIsRunning(isRunning);
    });

    return () => {
      unsubscribe();
    };
  }, []);

  return (
    <div className="flex items-center space-x-2">
      <Switch
        id="is-extension-running"
        isSelected={isRunning}
        onChange={(isSelected) => {
          ExtensionStatusService.toggle();
          setIsRunning(isSelected);
        }}
      />
      <Label htmlFor="is-extension-running">
        {isRunning ? "Extension running" : "Extension stopped"}
      </Label>
    </div>
  );
}
