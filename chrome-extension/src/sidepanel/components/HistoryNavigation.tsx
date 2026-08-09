import { useState } from "react";
import { ExternalLink, LayoutDashboard } from "lucide-react";

import { Button } from "@/components/ui/button";
import { openConfiguredHistoryDashboard } from "../../services/historyNavigation";

type HistoryNavigationProps = {
  activeSessionId: string | null;
};

export function HistoryNavigation({ activeSessionId }: HistoryNavigationProps) {
  const [openFailed, setOpenFailed] = useState(false);

  async function handleOpenHistory() {
    setOpenFailed(false);
    try {
      await openConfiguredHistoryDashboard(activeSessionId);
    } catch {
      setOpenFailed(true);
    }
  }

  return (
    <nav aria-label="Memory dashboard">
      <Button
        type="button"
        onPress={() => { void handleOpenHistory(); }}
        className="h-auto min-h-11 w-full justify-between gap-3 whitespace-normal px-3 py-2 text-left"
      >
        <span className="flex min-w-0 items-start gap-2.5">
          <LayoutDashboard
            data-icon="inline-start"
            aria-hidden="true"
            className="mt-0.5"
          />
          <span className="min-w-0">
            <span className="block font-semibold">Open Memory Dashboard</span>
            <span className="compact-optional mt-0.5 block text-xs font-normal">
              {activeSessionId
                ? "Review this session’s memory in a new tab."
                : "Review saved sessions in a new tab."}
            </span>
          </span>
        </span>
        <ExternalLink data-icon="inline-end" aria-hidden="true" />
      </Button>
      {openFailed ? (
        <p role="alert" className="px-1 pt-1.5 text-xs text-destructive">
          StreamSense could not open the Memory Dashboard in a new tab.
        </p>
      ) : null}
    </nav>
  );
}
