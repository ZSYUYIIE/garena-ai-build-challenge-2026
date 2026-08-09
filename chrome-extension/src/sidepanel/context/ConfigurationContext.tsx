import {
  useCallback,
  createContext,
  useContext,
  useState,
  type Dispatch,
  type ReactNode,
  type SetStateAction,
} from "react";

import {
  readVoiceNarrationMode,
  writeVoiceNarrationMode,
  type VoiceNarrationMode,
} from "../voiceNarration";

export enum NarrationMode {
  Minimal = "minimal",
  Standard = "standard",
  Detailed = "detailed",
  QuestionOnly = "question_only",
}

export type ConfigurationOptions = {
  narrationLevel: NarrationMode;
  voiceNarrationMode: VoiceNarrationMode;
};

type ConfigurationContextValue = {
  options: ConfigurationOptions;
  setOptions: Dispatch<SetStateAction<ConfigurationOptions>>;
  setVoiceNarrationMode: (mode: VoiceNarrationMode) => void;
};

const ConfigurationOptionsContext = createContext<
  ConfigurationContextValue | undefined
>(undefined);

export function ConfigurationOptionsProvider({
  children,
}: {
  children: ReactNode;
}) {
  const [options, setOptions] = useState<ConfigurationOptions>(() => ({
    narrationLevel: NarrationMode.Standard,
    voiceNarrationMode: readVoiceNarrationMode(),
  }));
  const setVoiceNarrationMode = useCallback((mode: VoiceNarrationMode) => {
    setOptions((current) => ({ ...current, voiceNarrationMode: mode }));
    writeVoiceNarrationMode(mode);
  }, []);

  return (
    <ConfigurationOptionsContext.Provider
      value={{ options, setOptions, setVoiceNarrationMode }}
    >
      {children}
    </ConfigurationOptionsContext.Provider>
  );
}

export function useConfigurationOptions() {
  const context = useContext(ConfigurationOptionsContext);

  if (!context) {
    throw new Error(
      "useConfigurationOptions must be used within a ConfigurationOptionsProvider",
    );
  }

  return context;
}
