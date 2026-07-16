// A tiny pub/sub for transient toast notifications, bridging the module-singleton QueryClient
// (created outside React) to the React `<Toaster>`. Mirrors `auth.ts`: producers call `notifyToast`
// (or the `notifyError` shorthand), and the mounted `<Toaster>` subscribes via `onToast`.
//
// The main producer today is the global query-error handler in `queryClient.ts`, which toasts real
// failures (5xx / 429 / network) — see `shouldToastError` in `queries.ts`.

/** A toast's severity, driving its colour. */
export type ToastTone = "error" | "info";

/** A toast payload: the text to show and its tone. */
export interface ToastMessage {
  message: string;
  tone: ToastTone;
}

type Listener = (toast: ToastMessage) => void;

const listeners = new Set<Listener>();

/** Subscribe to toast notifications. Returns an unsubscribe function. */
export function onToast(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Publish a toast to every subscriber. Safe to call with no subscribers. */
export function notifyToast(toast: ToastMessage): void {
  for (const listener of listeners) listener(toast);
}

/** Shorthand for publishing an error-tone toast. */
export function notifyError(message: string): void {
  notifyToast({ message, tone: "error" });
}
