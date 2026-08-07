import { Button } from "./StreamSenseUi";

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
      <Button
        variant="outline"
        size="lg"
        type="button"
        isDisabled={!canGoBack}
        onClick={onBack}
      >
        Previous
      </Button>
      <Button
        variant="outline"
        size="lg"
        type="button"
        isDisabled={!canGoForward}
        onClick={onForward}
      >
        Next
      </Button>
    </nav>
  );
}
