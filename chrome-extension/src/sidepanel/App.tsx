import "./index.css";
import { Header } from "./components/Header";
import { ConfigurationSection } from "./components/ConfigurationSection";
import { ConfigurationOptionsProvider } from "./context/ConfigurationContext";

export default function App() {
  return (
    <ConfigurationOptionsProvider>
      <div className="flex flex-col gap-4 p-4 divide-y">
        <Header />
        <ConfigurationSection />
      </div>
    </ConfigurationOptionsProvider>
  );
}
