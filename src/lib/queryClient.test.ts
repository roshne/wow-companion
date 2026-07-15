import { describe, it, expect, vi } from "vitest";
import { createQueryClient, shouldRetry } from "./queryClient";
import { BnetError } from "./queries";

describe("shouldRetry", () => {
  it("never retries client (4xx) errors, including 429", () => {
    expect(shouldRetry(0, new BnetError(404))).toBe(false);
    expect(shouldRetry(0, new BnetError(401))).toBe(false);
    expect(shouldRetry(1, new BnetError(429))).toBe(false);
  });

  it("retries transient errors up to twice", () => {
    expect(shouldRetry(0, new BnetError(500))).toBe(true);
    expect(shouldRetry(1, new BnetError(503))).toBe(true);
    expect(shouldRetry(2, new BnetError(500))).toBe(false);
  });

  it("retries non-BnetError failures (e.g. network)", () => {
    expect(shouldRetry(0, new Error("network"))).toBe(true);
  });
});

describe("createQueryClient", () => {
  it("dedups concurrent identical fetches — the queryFn runs once", async () => {
    const client = createQueryClient();
    const queryFn = vi.fn(async () => "value");
    const opts = { queryKey: ["dedup", "us"] as const, queryFn, staleTime: 60_000 };
    const [a, b] = await Promise.all([client.fetchQuery(opts), client.fetchQuery(opts)]);
    expect(a).toBe("value");
    expect(b).toBe("value");
    expect(queryFn).toHaveBeenCalledTimes(1);
  });

  it("serves cached data within staleTime without refetching", async () => {
    const client = createQueryClient();
    const queryFn = vi.fn(async () => 1);
    const opts = { queryKey: ["cache", "us"] as const, queryFn, staleTime: 60_000 };
    await client.fetchQuery(opts);
    await client.fetchQuery(opts);
    expect(queryFn).toHaveBeenCalledTimes(1);
  });

  it("keeps distinct region keys in separate caches", async () => {
    const client = createQueryClient();
    const queryFn = vi.fn(async () => 1);
    await client.fetchQuery({ queryKey: ["k", "us"] as const, queryFn, staleTime: 60_000 });
    await client.fetchQuery({ queryKey: ["k", "eu"] as const, queryFn, staleTime: 60_000 });
    expect(queryFn).toHaveBeenCalledTimes(2);
  });

  it("does not retry a 4xx error (single attempt)", async () => {
    const client = createQueryClient();
    const queryFn = vi.fn(async () => {
      throw new BnetError(404);
    });
    await expect(
      client.fetchQuery({ queryKey: ["retry-4xx"] as const, queryFn }),
    ).rejects.toBeInstanceOf(BnetError);
    expect(queryFn).toHaveBeenCalledTimes(1);
  });
});
