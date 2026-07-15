import { describe, it, expect, vi } from "vitest";
import { createQueryClient } from "./queryClient";
import { BnetError } from "./queries";

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

  it("retries a transient 429 and then resolves", async () => {
    const client = createQueryClient();
    let calls = 0;
    const queryFn = vi.fn(async () => {
      calls++;
      if (calls === 1) throw new BnetError(429);
      return "ok";
    });
    const result = await client.fetchQuery({
      queryKey: ["retry-429"] as const,
      queryFn,
      retryDelay: 0,
    });
    expect(result).toBe("ok");
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
