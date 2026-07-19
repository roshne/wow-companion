import { describe, it, expect } from "vitest";
import type { CharacterEquipment } from "./queries";
import { gearCheck, groupBySlot, ILVL_OUTLIER_THRESHOLD } from "./gearCheck";

type EquippedItem = NonNullable<CharacterEquipment["equipped_items"]>[number];

/** Wrap a list of equipped items in an equipment doc (the only field gearCheck reads). */
const equip = (items: EquippedItem[]): CharacterEquipment =>
  ({ equipped_items: items }) as CharacterEquipment;

/** A filled item at a slot, item level 480 by default; override any field per test. */
const item = (slot: string, overrides: Partial<EquippedItem> = {}): EquippedItem => ({
  slot: { type: slot },
  name: `${slot} item`,
  level: { value: 480 },
  ...overrides,
});

describe("gearCheck — empty sockets", () => {
  it("flags one finding per empty socket, and none when every socket is filled", () => {
    const twoEmpty = item("HANDS", {
      sockets: [{}, { item: { name: "Quick Sapphire" } }, {}],
    });
    const empties = gearCheck(equip([twoEmpty])).filter((f) => f.kind === "empty-socket");
    expect(empties).toHaveLength(2);
    expect(empties[0].slot).toBe("HANDS");

    const filled = item("HANDS", { sockets: [{ item: { name: "Quick Sapphire" } }] });
    expect(gearCheck(equip([filled])).some((f) => f.kind === "empty-socket")).toBe(false);
  });
});

describe("gearCheck — missing enchant", () => {
  it("flags an enchantable slot with no enchant, but not a non-enchantable one", () => {
    const findings = gearCheck(equip([item("WRIST"), item("HEAD")]));
    const missing = findings.filter((f) => f.kind === "missing-enchant");
    expect(missing).toHaveLength(1);
    expect(missing[0].slot).toBe("WRIST");
  });

  it("does not flag an enchantable slot that already carries an enchant", () => {
    const wrist = item("WRIST", { enchantments: [{ display_string: "Enchanted: +Haste" }] });
    expect(gearCheck(equip([wrist])).some((f) => f.kind === "missing-enchant")).toBe(false);
  });

  it("treats a weapon off-hand as enchantable but a shield off-hand as not", () => {
    const weaponOff = item("OFF_HAND", { inventory_type: { type: "WEAPON" } });
    expect(gearCheck(equip([weaponOff])).some((f) => f.kind === "missing-enchant")).toBe(true);

    const shieldOff = item("OFF_HAND", { inventory_type: { type: "SHIELD" } });
    expect(gearCheck(equip([shieldOff])).some((f) => f.kind === "missing-enchant")).toBe(false);
  });
});

describe("gearCheck — missing off-hand", () => {
  it("flags a missing off-hand only when the main-hand is one-handed", () => {
    const oneHand = item("MAIN_HAND", { inventory_type: { type: "WEAPON" } });
    expect(gearCheck(equip([oneHand])).some((f) => f.kind === "missing-off-hand")).toBe(true);

    const twoHand = item("MAIN_HAND", { inventory_type: { type: "TWOHWEAPON" } });
    expect(gearCheck(equip([twoHand])).some((f) => f.kind === "missing-off-hand")).toBe(false);

    const withOffHand = [
      item("MAIN_HAND", { inventory_type: { type: "WEAPON" } }),
      item("OFF_HAND", { inventory_type: { type: "WEAPON" } }),
    ];
    expect(gearCheck(equip(withOffHand)).some((f) => f.kind === "missing-off-hand")).toBe(false);
  });
});

describe("gearCheck — item-level outliers", () => {
  it("flags a slot far below the equipped average, and nothing for an even set", () => {
    const uneven = [
      item("HEAD", { level: { value: 480 } }),
      item("CHEST", { level: { value: 480 } }),
      item("LEGS", { level: { value: 450 } }), // average 470 → 20 below
    ];
    const outliers = gearCheck(equip(uneven)).filter((f) => f.kind === "ilvl-outlier");
    expect(outliers).toHaveLength(1);
    expect(outliers[0].slot).toBe("LEGS");

    const even = [
      item("HEAD", { level: { value: 480 } }),
      item("CHEST", { level: { value: 480 } }),
    ];
    expect(gearCheck(equip(even)).some((f) => f.kind === "ilvl-outlier")).toBe(false);
  });

  it("does not flag a slot exactly at the threshold (strictly greater than)", () => {
    const items = [
      item("HEAD", { level: { value: 480 + ILVL_OUTLIER_THRESHOLD } }),
      item("CHEST", { level: { value: 480 - ILVL_OUTLIER_THRESHOLD } }), // exactly the threshold below avg
    ];
    expect(gearCheck(equip(items)).some((f) => f.kind === "ilvl-outlier")).toBe(false);
  });

  it("excludes SHIRT and TABARD from the average and never flags them", () => {
    const items = [
      item("HEAD", { level: { value: 480 } }),
      item("CHEST", { level: { value: 480 } }),
      item("SHIRT", { level: { value: 1 } }),
      item("TABARD", { level: { value: 1 } }),
    ];
    expect(gearCheck(equip(items)).some((f) => f.kind === "ilvl-outlier")).toBe(false);
  });
});

describe("gearCheck — clean set + grouping", () => {
  it("returns no findings for a fully-optimized set", () => {
    const clean = [
      item("HEAD", { level: { value: 480 } }),
      item("WRIST", { level: { value: 480 }, enchantments: [{ display_string: "e" }] }),
      item("MAIN_HAND", {
        level: { value: 480 },
        inventory_type: { type: "TWOHWEAPON" },
        enchantments: [{ display_string: "e" }],
      }),
      item("FINGER_1", {
        level: { value: 480 },
        enchantments: [{ display_string: "e" }],
        sockets: [{ item: { name: "Quick Sapphire" } }],
      }),
    ];
    expect(gearCheck(equip(clean))).toEqual([]);
  });

  it("groups findings by slot.type", () => {
    // FINGER_1: two empty sockets + a missing enchant → three findings, all on the one slot.
    const finger = item("FINGER_1", { sockets: [{}, {}] });
    const grouped = groupBySlot(gearCheck(equip([finger])));
    expect(grouped.get("FINGER_1")).toHaveLength(3);
  });
});
