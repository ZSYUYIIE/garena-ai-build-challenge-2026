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
      <div className="grid h-screen gap-2 p-4 divide-y">
        <Header />
        <ConfigurationSection />
        <VideoDescriptionSection />
        <EventTimelineSection />
        <QuestionSection />
      </div>
    </ConfigurationOptionsProvider>
  );
}
