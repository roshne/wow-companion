import { describe, it, expect } from "vitest";
import { isRetryableError, shouldRetry, backoffMs, MAX_ATTEMPTS } from "./retry";
import { BnetError } from "./queries";

describe("isRetryableError", () => {
  it("retries 429 and 5xx", () => {
    expect(isRetryableError(new BnetError(429))).toBe(true);
    expect(isRetryableError(new BnetError(500))).toBe(true);
    expect(isRetryableError(new BnetError(503))).toBe(true);
  });

  it("does not retry other 4xx", () => {
    expect(isRetryableError(new BnetError(400))).toBe(false);
    expect(isRetryableError(new BnetError(401))).toBe(false);
    expect(isRetryableError(new BnetError(403))).toBe(false);
    expect(isRetryableError(new BnetError(404))).toBe(false);
  });

  it("retries non-HTTP (network) failures", () => {
    expect(isRetryableError(new Error("network down"))).toBe(true);
  });
});

describe("shouldRetry", () => {
  it("retries transient failures until the attempt cap", () => {
    expect(shouldRetry(1, new BnetError(429))).toBe(true);
    expect(shouldRetry(MAX_ATTEMPTS - 1, new BnetError(503))).toBe(true);
    expect(shouldRetry(MAX_ATTEMPTS, new BnetError(429))).toBe(false);
  });

  it("never retries a non-retryable error, even on the first failure", () => {
    expect(shouldRetry(1, new BnetError(404))).toBe(false);
  });
});

describe("backoffMs", () => {
  it("honors a parsed Retry-After exactly, ignoring attempt and jitter", () => {
    expect(backoffMs(3, new BnetError(429, 7), () => 0.5)).toBe(7000);
  });

  it("uses capped exponential backoff without jitter when rng is 0", () => {
    expect(backoffMs(0, new BnetError(500), () => 0)).toBe(1000);
    expect(backoffMs(2, new BnetError(500), () => 0)).toBe(4000);
  });

  it("caps the exponential term at 30s", () => {
    expect(backoffMs(20, new BnetError(500), () => 0)).toBe(30_000);
  });

  it("adds full jitter within one base interval", () => {
    const ms = backoffMs(0, new BnetError(500), () => 0.999);
    expect(ms).toBeGreaterThanOrEqual(1000);
    expect(ms).toBeLessThan(2000);
  });

  it("backs off for network errors too", () => {
    expect(backoffMs(1, new Error("x"), () => 0)).toBe(2000);
  });
});
