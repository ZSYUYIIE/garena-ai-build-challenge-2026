import {
  createContext,
  useContext,
  useState,
  type Dispatch,
  type ReactNode,
  type SetStateAction,
} from "react";

export enum NarrationMode {
  Minimal = "minimal",
  Standard = "standard",
  Detailed = "detailed",
  QuestionOnly = "question_only",
}

export type ConfigurationOptions = {
  narrationLevel: NarrationMode;
};

type ConfigurationContextValue = {
  options: ConfigurationOptions;
  setOptions: Dispatch<SetStateAction<ConfigurationOptions>>;
};

const ConfigurationOptionsContext = createContext<
  ConfigurationContextValue | undefined
>(undefined);

export function ConfigurationOptionsProvider({
  children,
}: {
  children: ReactNode;
}) {
  const [options, setOptions] = useState<ConfigurationOptions>({
    narrationLevel: NarrationMode.Standard,
  });

  return (
    <ConfigurationOptionsContext.Provider value={{ options, setOptions }}>
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
