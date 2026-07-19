// Gear-check heuristics over the already-fetched equipment doc — the M4 foundation. Pure and
// UI-free: it derives a flat list of per-slot findings (empty gem sockets, missing enchants, a
// missing off-hand, item-level outliers) that the doll badges and the item popover then surface. No
// new API call — everything comes from the `equipped_items` entry. All thresholds and the enchantable
// allow-list live here as named constants, so tuning as retail changes is a one-file edit.

import type { CharacterEquipment } from "./queries";

/** One entry of the equipment doc's `equipped_items`. */
type EquippedItem = NonNullable<CharacterEquipment["equipped_items"]>[number];

/** The kind of gear-check finding; the machine key consumers switch/style on. */
export type GearFindingKind =
  "empty-socket" | "missing-enchant" | "missing-off-hand" | "ilvl-outlier";

/** How much a finding matters — a "should really fix" warning vs. a softer informational note. */
export type GearFindingSeverity = "warning" | "info";

/** A single gear-check finding, attributed to the `slot.type` it concerns. */
export interface GearFinding {
  /** The `slot.type` this finding belongs to (e.g. "HEAD", "OFF_HAND"). */
  slot: string;
  kind: GearFindingKind;
  /** A short human-readable description, e.g. "Missing enchant". */
  label: string;
  severity: GearFindingSeverity;
}

/**
 * Slots that should carry an enchant in current retail. `OFF_HAND` is intentionally *not* here — it's
 * enchantable only when it holds a weapon (a shield / holdable is not), decided per-item below.
 */
const ENCHANTABLE_SLOTS = new Set([
  "BACK",
  "CHEST",
  "WRIST",
  "LEGS",
  "FEET",
  "FINGER_1",
  "FINGER_2",
  "MAIN_HAND",
]);

/** Inventory types that count as a weapon in the off-hand (so it's enchantable, unlike a shield/frill). */
const WEAPON_INVENTORY_TYPES = new Set([
  "WEAPON",
  "WEAPONMAINHAND",
  "WEAPONOFFHAND",
  "TWOHWEAPON",
  "RANGED",
  "RANGEDRIGHT",
]);

/** A main-hand of these fills both hands, so no off-hand is expected. */
const TWO_HANDED_INVENTORY_TYPES = new Set(["TWOHWEAPON", "RANGED", "RANGEDRIGHT"]);

/** Cosmetic slots excluded from the item-level average (they carry no meaningful ilvl). */
const ILVL_EXCLUDED_SLOTS = new Set(["SHIRT", "TABARD"]);

/** How many item levels below the equipped average marks a slot as an outlier. */
export const ILVL_OUTLIER_THRESHOLD = 10;

/** Whether a slot should be enchanted: the static allow-list, plus a weapon (not shield) off-hand. */
function isEnchantable(slot: string, item: EquippedItem): boolean {
  if (ENCHANTABLE_SLOTS.has(slot)) return true;
  if (slot === "OFF_HAND") return WEAPON_INVENTORY_TYPES.has(item.inventory_type?.type ?? "");
  return false;
}

function finding(
  slot: string,
  kind: GearFindingKind,
  label: string,
  severity: GearFindingSeverity,
): GearFinding {
  return { slot, kind, label, severity };
}

/**
 * Run every gear-check heuristic over the equipment doc, returning a flat list of findings (each
 * carrying its `slot`). Group with {@link groupBySlot} for per-slot rendering, or take `.length` for
 * an at-a-glance count. Returns an empty array for a fully-optimized set.
 */
export function gearCheck(equipment: CharacterEquipment): GearFinding[] {
  const items = equipment.equipped_items ?? [];
  const findings: GearFinding[] = [];

  const bySlot = new Map<string, EquippedItem>();
  for (const item of items) {
    const slot = item.slot?.type;
    if (slot) bySlot.set(slot, item);
  }

  // Empty gem sockets — one finding per empty socket.
  for (const item of items) {
    const slot = item.slot?.type;
    if (!slot) continue;
    for (const socket of item.sockets ?? []) {
      if (!socket.item?.name) {
        findings.push(finding(slot, "empty-socket", "Empty gem socket", "warning"));
      }
    }
  }

  // Missing enchant on an enchantable slot.
  for (const item of items) {
    const slot = item.slot?.type;
    if (!slot || !isEnchantable(slot, item)) continue;
    if ((item.enchantments ?? []).length === 0) {
      findings.push(finding(slot, "missing-enchant", "Missing enchant", "warning"));
    }
  }

  // Missing off-hand while wielding a one-hander.
  const mainHand = bySlot.get("MAIN_HAND");
  if (
    mainHand &&
    !bySlot.has("OFF_HAND") &&
    !TWO_HANDED_INVENTORY_TYPES.has(mainHand.inventory_type?.type ?? "")
  ) {
    findings.push(finding("OFF_HAND", "missing-off-hand", "Missing off-hand", "warning"));
  }

  // Item-level outliers vs. the equipped average (over real gear, excluding cosmetic slots).
  const rated: { slot: string; value: number }[] = [];
  for (const item of items) {
    const slot = item.slot?.type;
    const value = item.level?.value;
    if (slot && typeof value === "number" && !ILVL_EXCLUDED_SLOTS.has(slot)) {
      rated.push({ slot, value });
    }
  }
  if (rated.length >= 2) {
    const average = rated.reduce((sum, r) => sum + r.value, 0) / rated.length;
    for (const r of rated) {
      if (average - r.value > ILVL_OUTLIER_THRESHOLD) {
        findings.push(
          finding(r.slot, "ilvl-outlier", `Item level ${r.value} (below average)`, "info"),
        );
      }
    }
  }

  return findings;
}

/** Group a findings list by `slot.type`, for per-slot rendering (badges, popover). */
export function groupBySlot(findings: GearFinding[]): Map<string, GearFinding[]> {
  const bySlot = new Map<string, GearFinding[]>();
  for (const f of findings) {
    const list = bySlot.get(f.slot);
    if (list) list.push(f);
    else bySlot.set(f.slot, [f]);
  }
  return bySlot;
}
