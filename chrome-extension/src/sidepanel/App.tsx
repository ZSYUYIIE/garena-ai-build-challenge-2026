import "./index.css";
import { Header } from "./components/Header";
import { ConfigurationSection } from "./components/ConfigurationSection";
import { ConfigurationOptionsProvider } from "./context/ConfigurationContext";
import { EventTimelineSection } from "./components/EventTimelineSection";
import { QuestionSection } from "./components/QuestionSection";
import { VideoDescriptionSection } from "./components/VideoDescriptionSection";

export default function App() {
  return (
    <ConfigurationOptionsProvider>
      <div className="flex flex-col gap-4 p-4 divide-y">
        <Header />
        <ConfigurationSection />
        <VideoDescriptionSection />
        <EventTimelineSection />
        <QuestionSection />
      </div>
    </ConfigurationOptionsProvider>
  );
}
