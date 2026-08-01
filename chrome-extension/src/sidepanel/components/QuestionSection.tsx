import { Input } from "@/components/ui/input";

export function QuestionSection() {
  return (
    <div>
      <h2>Question Section</h2>
      <QuestionInput />
      <ChatHistory />
    </div>
  );
}

function QuestionInput() {
  return <Input />;
}

function ChatHistory() {
  return (
    <div className="flex flex-col overflow-y-auto">
      <ChatRequest text="What is happening now?" />
      <ChatResponse text="Response of what is happening now." />
      <ChatRequest text="What is the most important event?" />
      <ChatResponse text="Response of what is the most important event." />
    </div>
  );
}

function ChatRequest({ text }: { text: string }) {
  return <p className="max-w-10/12 pt-2">{text}</p>;
}

function ChatResponse({ text }: { text: string }) {
  return <p className="max-w-10/12 self-end">{text}</p>;
}
