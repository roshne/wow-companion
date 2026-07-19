import { describe, it, expect, vi } from "vitest";
import type { QueryClient } from "@tanstack/react-query";
import type { Region } from "../vendor/battlenet-wow-client";
import type { WarbandCharacter } from "./warband";

// `fetchWarbandGear` builds a per-region client via `makeClient`; stub it so no Tauri backend is
// needed (the real network call is short-circuited by the fake QueryClient's `fetchQuery`).
vi.mock("./bnet", () => ({ makeClient: (region: Region) => ({ region }) }));

import { fetchWarbandGear, deriveItemLevels } from "./useWarbandGear";

// Realm indexes: "Tichondrius" is US-only, "Aggra (Português)" is EU-only (slug differs from the
// naive derivation). KR/TW list nothing.
const INDEXES: Record<string, { name: string; slug: string }[]> = {
  us: [{ name: "Tichondrius", slug: "tichondrius" }],
  eu: [{ name: "Aggra (Português)", slug: "aggra-portugues" }],
  kr: [],
  tw: [],
};

/** Equipment docs by character name; "Broken" throws to exercise the best-effort path. */
function equipmentFor(name: string) {
  if (name === "Broken") throw new Error("equipment failed (HTTP 500)");
  if (name === "Tank")
    return {
      equipped_items: [
        { slot: { type: "HEAD" }, level: { value: 480 } },
        { slot: { type: "FINGER_1" }, level: { value: 470 } }, // enchantable + un-enchanted → a finding
      ],
    };
  if (name === "Healer")
    return { equipped_items: [{ slot: { type: "HEAD" }, level: { value: 470 } }] };
  return { equipped_items: [] };
}

/** A fake QueryClient that answers realm-index and character-equipment queries from the fixtures. */
function fakeClient() {
  const fetchQuery = vi.fn(async (opts: { queryKey: readonly unknown[] }) => {
    const [kind, region, , name] = opts.queryKey as [string, Region, string, string];
    if (kind === "realm-index") return INDEXES[region];
    if (kind === "character-equipment") return equipmentFor(name);
    throw new Error(`unexpected query ${String(kind)}`);
  });
  return { queryClient: { fetchQuery } as unknown as QueryClient, fetchQuery };
}

const char = (name: string, realm: string): WarbandCharacter =>
  ({ name, realm }) as WarbandCharacter;

describe("deriveItemLevels", () => {
  it("maps each equipped slot to its item level and skips slots without one", () => {
    const levels = deriveItemLevels({
      equipped_items: [
        { slot: { type: "HEAD" }, level: { value: 480 } },
        { slot: { type: "SHIRT" } }, // no level → skipped
        { level: { value: 400 } }, // no slot → skipped
      ],
    } as Parameters<typeof deriveItemLevels>[0]);
    expect(levels).toEqual({ HEAD: 480 });
  });
});

describe("fetchWarbandGear", () => {
  it("derives per-slot item levels and gear-check findings per character", async () => {
    const { queryClient } = fakeClient();
    const gear = await fetchWarbandGear(queryClient, [char("Tank", "Tichondrius")], "us");

    expect(gear).toHaveLength(1);
    expect(gear[0].itemLevels).toEqual({ HEAD: 480, FINGER_1: 470 });
    // FINGER_1 is enchantable and un-enchanted → a missing-enchant finding.
    expect(gear[0].findings.some((f) => f.kind === "missing-enchant")).toBe(true);
    expect(gear[0].failed).toBe(false);
  });

  it("resolves each character's region from its realm (falling back to the current region)", async () => {
    const { queryClient } = fakeClient();
    const gear = await fetchWarbandGear(
      queryClient,
      [char("Tank", "Tichondrius"), char("Healer", "Aggra (Português)"), char("Lost", "Nowhere")],
      "us",
    );

    // Unique realms resolve to their region + the index's true slug.
    expect(gear[0]).toMatchObject({ region: "us", realmSlug: "tichondrius" });
    expect(gear[1]).toMatchObject({ region: "eu", realmSlug: "aggra-portugues" });
    // An unknown realm falls back to the current region, slug derived.
    expect(gear[2]).toMatchObject({ region: "us", realmSlug: "nowhere" });
  });

  it("is best-effort — a failed fetch yields a failed row without sinking the rest", async () => {
    const { queryClient } = fakeClient();
    const gear = await fetchWarbandGear(
      queryClient,
      [char("Tank", "Tichondrius"), char("Broken", "Tichondrius")],
      "us",
    );

    expect(gear[0].failed).toBe(false);
    expect(gear[1]).toMatchObject({ failed: true, itemLevels: {}, findings: [] });
    expect(gear[1].character.name).toBe("Broken");
  });

  it("fetches each character's equipment under its own region+realm+name cache key", async () => {
    const { queryClient, fetchQuery } = fakeClient();
    await fetchWarbandGear(queryClient, [char("Tank", "Tichondrius")], "us");

    const keys = fetchQuery.mock.calls.map((c) => c[0].queryKey);
    expect(keys).toContainEqual(["character-equipment", "us", "tichondrius", "Tank"]);
  });
});
