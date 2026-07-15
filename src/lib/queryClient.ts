import { QueryCache, QueryClient } from "@tanstack/react-query";
import { shouldRetry, backoffMs } from "./retry";
import { BnetError } from "./queries";
import { notifyUnauthorized } from "./auth";

/** How long unused (garbage-collectible) query data lingers in cache before eviction. */
const GC_TIME = 30 * 60 * 1000;

/**
 * The app's single, module-singleton QueryClient (created once in `main.tsx`).
 *
 * Defaults chosen for a desktop app against a rate-limited API (36,000/hr · 100/s):
 * - `refetchOnWindowFocus: false` — focus churn shouldn't spend quota.
 * - `retry`/`retryDelay` from `retry.ts`: retry only transient failures (429/5xx/network) up to a
 *   cap, backing off with a server's `Retry-After` when present, else jittered exponential backoff.
 * - a global `QueryCache.onError` that treats a 401 (invalid/expired secret) as a re-auth signal —
 *   keying strictly on `BnetError.status === 401` so a network blip or token-fetch failure can't
 *   trip it. The app subscribes via `onUnauthorized` to clear the secret and show the connect form.
 *
 * Per-query `staleTime`/`gcTime` live with the query-option factories in `queries.ts`.
 */
export function createQueryClient(): QueryClient {
  return new QueryClient({
    queryCache: new QueryCache({
      onError: (error) => {
        if (error instanceof BnetError && error.status === 401) notifyUnauthorized();
      },
    }),
    defaultOptions: {
      queries: {
        gcTime: GC_TIME,
        refetchOnWindowFocus: false,
        retry: shouldRetry,
        retryDelay: backoffMs,
      },
    },
  });
}
