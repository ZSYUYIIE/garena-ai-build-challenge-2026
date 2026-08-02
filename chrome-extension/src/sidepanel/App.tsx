import { useState } from "react";
import "./index.css";
import { Header } from "./components/Header";
import { ConfigurationSection } from "./components/ConfigurationSection";
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
  { id: "1", timestamp: "02:14", description: "Scallops plated with citrus sauce" },
  { id: "2", timestamp: "01:42", description: "Pan seared on high heat" },
  { id: "3", timestamp: "01:05", description: "Chef begins searing scallops" },
];

export default function App() {
  const [messages, setMessages] = useState<ChatMessage[]>([]);

  function handleAsk(question: string) {
    setMessages((prev) => [
      ...prev,
      { id: crypto.randomUUID(), role: "user", text: question },
    ]);
    // TODO: replace with a real answer once wired to your backend
    setMessages((prev) => [
      ...prev,
      { id: crypto.randomUUID(), role: "assistant", text: "..." },
    ]);
  }

  return (
    <ConfigurationOptionsProvider>
      <div className="grid h-screen gap-2 p-4 divide-y">
        <Header />
        <ConfigurationSection />
        <VideoDescriptionSection description="A chef plates seared scallops with citrus sauce." />
        <EventTimelineSection events={mockEvents} />
        <QuestionSection messages={messages} onAsk={handleAsk} />
      </div>
    </ConfigurationOptionsProvider>
  );
}