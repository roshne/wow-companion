import { describe, it, expect, beforeEach, vi } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";

// The hook resolves names through `fetchItemName`; mock just that (persist stays real, backed by the
// in-memory localStorage from the test setup).
vi.mock("./queries", () => ({
  fetchItemName: vi.fn(async (_bnet: unknown, id: number) => ({ name: `Item ${id}` })),
}));

import { useItemNames } from "./useItemNames";
import { fetchItemName } from "./queries";
import { mergeItemNames } from "./persist";
import { mockBnet } from "../test/mocks";

const mockFetch = vi.mocked(fetchItemName);

/** Ids the fetcher was actually called with. */
function fetchedIds(): number[] {
  return mockFetch.mock.calls.map((c) => c[1] as number);
}

describe("useItemNames", () => {
  beforeEach(() => {
    localStorage.clear();
    mockFetch.mockClear();
    mockFetch.mockImplementation(async (_bnet: unknown, id: number) => ({ name: `Item ${id}` }));
  });

  it("resolves only the given ids and persists them", async () => {
    const { bnet } = mockBnet();
    const { result } = renderHook(() => useItemNames(bnet, [100, 200]));

    await waitFor(() => {
      expect(result.current[100]).toEqual({ name: "Item 100" });
      expect(result.current[200]).toEqual({ name: "Item 200" });
    });
    expect(fetchedIds().sort((a, b) => a - b)).toEqual([100, 200]);
    // Written through to the persistent cache.
    expect(localStorage.getItem("wow-companion:item-names")).toContain("Item 100");
  });

  it("seeds from the persisted cache without re-fetching known ids", async () => {
    mergeItemNames({ 100: { name: "Cached Item", quality: "EPIC" } });
    const { bnet } = mockBnet();
    const { result } = renderHook(() => useItemNames(bnet, [100, 200]));

    // Cached id available synchronously; only the uncached id is fetched.
    expect(result.current[100]).toEqual({ name: "Cached Item", quality: "EPIC" });
    await waitFor(() => expect(result.current[200]).toEqual({ name: "Item 200" }));
    expect(fetchedIds()).toEqual([200]);
  });

  it("dedupes in-flight: each id is fetched at most once across viewport shifts", async () => {
    // Hold every fetch open so the first batch is still in flight when the viewport grows.
    const resolvers: Array<() => void> = [];
    mockFetch.mockImplementation(
      (_bnet: unknown, id: number) =>
        new Promise((resolve) => resolvers.push(() => resolve({ name: `Item ${id}` }))),
    );

    const { bnet } = mockBnet();
    const { rerender } = renderHook(({ ids }: { ids: number[] }) => useItemNames(bnet, ids), {
      initialProps: { ids: [1, 2] },
    });
    // Viewport shifts: 2 stays visible, 3 appears. 1 scrolls off. 2 must not be fetched twice.
    rerender({ ids: [2, 3] });
    rerender({ ids: [2, 3] }); // an idle re-render must not fetch anything new

    resolvers.forEach((r) => r());
    await waitFor(() => expect(mockFetch).toHaveBeenCalledTimes(3));
    expect(fetchedIds().sort((a, b) => a - b)).toEqual([1, 2, 3]);
  });

  it("does not fetch for an empty id list", () => {
    const { bnet } = mockBnet();
    renderHook(() => useItemNames(bnet, []));
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("does not retry an id whose resolve failed within the session", async () => {
    mockFetch.mockResolvedValue(null); // simulate a 404/best-effort miss
    const { bnet } = mockBnet();
    const { rerender } = renderHook(({ ids }: { ids: number[] }) => useItemNames(bnet, ids), {
      initialProps: { ids: [999] },
    });
    await waitFor(() => expect(mockFetch).toHaveBeenCalledTimes(1));
    rerender({ ids: [999] });
    rerender({ ids: [999] });
    // Still one call — the miss is recorded, not retried.
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });
});
