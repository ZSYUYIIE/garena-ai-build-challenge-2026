import { Input } from "@/components/ui/input";

// NOTE: Consider using shadcn React Aria: https://ui.shadcn.com/docs/components/aria/message-scroller
export function QuestionSection() {
  return (
    <div className="flex flex-col flex-1 gap-2 max-h-48">
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
      <ChatRequest text="Lorem" />
      <ChatResponse
        text={`Response of Lorem. 
        Lorem ipsum dolor sit amet consectetur adipisicing elit. Unde,
        doloremque aliquam debitis atque, provident similique nihil rerum totam
        voluptatum molestias ex magni temporibus culpa corporis in modi
        suscipit, corrupti velit! Placeat possimus ratione unde est commodi,
        voluptatibus cumque aspernatur laboriosam aliquam temporibus iste
        numquam accusamus veritatis, autem ab. Eaque quasi nemo vero quibusdam
        aliquam nisi sint nostrum eligendi asperiores cupiditate? Accusamus,
        odit dolore. Saepe reiciendis enim voluptate, odio quod alias nesciunt
        sed perspiciatis temporibus. Sed laudantium qui quas aut harum nam quasi
        rem expedita mollitia eius iste, numquam neque dignissimos. Quas, dolore
        ipsa sint omnis commodi repellendus, autem quaerat repellat minima
        beatae voluptatum aliquid! Non temporibus, rerum, at quasi ipsa ullam
        adipisci nobis facere hic dolorem error fugiat ducimus esse. Recusandae
        obcaecati unde deserunt odio expedita totam earum. Illum quidem quisquam
        dolore non, commodi temporibus repellendus assumenda explicabo quas
        soluta inventore eos, beatae minus ducimus ab impedit adipisci fugit.
        `}
      />
    </div>
  );
}

function ChatRequest({ text }: { text: string }) {
  return <p className="pt-2 max-w-10/12">{text}</p>;
}

function ChatResponse({ text }: { text: string }) {
  return <p className="self-end max-w-10/12">{text}</p>;
}
