import { describe, it, expect, beforeEach, vi } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";

// The hook resolves icons through `fetchItemMedia`; mock just that (persist stays real, backed by the
// in-memory localStorage from the test setup).
vi.mock("./queries", () => ({
  fetchItemMedia: vi.fn(async (_bnet: unknown, id: number) => `http://img/${id}.jpg`),
}));

import { useItemIcons } from "./useItemIcons";
import { fetchItemMedia } from "./queries";
import { mergeItemIcons } from "./persist";
import { mockBnet } from "../test/mocks";

const mockFetch = vi.mocked(fetchItemMedia);

/** Ids the fetcher was actually called with. */
function fetchedIds(): number[] {
  return mockFetch.mock.calls.map((c) => c[1] as number);
}

describe("useItemIcons", () => {
  beforeEach(() => {
    localStorage.clear();
    mockFetch.mockClear();
    mockFetch.mockImplementation(async (_bnet: unknown, id: number) => `http://img/${id}.jpg`);
  });

  it("resolves only the given ids and persists them", async () => {
    const { bnet } = mockBnet();
    const { result } = renderHook(() => useItemIcons(bnet, [100, 200]));

    await waitFor(() => {
      expect(result.current[100]).toBe("http://img/100.jpg");
      expect(result.current[200]).toBe("http://img/200.jpg");
    });
    expect(fetchedIds().sort((a, b) => a - b)).toEqual([100, 200]);
    // Written through to the persistent cache.
    expect(localStorage.getItem("wow-companion:item-icons")).toContain("http://img/100.jpg");
  });

  it("seeds from the persisted cache without re-fetching known ids", async () => {
    mergeItemIcons({ 100: "http://img/cached.jpg" });
    const { bnet } = mockBnet();
    const { result } = renderHook(() => useItemIcons(bnet, [100, 200]));

    // Cached id available synchronously; only the uncached id is fetched.
    expect(result.current[100]).toBe("http://img/cached.jpg");
    await waitFor(() => expect(result.current[200]).toBe("http://img/200.jpg"));
    expect(fetchedIds()).toEqual([200]);
  });

  it("dedupes in-flight: each id is fetched at most once across viewport shifts", async () => {
    // Hold every fetch open so the first batch is still in flight when the viewport grows.
    const resolvers: Array<() => void> = [];
    mockFetch.mockImplementation(
      (_bnet: unknown, id: number) =>
        new Promise((resolve) => resolvers.push(() => resolve(`http://img/${id}.jpg`))),
    );

    const { bnet } = mockBnet();
    const { rerender } = renderHook(({ ids }: { ids: number[] }) => useItemIcons(bnet, ids), {
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
    renderHook(() => useItemIcons(bnet, []));
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("does not retry an id whose resolve failed within the session", async () => {
    mockFetch.mockResolvedValue(null); // simulate a 404/best-effort miss
    const { bnet } = mockBnet();
    const { rerender } = renderHook(({ ids }: { ids: number[] }) => useItemIcons(bnet, ids), {
      initialProps: { ids: [999] },
    });
    await waitFor(() => expect(mockFetch).toHaveBeenCalledTimes(1));
    rerender({ ids: [999] });
    rerender({ ids: [999] });
    // Still one call — the miss is recorded, not retried.
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });
});
