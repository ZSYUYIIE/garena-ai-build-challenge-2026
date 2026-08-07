import { useState } from "react";

import { openConfiguredHistoryDashboard } from "../../services/historyNavigation";

export function HistoryNavigation() {
  const [openFailed, setOpenFailed] = useState(false);

  async function handleOpenHistory() {
    setOpenFailed(false);
    try {
      await openConfiguredHistoryDashboard();
    } catch {
      setOpenFailed(true);
    }
  }

  return (
    <div>
      <button
        type="button"
        onClick={() => { void handleOpenHistory(); }}
        aria-label="View StreamSense history in a new tab"
        className="flex w-full items-center justify-between gap-3 rounded-md px-2 py-2 text-left text-sm font-medium hover:bg-muted focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
      >
        <span>View History</span>
        <OpenInNewTabIcon />
      </button>
      {openFailed ? (
        <p role="alert" className="px-2 pt-1 text-xs text-destructive">
          StreamSense could not open history in a new tab.
        </p>
      ) : null}
    </div>
  );
}

function OpenInNewTabIcon() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className="shrink-0 text-muted-foreground"
    >
      <path d="M15 3h6v6M10 14 21 3M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
    </svg>
  );
}
