import { useCallback, useEffect, useRef, useState } from "react";
import { onToast, type ToastMessage } from "../lib/toast";

/** How long a toast stays before auto-dismissing. */
const DISMISS_MS = 6000;

interface ActiveToast extends ToastMessage {
  id: number;
}

/**
 * The app-wide toast host: mounted once at the root, it subscribes to the toast bus and renders a
 * fixed-position stack. Toasts auto-dismiss after {@link DISMISS_MS}, can be closed manually, and are
 * deduped — an identical (message + tone) toast that's already visible is dropped, so a burst of the
 * same failure (retries, several failing queries) doesn't stack up.
 */
export function Toaster() {
  const [toasts, setToasts] = useState<ActiveToast[]>([]);
  const nextId = useRef(0);
  const timers = useRef<Map<number, ReturnType<typeof setTimeout>>>(new Map());

  const dismiss = useCallback((id: number) => {
    const timer = timers.current.get(id);
    if (timer) {
      clearTimeout(timer);
      timers.current.delete(id);
    }
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  useEffect(() => {
    const off = onToast((t) => {
      setToasts((prev) => {
        if (prev.some((x) => x.message === t.message && x.tone === t.tone)) return prev;
        const id = nextId.current++;
        timers.current.set(
          id,
          setTimeout(() => dismiss(id), DISMISS_MS),
        );
        return [...prev, { ...t, id }];
      });
    });
    const pending = timers.current;
    return () => {
      off();
      for (const timer of pending.values()) clearTimeout(timer);
      pending.clear();
    };
  }, [dismiss]);

  if (toasts.length === 0) return null;

  return (
    <div className="toaster" role="region" aria-label="Notifications">
      {toasts.map((t) => (
        <div key={t.id} className={`toast toast-${t.tone}`} role="alert">
          <span>{t.message}</span>
          <button
            type="button"
            className="toast-close ghost"
            aria-label="Dismiss"
            onClick={() => dismiss(t.id)}
          >
            ×
          </button>
        </div>
      ))}
    </div>
  );
}
