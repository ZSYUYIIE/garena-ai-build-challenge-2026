import type { DataOrigin } from "../api/contracts";

export function DemoDataBanner({ dataOrigin }: { dataOrigin: DataOrigin }) {
  const notice = dataSourceNotice(dataOrigin);
  if (!notice) return null;

  return (
    <aside
      className={`demo-banner data-source-banner data-source-banner--${dataOrigin}`}
      aria-label="Data source notice"
      data-data-origin={dataOrigin}
    >
      <strong>{notice.title}</strong>
      <span> {notice.description}</span>
    </aside>
  );
}

function dataSourceNotice(dataOrigin: DataOrigin): {
  title: string;
  description: string;
} | null {
  switch (dataOrigin) {
    case "realtime":
      return {
        title: "Captured session memory",
        description:
          "This view contains session history recorded through StreamSense Live.",
      };
    case "mixed":
      return {
        title: "Captured and demo memory",
        description:
          "This view combines recorded session history with seeded development examples.",
      };
    case "demo":
      return {
        title: "Development demo data",
        description:
          "These are seeded example sessions, not captured viewing history.",
      };
    case "empty":
    case null:
      return null;
  }
}
