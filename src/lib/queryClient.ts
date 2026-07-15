import { QueryClient } from "@tanstack/react-query";
import { BnetError } from "./queries";

/** How long unused (garbage-collectible) query data lingers in cache before eviction. */
const GC_TIME = 30 * 60 * 1000;

/**
 * Retry policy: never retry client errors (4xx) — they won't succeed on a retry and only burn the
 * rate-limit budget — and retry anything else up to twice. #20 replaces this with the full
 * 429/5xx + `Retry-After` backoff policy.
 */
export function shouldRetry(failureCount: number, error: unknown): boolean {
  if (error instanceof BnetError && error.status >= 400 && error.status < 500) return false;
  return failureCount < 2;
}

/**
 * The app's single, module-singleton QueryClient (created once in `main.tsx`).
 *
 * Defaults chosen for a desktop app against a rate-limited API (36,000/hr · 100/s):
 * - `refetchOnWindowFocus: false` — focus churn shouldn't spend quota.
 * - a conservative `retry` predicate that never retries client errors (4xx) — they won't succeed on
 *   retry and retrying only burns the rate-limit budget. #20 replaces this with the full
 *   429/5xx + `Retry-After` backoff policy (which is why `BnetError` already carries `retryAfter`).
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
      },
    },
  });
}
