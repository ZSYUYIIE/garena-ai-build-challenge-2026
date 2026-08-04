import { useCallback } from "react";

import "./index.css";
import { EventTimelineSection } from "./components/EventTimelineSection";
import { Header } from "./components/Header";
import { QuestionSection } from "./components/QuestionSection";
import { VideoDescriptionSection } from "./components/VideoDescriptionSection";
import {
  ConfigurationOptionsProvider,
  useConfigurationOptions,
} from "./context/ConfigurationContext";
import { useRealtimeSession } from "./realtime/useRealtimeSession";

export default function App() {
  return (
    <ConfigurationOptionsProvider>
      <StreamSensePanel />
    </ConfigurationOptionsProvider>
  );
}

function StreamSensePanel() {
  const { options } = useConfigurationOptions();
  const session = useRealtimeSession(options.narrationLevel);

  const handleRunningChange = useCallback(
    (shouldRun: boolean) => {
      if (shouldRun) {
        void session.start();
      } else {
        session.stop();
      }
    },
    [session],
  );

  const handleAsk = useCallback(
    (question: string) => {
      session.ask(question);
    },
    [session],
  );

  return (
    <div className="flex h-screen flex-col divide-y divide-border overflow-hidden p-4">
      <div className="pb-3">
        <Header
          status={session.status}
          isRunning={session.isRunning}
          isBusy={session.isBusy}
          canStart={session.canStart}
          onRunningChange={handleRunningChange}
        />
      </div>
      <div className="py-3">
        <VideoDescriptionSection
          description={session.description}
          statusText={session.statusText}
          error={session.error}
        />
      </div>
      <div className="py-3">
        <EventTimelineSection events={session.events} />
      </div>
      <div className="flex min-h-0 flex-1 flex-col pt-3">
        <QuestionSection
          messages={session.messages}
          onAsk={handleAsk}
          disabled={!session.canAsk}
          voiceStatus={session.voiceStatus}
          tabContextStatus={session.tabContextStatus}
        />
      </div>
    </div>
  );
}
