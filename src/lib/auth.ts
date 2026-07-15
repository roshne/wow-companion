// A tiny pub/sub bridging the module-singleton QueryClient (created outside React) to React state.
//
// When a data call returns 401 the client secret is invalid/expired; the QueryClient's global error
// handler calls `notifyUnauthorized()`, and the app (which owns the "connected?" state) subscribes via
// `onUnauthorized()` to clear the stored secret and route back to the connect form.

type Listener = () => void;

const listeners = new Set<Listener>();

/** Subscribe to "the session is unauthorized (401)" notifications. Returns an unsubscribe function. */
export function onUnauthorized(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Notify every subscriber that a 401 was seen. Safe to call with no subscribers. */
export function notifyUnauthorized(): void {
  for (const listener of listeners) listener();
}
