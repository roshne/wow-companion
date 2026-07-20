import { describe, it, expect } from "vitest";
import type { WarbandCharacter } from "./warband";
import type { RegionRealmIndexes } from "./region";
import type { CharacterEquipment } from "./queries";
import {
  deriveItemLevels,
  weakestSlots,
  tierSetInfo,
  deriveGear,
  resolveWarbandTargets,
} from "./useWarbandGear";

const char = (name: string, realm: string): WarbandCharacter =>
  ({ name, realm }) as WarbandCharacter;

const equip = (items: unknown[]): CharacterEquipment =>
  ({ equipped_items: items }) as CharacterEquipment;

describe("deriveItemLevels", () => {
  it("maps each equipped slot to its item level and skips slots without one", () => {
    const levels = deriveItemLevels(
      equip([
        { slot: { type: "HEAD" }, level: { value: 480 } },
        { slot: { type: "SHIRT" } }, // no level → skipped
        { level: { value: 400 } }, // no slot → skipped
      ]),
    );
    expect(levels).toEqual({ HEAD: 480 });
  });
});

describe("deriveGear", () => {
  it("derives item levels, findings, and the tier set for a character (not failed)", () => {
    const equipment = equip([
      {
        slot: { type: "HEAD" },
        level: { value: 480 },
        set: { item_set: { id: 99, name: "Tier of Testing" } },
      },
      // FINGER_1 is enchantable + un-enchanted → a finding; same set as HEAD → a 2-piece tier set.
      {
        slot: { type: "FINGER_1" },
        level: { value: 470 },
        set: { item_set: { id: 99, name: "Tier of Testing" } },
      },
    ]);
    const gear = deriveGear(char("Tank", "Tichondrius"), "us", "tichondrius", equipment);

    expect(gear).toMatchObject({ region: "us", realmSlug: "tichondrius", failed: false });
    expect(gear.itemLevels).toEqual({ HEAD: 480, FINGER_1: 470 });
    expect(gear.findings.some((f) => f.kind === "missing-enchant")).toBe(true);
    expect(gear.tierSet).toEqual({ name: "Tier of Testing", pieces: 2 });
  });
});

describe("resolveWarbandTargets", () => {
  // "Tichondrius" is US-only; "Aggra (Português)" is EU-only (slug differs from the naive derivation).
  const indexes: RegionRealmIndexes = {
    us: [{ name: "Tichondrius", slug: "tichondrius" }],
    eu: [{ name: "Aggra (Português)", slug: "aggra-portugues" }],
  };

  it("resolves each character's region + true slug, falling back for unknown realms", () => {
    const targets = resolveWarbandTargets(
      [char("Tank", "Tichondrius"), char("Healer", "Aggra (Português)"), char("Lost", "Nowhere")],
      indexes,
      "us",
    );

    // Unique realms resolve to their region + the index's true slug.
    expect(targets[0]).toMatchObject({ region: "us", realmSlug: "tichondrius" });
    expect(targets[1]).toMatchObject({ region: "eu", realmSlug: "aggra-portugues" });
    // An unknown realm falls back to the current region, slug derived.
    expect(targets[2]).toMatchObject({ region: "us", realmSlug: "nowhere" });
    // Each target carries its originating character.
    expect(targets[0].character.name).toBe("Tank");
  });
});

describe("weakestSlots", () => {
  it("returns the slot(s) at the minimum when meaningfully below average", () => {
    // average 470 → LEGS (450) is 20 below → the weakest.
    expect(weakestSlots({ HEAD: 480, CHEST: 480, LEGS: 450 })).toEqual(["LEGS"]);
  });

  it("returns nothing for an even set or a single slot", () => {
    expect(weakestSlots({ HEAD: 480, CHEST: 478 })).toEqual([]); // spread within the threshold
    expect(weakestSlots({ HEAD: 480 })).toEqual([]);
    expect(weakestSlots({})).toEqual([]);
  });
});

describe("tierSetInfo", () => {
  it("counts pieces of the dominant equipped set, picking the largest when several", () => {
    const info = tierSetInfo(
      equip([
        { set: { item_set: { id: 1, name: "Tier" } } },
        { set: { item_set: { id: 1, name: "Tier" } } },
        { set: { item_set: { id: 1, name: "Tier" } } },
        { set: { item_set: { id: 2, name: "Crafted" } } }, // a smaller, competing set
        { level: { value: 480 } }, // no set → ignored
      ]),
    );
    expect(info).toEqual({ name: "Tier", pieces: 3 });
  });

  it("returns null when nothing equipped carries set data", () => {
    expect(tierSetInfo(equip([{ slot: { type: "HEAD" } }, {}]))).toBeNull();
  });
});
