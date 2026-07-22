import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClientProvider } from "@tanstack/react-query";
import type { WarbandCharacter } from "./warband";
import { testQueryClient } from "../test/utils";

// The hook itself, rather than the pure derivations in `useWarbandGear.test.ts`: rendering it needs
// React + a QueryClient, which is the jsdom ("components") project — hence the separate `.tsx` file.
//
// Three collaborators are stubbed so it runs without a network or a Tauri backend: the per-region
// client factory (whose call count is itself under test), the shared realm-index fetch, and the
// per-character equipment query. Everything the hook *derives* (deriveGear / gearCheck) stays real.
vi.mock("./bnet", () => ({ makeClient: vi.fn((region: string) => ({ region })) }));

vi.mock("./region", async (importActual) => ({
  ...(await importActual<typeof import("./region")>()),
  fetchRegionRealmIndexes: vi.fn(async () => ({ us: [{ name: "Testrealm", slug: "testrealm" }] })),
}));

vi.mock("./queries", async (importActual) => ({
  ...(await importActual<typeof import("./queries")>()),
  characterEquipmentQuery: vi.fn((_client: unknown, realmSlug: string, name: string) => ({
    queryKey: ["character-equipment", realmSlug, name] as const,
    queryFn: async () => ({ equipped_items: [{ slot: { type: "HEAD" }, level: { value: 480 } }] }),
  })),
}));

// Spied, not stubbed: `gearCheck` is the expensive half of the per-character derivation, and counting
// its calls is how we see whether `select` is re-running.
vi.mock("./gearCheck", async (importActual) => {
  const actual = await importActual<typeof import("./gearCheck")>();
  return { ...actual, gearCheck: vi.fn(actual.gearCheck) };
});

import { useWarbandGear } from "./useWarbandGear";
import { makeClient } from "./bnet";
import { gearCheck } from "./gearCheck";

const mockMakeClient = vi.mocked(makeClient);
const mockGearCheck = vi.mocked(gearCheck);

const char = (name: string): WarbandCharacter => ({ name, realm: "Testrealm" }) as WarbandCharacter;

/** Render the hook against a fresh QueryClient. */
function renderWarbandGear(characters: WarbandCharacter[]) {
  const client = testQueryClient();
  return renderHook(() => useWarbandGear(characters, "us"), {
    wrapper: ({ children }) => (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    ),
  });
}

describe("useWarbandGear", () => {
  beforeEach(() => {
    mockMakeClient.mockClear();
    mockGearCheck.mockClear();
  });

  it("derives each character's gear once, not again on every render", async () => {
    // React Query re-runs a query's `select` whenever the function's identity changes, so an inline
    // query list re-derived every character on every render. Structural sharing hides the symptom —
    // the deep-equal result collapses back to the same reference — so the only visible trace is the
    // wasted work itself. Rows stream in one at a time, so the board really does re-render N times.
    const characters = [char("Alpha"), char("Beta")];
    const { result, rerender } = renderWarbandGear(characters);

    await waitFor(() => expect(result.current.rows.every((r) => r.gear !== null)).toBe(true));
    expect(result.current.rows[0].gear?.itemLevels).toEqual({ HEAD: 480 });

    const afterResolve = mockGearCheck.mock.calls.length;
    rerender();
    rerender();

    expect(mockGearCheck.mock.calls.length).toBe(afterResolve);
  });

  it("keeps each resolved row's gear object stable across re-renders", async () => {
    const { result, rerender } = renderWarbandGear([char("Alpha")]);

    await waitFor(() => expect(result.current.rows[0].gear).not.toBeNull());
    const derived = result.current.rows[0].gear;

    rerender();

    // What the board's memoized rows compare against.
    expect(result.current.rows[0].gear).toBe(derived);
  });

  it("builds one client per region, not one per character per render", async () => {
    const characters = [char("Alpha"), char("Beta")];
    const { result, rerender } = renderWarbandGear(characters);

    await waitFor(() => expect(result.current.rows.every((r) => r.gear !== null)).toBe(true));
    rerender();
    rerender();

    // Both characters resolve to `us`, so one client covers the whole board however often it renders.
    expect(mockMakeClient).toHaveBeenCalledTimes(1);
    expect(mockMakeClient).toHaveBeenCalledWith("us");
  });

  it("streams rows: a character's gear is null until its own fetch settles", () => {
    const { result } = renderWarbandGear([char("Alpha")]);
    // Synchronously after mount the realm indexes haven't resolved, so the row is still pending.
    expect(result.current.rows).toEqual([{ character: expect.anything(), gear: null }]);
  });
});
