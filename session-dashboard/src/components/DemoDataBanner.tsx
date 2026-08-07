import type { DataOrigin } from "../api/contracts";

export function DemoDataBanner({ dataOrigin }: { dataOrigin: DataOrigin }) {
  if (dataOrigin !== "demo" && dataOrigin !== "mixed") return null;

  return (
    <aside className="demo-banner" aria-label="Data source notice">
      <strong>{dataOrigin === "demo" ? "Development demo data" : "Mixed history"}</strong>
      <span>
        {dataOrigin === "demo"
          ? " These are seeded example sessions, not captured viewing history."
          : " This view includes seeded examples alongside captured sessions."}
      </span>
    </aside>
  );
}
