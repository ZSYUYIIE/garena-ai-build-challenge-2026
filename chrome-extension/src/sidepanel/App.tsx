import { useState } from "react";
import "./index.css";
import { Header } from "./components/Header";
import { ConfigurationOptionsProvider } from "./context/ConfigurationContext";
import {
  EventTimelineSection,
  type TimelineEvent,
} from "./components/EventTimelineSection";
import {
  QuestionSection,
  type ChatMessage,
} from "./components/QuestionSection";
import { VideoDescriptionSection } from "./components/VideoDescriptionSection";

const mockEvents: TimelineEvent[] = [
  { id: "1", timestamp: "02:41", description: "Sauce plated over scallops" },
  { id: "2", timestamp: "02:30", description: "Butter added to finish the sauce" },
  { id: "3", timestamp: "02:14", description: "Scallops plated with citrus sauce" },
  { id: "4", timestamp: "01:58", description: "Scallops flipped for even sear" },
  { id: "5", timestamp: "01:42", description: "Pan seared on high heat" },
  { id: "6", timestamp: "01:30", description: "Oil added to hot pan" },
  { id: "7", timestamp: "01:20", description: "Scallops patted dry and seasoned" },
  { id: "8", timestamp: "01:05", description: "Chef begins searing scallops" },
  { id: "9", timestamp: "00:48", description: "Ingredients laid out on cutting board" },
  { id: "10", timestamp: "00:22", description: "Chef enters the kitchen" },
];

export default function App() {
  const [messages, setMessages] = useState<ChatMessage[]>([]);

  function handleAsk(question: string) {
    setMessages((prev) => [
      ...prev,
      { id: crypto.randomUUID(), role: "user", text: question },
    ]);
    setMessages((prev) => [
      ...prev,
      { id: crypto.randomUUID(), role: "assistant", text: "..." },
    ]);
  }

  return (
    <ConfigurationOptionsProvider>
      <div className="flex h-screen flex-col divide-y divide-border overflow-hidden p-4">
        <div className="pb-3">
          <Header />
        </div>
        <div className="py-3">
          <VideoDescriptionSection description="A chef plates seared scallops with citrus sauce." />
        </div>
        <div className="py-3">
          <EventTimelineSection events={mockEvents} />
        </div>
        <div className="flex min-h-0 flex-1 flex-col pt-3">
          <QuestionSection messages={messages} onAsk={handleAsk} />
        </div>
      </div>
    </ConfigurationOptionsProvider>
  );
}