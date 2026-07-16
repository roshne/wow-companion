import { describe, it, expect, vi } from "vitest";
import { createQueryClient } from "./queryClient";
import { BnetError } from "./queries";
import { onUnauthorized } from "./auth";
import { onToast, type ToastMessage } from "./toast";

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

describe("createQueryClient — 401 re-auth signal", () => {
  it("notifies unauthorized subscribers on a BnetError 401", async () => {
    const client = createQueryClient();
    const listener = vi.fn();
    const off = onUnauthorized(listener);
    await client
      .fetchQuery({
        queryKey: ["unauth"] as const,
        queryFn: async () => {
          throw new BnetError(401);
        },
        retry: false,
      })
      .catch(() => {});
    expect(listener).toHaveBeenCalledTimes(1);
    off();
  });

  it("does not notify on other errors (404, 5xx, or non-BnetError)", async () => {
    const client = createQueryClient();
    const listener = vi.fn();
    const off = onUnauthorized(listener);
    const errors = [new BnetError(404), new BnetError(503), new Error("network")];
    for (let i = 0; i < errors.length; i++) {
      await client
        .fetchQuery({
          queryKey: ["not-401", i] as const,
          queryFn: async () => {
            throw errors[i];
          },
          retry: false,
        })
        .catch(() => {});
    }
    expect(listener).not.toHaveBeenCalled();
    off();
  });
});

describe("createQueryClient — error toasts", () => {
  /** Run a query that throws `error`, collecting any toasts fired by the global handler. */
  async function toastsFor(error: unknown, key: string): Promise<ToastMessage[]> {
    const client = createQueryClient();
    const toasts: ToastMessage[] = [];
    const off = onToast((t) => toasts.push(t));
    await client
      .fetchQuery({
        queryKey: [key] as const,
        queryFn: async () => {
          throw error;
        },
        retry: false,
      })
      .catch(() => {});
    off();
    return toasts;
  }

  it("toasts a server error (5xx) with the described message", async () => {
    const toasts = await toastsFor(new BnetError(503), "toast-503");
    expect(toasts).toEqual([{ message: "Failed (HTTP 503).", tone: "error" }]);
  });

  it("toasts a rate-limit (429) and a non-HTTP failure", async () => {
    expect(await toastsFor(new BnetError(429), "toast-429")).toHaveLength(1);
    expect(await toastsFor(new Error("network down"), "toast-net")).toHaveLength(1);
  });

  it("does not toast an expected 404", async () => {
    expect(await toastsFor(new BnetError(404), "toast-404")).toEqual([]);
  });

  it("does not toast a 401 (routes to reconnect instead)", async () => {
    expect(await toastsFor(new BnetError(401), "toast-401")).toEqual([]);
  });
});
