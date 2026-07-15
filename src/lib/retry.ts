// Retry policy for the data layer: which failures are worth retrying, and how long to wait.
//
// Shared by the QueryClient (`retry`/`retryDelay`). A transient failure — an HTTP 429 (rate limited),
// a 5xx, or a network error — is retried up to MAX_ATTEMPTS times; a definite client error (401/403/
// 404) is not (a retry won't change the outcome and only burns quota). Backoff honors a server's
// `Retry-After` when we parsed one, else capped exponential backoff with jitter.

import { BnetError } from "./queries";

/** Total attempts (initial + retries) before a transient failure is surfaced. */
export const MAX_ATTEMPTS = 4;
const BASE_DELAY = 1000;
const MAX_DELAY = 30_000;

/** Whether an error is worth retrying: 429/5xx (or a non-HTTP failure), but never other 4xx. */
export function isRetryableError(error: unknown): boolean {
  if (error instanceof BnetError) {
    return error.status === 429 || (error.status >= 500 && error.status < 600);
  }
  // Non-BnetError (e.g. a network/fetch failure) — treat as transient.
  return true;
}

/** TanStack `retry` predicate: retry a transient failure until the attempt cap is reached. */
export function shouldRetry(failureCount: number, error: unknown): boolean {
  return failureCount < MAX_ATTEMPTS && isRetryableError(error);
}

/**
 * TanStack `retryDelay`: how long to wait before the next attempt. Honors a parsed `Retry-After`
 * exactly; otherwise capped exponential backoff (`min(1000·2^attempt, 30_000)`) plus full jitter so a
 * burst of failures doesn't retry in lockstep. `rng` is injectable for deterministic tests.
 */
export function backoffMs(
  attempt: number,
  error: unknown,
  rng: () => number = Math.random,
): number {
  if (error instanceof BnetError && error.retryAfter != null) {
    return error.retryAfter * 1000;
  }
  const capped = Math.min(BASE_DELAY * 2 ** attempt, MAX_DELAY);
  return capped + Math.floor(rng() * BASE_DELAY);
}
