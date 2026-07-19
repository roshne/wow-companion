import { describe, it, expect, vi } from "vitest";
import type { QueryClient } from "@tanstack/react-query";
import type { Region } from "../vendor/battlenet-wow-client";

// `fetchRegionRealmIndexes` builds a per-region client via `makeClient`; stub it so no Tauri backend
// is needed (the real network call is short-circuited by the fake QueryClient's `fetchQuery`).
vi.mock("./bnet", () => ({ makeClient: (region: Region) => ({ region }) }));

import { resolveCharacterRegion, fetchRegionRealmIndexes, type RegionRealmIndexes } from "./region";

// Fixtures: "Ravencrest" collides US+EU; "Blackrock (Legacy)" collides US+EU+KR and has a slug that
// differs from the naive derivation; "Tichondrius"/"Aggra (Português)" are each unique to one region.
const US = [
  { name: "Tichondrius", slug: "tichondrius" },
  { name: "Ravencrest", slug: "ravencrest" },
  { name: "Blackrock (Legacy)", slug: "blackrock-legacy" },
];
const EU = [
  { name: "Aggra (Português)", slug: "aggra-portugues" },
  { name: "Ravencrest", slug: "ravencrest" },
  { name: "Blackrock (Legacy)", slug: "blackrock-legacy" },
];
const KR = [
  { name: "Azshara", slug: "azshara" },
  { name: "Blackrock (Legacy)", slug: "blackrock-legacy" },
];
const TW = [{ name: "Zul'jin", slug: "zuljin" }];
const INDEXES: RegionRealmIndexes = { us: US, eu: EU, kr: KR, tw: TW };

describe("resolveCharacterRegion", () => {
  it("resolves a realm unique to one region to that region (with the index's true slug)", () => {
    expect(resolveCharacterRegion("Tichondrius", INDEXES, "eu")).toEqual({
      region: "us",
      realmSlug: "tichondrius",
    });
    // The unique match uses the index slug, not the naive derivation ("aggra-(português)").
    expect(resolveCharacterRegion("Aggra (Português)", INDEXES, "us")).toEqual({
      region: "eu",
      realmSlug: "aggra-portugues",
    });
  });

  it("matches an already-slugged realm value, not just the display name", () => {
    expect(resolveCharacterRegion("tichondrius", INDEXES, "eu")).toEqual({
      region: "us",
      realmSlug: "tichondrius",
    });
  });

  it("falls back to the current region when a realm name collides across regions", () => {
    // "Ravencrest" is in both US and EU — ambiguous, so it opens in the selected region (KR here),
    // with the slug derived against KR's index (which doesn't list it).
    expect(resolveCharacterRegion("Ravencrest", INDEXES, "kr")).toEqual({
      region: "kr",
      realmSlug: "ravencrest",
    });
  });

  it("uses the fallback region's true slug when that region lists the colliding realm", () => {
    // "Blackrock (Legacy)" collides across US/EU/KR; falling back to KR resolves its real slug
    // ("blackrock-legacy") rather than the derived "blackrock-(legacy)".
    expect(resolveCharacterRegion("Blackrock (Legacy)", INDEXES, "kr")).toEqual({
      region: "kr",
      realmSlug: "blackrock-legacy",
    });
  });

  it("falls back to the current region (with a derived slug) when no region lists the realm", () => {
    expect(resolveCharacterRegion("Nonexistent Realm", INDEXES, "us")).toEqual({
      region: "us",
      realmSlug: "nonexistent-realm",
    });
  });

  it("falls back with a derived slug when no indexes are available at all", () => {
    expect(resolveCharacterRegion("Tichondrius", {}, "us")).toEqual({
      region: "us",
      realmSlug: "tichondrius",
    });
  });
});

describe("fetchRegionRealmIndexes", () => {
  it("returns the indexes that load and omits any region whose fetch fails", async () => {
    const byRegion: Record<string, { name: string; slug: string }[]> = {
      us: US,
      eu: EU,
      kr: KR,
      tw: TW,
    };
    const fakeClient = {
      fetchQuery: vi.fn(async (opts: { queryKey: readonly unknown[] }) => {
        const region = opts.queryKey[1] as Region;
        if (region === "kr") throw new Error("index failed");
        return byRegion[region];
      }),
    } as unknown as QueryClient;

    const indexes = await fetchRegionRealmIndexes(fakeClient);

    expect(Object.keys(indexes).sort()).toEqual(["eu", "tw", "us"].sort());
    expect(indexes.kr).toBeUndefined();
    expect(indexes.us).toBe(US);
    expect(indexes.eu).toBe(EU);
  });
});
