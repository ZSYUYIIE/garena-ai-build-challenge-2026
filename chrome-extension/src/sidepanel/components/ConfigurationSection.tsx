import { useCallback, useEffect, useState } from "react";

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
import {
  VOICE_NARRATION_MODES,
  VOICE_NARRATION_MODE_LABELS,
  isVoiceNarrationMode,
  voiceNarrationModeAfterShortcut,
  type VoiceNarrationMode,
} from "../voiceNarration";

export function ConfigurationSection() {
  const { options, setOptions, setVoiceNarrationMode } =
    useConfigurationOptions();
  const narrationModes = Object.values(NarrationMode);
  const [announcement, setAnnouncement] = useState("");
  const changeVoiceNarrationMode = useCallback(
    (mode: VoiceNarrationMode) => {
      setVoiceNarrationMode(mode);
      setAnnouncement(
        `Voice narration: ${VOICE_NARRATION_MODE_LABELS[mode]}`,
      );
    },
    [setVoiceNarrationMode],
  );

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      const next = voiceNarrationModeAfterShortcut(
        options.voiceNarrationMode,
        event,
        event.target,
      );
      if (!next) return;
      event.preventDefault();
      changeVoiceNarrationMode(next);
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [changeVoiceNarrationMode, options.voiceNarrationMode]);

  return (
    <div className="space-y-1.5">
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
      <div className="flex items-center justify-between gap-2">
        <label
          htmlFor="voice-narration-mode"
          className="text-sm text-muted-foreground"
        >
          Voice narration <span aria-hidden="true">(N)</span>
        </label>
        <Select
          aria-label="Voice narration"
          value={options.voiceNarrationMode}
          onChange={(value) => {
            if (isVoiceNarrationMode(value)) changeVoiceNarrationMode(value);
          }}
        >
          <SelectTrigger
            id="voice-narration-mode"
            aria-label="Voice narration"
            size="sm"
          >
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {VOICE_NARRATION_MODES.map((mode) => (
              <SelectItem
                id={`voice-${mode}`}
                key={mode}
                value={mode}
                onClick={() => changeVoiceNarrationMode(mode)}
                className="text-sm"
              >
                {VOICE_NARRATION_MODE_LABELS[mode]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <p className="sr-only" aria-live="polite" aria-atomic="true">
        {announcement}
      </p>
    </div>
  );
}
