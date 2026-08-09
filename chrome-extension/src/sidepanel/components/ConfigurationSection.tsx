import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  useConfigurationOptions,
  NarrationMode,
} from "../context/ConfigurationContext";

export function ConfigurationSection() {
  const { options, setOptions } = useConfigurationOptions();
  const narrationModes = Object.values(NarrationMode);

  return (
    <div className="flex items-center justify-between gap-2">
      <label
        htmlFor="narration-level"
        className="text-sm text-muted-foreground"
      >
        Narration level
      </label>
      <Select
        aria-label="Narration level"
        value={options.narrationLevel}
        onChange={(val) => {
          setOptions({ ...options, narrationLevel: val as NarrationMode });
        }}
      >
        <SelectTrigger
          id="narration-level"
          aria-label="Narration level"
          size="sm"
        >
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {narrationModes.map((mode) => (
            <SelectItem
              id={mode}
              key={mode}
              value={mode}
              onClick={() => setOptions({ ...options, narrationLevel: mode })}
              className="text-sm"
            >
              {mode}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}
