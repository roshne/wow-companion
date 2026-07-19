import { describe, it, expect } from "vitest";
import type { GearFinding, GearFindingKind } from "./gearCheck";
import type { CharacterEquipment } from "./queries";
import { prioritizeGearFixes, slotItemLevels } from "./gearFix";

type EquippedItem = NonNullable<CharacterEquipment["equipped_items"]>[number];

/** A finding at a slot; severity mirrors gearCheck (only the ilvl outlier is informational). */
const finding = (slot: string, kind: GearFindingKind): GearFinding => ({
  slot,
  kind,
  label: `${kind} @ ${slot}`,
  severity: kind === "ilvl-outlier" ? "info" : "warning",
});

/** Wrap a list of equipped items in an equipment doc (the only field slotItemLevels reads). */
const equip = (items: EquippedItem[]): CharacterEquipment =>
  ({ equipped_items: items }) as CharacterEquipment;

/** A filled item at a slot, item level 480 by default; override any field per test. */
const item = (slot: string, overrides: Partial<EquippedItem> = {}): EquippedItem => ({
  slot: { type: slot },
  name: `${slot} item`,
  level: { value: 480 },
  ...overrides,
});

describe("prioritizeGearFixes — tiering", () => {
  it("ranks every actionable warning above every informational ilvl outlier", () => {
    const findings = [
      finding("HEAD", "ilvl-outlier"),
      finding("WRIST", "missing-enchant"),
      finding("CHEST", "ilvl-outlier"),
      finding("HANDS", "empty-socket"),
    ];
    const kinds = prioritizeGearFixes(findings, new Map()).map((x) => x.finding.kind);
    // The two warnings come first (in some order), the two outliers last.
    expect(kinds.slice(0, 2).every((k) => k !== "ilvl-outlier")).toBe(true);
    expect(kinds.slice(2)).toEqual(["ilvl-outlier", "ilvl-outlier"]);
  });
});

describe("prioritizeGearFixes — within-tier slot impact", () => {
  it("orders weapons above trinkets above other slots within a tier", () => {
    const findings = [
      finding("WRIST", "empty-socket"),
      finding("MAIN_HAND", "empty-socket"),
      finding("TRINKET_1", "empty-socket"),
    ];
    const slots = prioritizeGearFixes(findings, new Map()).map((x) => x.slot);
    expect(slots).toEqual(["MAIN_HAND", "TRINKET_1", "WRIST"]);
  });

  it("breaks ties within a category by item level (higher first), consuming itemLevels", () => {
    const findings = [
      finding("FINGER_1", "missing-enchant"),
      finding("FINGER_2", "missing-enchant"),
    ];
    const itemLevels = new Map([
      ["FINGER_1", 470],
      ["FINGER_2", 500],
    ]);
    const slots = prioritizeGearFixes(findings, itemLevels).map((x) => x.slot);
    expect(slots).toEqual(["FINGER_2", "FINGER_1"]);
  });

  it("weights slot category above item level (a low-ilvl weapon still beats a high-ilvl ring)", () => {
    const findings = [finding("FINGER_1", "empty-socket"), finding("MAIN_HAND", "empty-socket")];
    const itemLevels = new Map([
      ["FINGER_1", 600],
      ["MAIN_HAND", 450],
    ]);
    const slots = prioritizeGearFixes(findings, itemLevels).map((x) => x.slot);
    expect(slots).toEqual(["MAIN_HAND", "FINGER_1"]);
  });

  it("preserves input order for equal-impact findings (stable sort)", () => {
    // All non-category slots with no item levels → equal impact → input (head-to-toe) order kept.
    const findings = [
      finding("HANDS", "empty-socket"),
      finding("WAIST", "empty-socket"),
      finding("HEAD", "empty-socket"),
    ];
    const slots = prioritizeGearFixes(findings, new Map()).map((x) => x.slot);
    expect(slots).toEqual(["HANDS", "WAIST", "HEAD"]);
  });
});

describe("prioritizeGearFixes — recommendations", () => {
  it("phrases a sensible recommendation per finding kind", () => {
    const rec = (slot: string, kind: GearFindingKind) =>
      prioritizeGearFixes([finding(slot, kind)], new Map())[0].recommendation;
    expect(rec("BACK", "missing-enchant")).toBe("Enchant your cloak");
    expect(rec("FINGER_1", "empty-socket")).toBe("Socket your ring");
    expect(rec("OFF_HAND", "missing-off-hand")).toBe("Equip an off-hand");
    expect(rec("HEAD", "ilvl-outlier")).toBe("Upgrade your helm");
  });

  it("falls back to the lowercased slot for an unmapped slot", () => {
    const [fix] = prioritizeGearFixes([finding("SOMETHING_NEW", "missing-enchant")], new Map());
    expect(fix.recommendation).toBe("Enchant your something_new");
  });

  it("carries the original finding and its slot on each entry", () => {
    const src = finding("BACK", "missing-enchant");
    const [fix] = prioritizeGearFixes([src], new Map());
    expect(fix.finding).toBe(src);
    expect(fix.slot).toBe("BACK");
  });
});

describe("prioritizeGearFixes — clean character", () => {
  it("returns an empty list when there are no findings", () => {
    expect(prioritizeGearFixes([], new Map())).toEqual([]);
  });

  it("does not mutate the input findings array", () => {
    const findings = [finding("HEAD", "ilvl-outlier"), finding("MAIN_HAND", "empty-socket")];
    const snapshot = [...findings];
    prioritizeGearFixes(findings, new Map());
    expect(findings).toEqual(snapshot);
  });
});

describe("slotItemLevels", () => {
  it("maps slot.type to item level, skipping slots with no level", () => {
    const levels = slotItemLevels(
      equip([
        item("HEAD", { level: { value: 480 } }),
        item("MAIN_HAND", { level: { value: 500 } }),
        item("SHIRT", { level: undefined }),
      ]),
    );
    expect(levels.get("HEAD")).toBe(480);
    expect(levels.get("MAIN_HAND")).toBe(500);
    expect(levels.has("SHIRT")).toBe(false);
    expect(levels.size).toBe(2);
  });

  it("returns an empty map for an equipment doc with no items", () => {
    expect(slotItemLevels({} as CharacterEquipment).size).toBe(0);
  });

  it("composes with prioritizeGearFixes to break ties by item level", () => {
    const levels = slotItemLevels(
      equip([
        item("TRINKET_1", { level: { value: 470 } }),
        item("TRINKET_2", { level: { value: 500 } }),
      ]),
    );
    const findings = [finding("TRINKET_1", "empty-socket"), finding("TRINKET_2", "empty-socket")];
    const slots = prioritizeGearFixes(findings, levels).map((x) => x.slot);
    expect(slots).toEqual(["TRINKET_2", "TRINKET_1"]);
  });
});
