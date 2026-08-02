import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
} from "@/components/ui/select";
import {
  useConfigurationOptions,
  NarrationMode,
} from "../context/ConfigurationContext";

export function ConfigurationSection() {
  const { options, setOptions } = useConfigurationOptions();
  const narrationModes = Object.values(NarrationMode);

  return (
    <div>
      <p>Current narration level: </p>
      <Select>
        <SelectTrigger>{options.narrationLevel}</SelectTrigger>
        <SelectContent>
          {narrationModes.map((mode) => (
            <SelectItem
              key={mode}
              value={mode}
              onClick={() => setOptions({ ...options, narrationLevel: mode })}
            >
              {mode}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}
