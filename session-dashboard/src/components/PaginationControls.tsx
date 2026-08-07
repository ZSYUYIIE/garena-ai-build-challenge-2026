export function PaginationControls({
  canGoBack,
  canGoForward,
  onBack,
  onForward,
  label,
}: {
  canGoBack: boolean;
  canGoForward: boolean;
  onBack: () => void;
  onForward: () => void;
  label: string;
}) {
  if (!canGoBack && !canGoForward) return null;

  return (
    <nav className="pagination" aria-label={label}>
      <button
        className="button button-secondary"
        type="button"
        disabled={!canGoBack}
        onClick={onBack}
      >
        Previous
      </button>
      <button
        className="button button-secondary"
        type="button"
        disabled={!canGoForward}
        onClick={onForward}
      >
        Next
      </button>
    </nav>
  );
}
