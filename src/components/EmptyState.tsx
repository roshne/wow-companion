/**
 * A friendly empty / not-found / error state: a short message with an optional Retry button. Pass
 * `onRetry` (e.g. a query's `refetch`) when the state is recoverable; omit it for a genuine empty
 * (a successful load with nothing to show), where retrying wouldn't help.
 */
export function EmptyState({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div className="empty-state">
      <p className="muted" style={{ margin: 0 }}>
        {message}
      </p>
      {onRetry && (
        <button type="button" onClick={onRetry}>
          Retry
        </button>
      )}
    </div>
  );
}
