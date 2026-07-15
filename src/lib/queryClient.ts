import { QueryClient } from "@tanstack/react-query";
import { shouldRetry, backoffMs } from "./retry";

/** How long unused (garbage-collectible) query data lingers in cache before eviction. */
const GC_TIME = 30 * 60 * 1000;

/**
 * The app's single, module-singleton QueryClient (created once in `main.tsx`).
 *
 * Defaults chosen for a desktop app against a rate-limited API (36,000/hr · 100/s):
 * - `refetchOnWindowFocus: false` — focus churn shouldn't spend quota.
 * - `retry`/`retryDelay` from `retry.ts`: retry only transient failures (429/5xx/network) up to a
 *   cap, backing off with a server's `Retry-After` when present, else jittered exponential backoff.
 *
 * Per-query `staleTime`/`gcTime` live with the query-option factories in `queries.ts`.
 */
export function createQueryClient(): QueryClient {
  return new QueryClient({
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
