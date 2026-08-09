import { useCallback } from "react";

import { EventTimelineSection } from "./components/EventTimelineSection";
import { Header } from "./components/Header";
import { HistoryNavigation } from "./components/HistoryNavigation";
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
    [session.start, session.stop],
  );

  const handleAsk = useCallback(
    (question: string) => session.ask(question),
    [session.ask],
  );

  const handlePlayResearchVoice = useCallback(
    (sourceTurnId: string) => session.playResearchVoice(sourceTurnId),
    [session.playResearchVoice],
  );

  const handleEnableVoice = useCallback(
    () => session.enableVoice(),
    [session.enableVoice],
  );

  const handleStartVoice = useCallback(
    () => session.startVoiceQuestion(),
    [session.startVoiceQuestion],
  );

  const handleStopVoice = useCallback(
    () => session.stopVoiceQuestion(),
    [session.stopVoiceQuestion],
  );

  return (
    <div className="flex h-screen flex-col divide-y divide-border overflow-hidden p-3">
      <div className="shrink-0 pb-2">
        <Header
          status={session.status}
          isRunning={session.isRunning}
          isBusy={session.isBusy}
          canStart={session.canStart}
          onRunningChange={handleRunningChange}
        />
      </div>
      <div className="shrink-0 py-2">
        <HistoryNavigation activeSessionId={session.activeSessionId} />
      </div>
      <div className="shrink-0 py-2">
        <VideoDescriptionSection
          description={session.description}
          statusText={session.statusText}
          error={session.error}
          isRunning={session.isRunning}
          isSpeaking={session.voiceStatus === "gemini_speaking"}
        />
      </div>
      <div className="flex min-h-20 max-h-32 flex-[0.6] flex-col overflow-hidden py-2">
        <EventTimelineSection events={session.events} />
      </div>
      <div className="flex min-h-60 flex-[1.4] flex-col pt-2">
        <QuestionSection
          messages={session.messages}
          onAsk={handleAsk}
          onPlayResearchVoice={handlePlayResearchVoice}
          onEnableVoice={handleEnableVoice}
          onStartVoice={handleStartVoice}
          onStopVoice={handleStopVoice}
          canEnableVoice={session.canEnableVoice}
          canStartVoice={session.canStartVoice}
          questionAvailability={session.questionAvailability}
          canPlayResearchVoice={session.questionAvailability === "ready" && session.voiceStatus !== "gemini_speaking"}
          voiceStatus={session.voiceStatus}
          microphoneState={session.microphoneState}
          tabContextStatus={session.tabContextStatus}
          researchMode={session.researchMode}
          researchProgress={session.researchProgress}
          onResearchModeChange={session.setResearchMode}
        />
      </div>
    </div>
  );
}
