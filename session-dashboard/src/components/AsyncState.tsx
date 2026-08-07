import type { ReactNode } from "react";

type StateProps = {
  title: string;
  children: ReactNode;
};

export function LoadingState({ label = "Loading history…" }: { label?: string }) {
  return (
    <div className="state-panel" role="status" aria-live="polite">
      <span className="loading-indicator" aria-hidden="true" />
      <p>{label}</p>
    </div>
  );
}

export function ErrorState({
  title = "History could not be loaded",
  message,
  onRetry,
}: {
  title?: string;
  message: string;
  onRetry?: () => void;
}) {
  return (
    <section className="state-panel state-error" role="alert">
      <h2>{title}</h2>
      <p>{message}</p>
      {onRetry ? (
        <button className="button button-secondary" type="button" onClick={onRetry}>
          Try again
        </button>
      ) : null}
    </section>
  );
}

export function EmptyState({ title, children }: StateProps) {
  return (
    <section className="state-panel state-empty">
      <h2>{title}</h2>
      <div>{children}</div>
    </section>
  );
}

export function UnavailableState({ title, children }: StateProps) {
  return (
    <section className="state-panel state-unavailable" role="status">
      <h2>{title}</h2>
      <div>{children}</div>
    </section>
  );
}
