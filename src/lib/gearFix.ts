// Gear-fix prioritization — turns the flat gearCheck findings into an ordered, actionable "fix these
// first" list. Pure and UI-free: it only *orders and phrases* the findings the engine already
// produces (no new heuristics). Consumed by the character-sheet "fix these" panel (M1.2) and, later,
// the warband roll-up (M3). Ordering: actionable warnings (missing enchant / empty socket / missing
// off-hand) rank above informational item-level outliers; within a tier, higher-impact slots first
// (weapons > trinkets > the rest, then higher item level), so the biggest wins float to the top.

import type { GearFinding } from "./gearCheck";
import type { CharacterEquipment } from "./queries";

/** A prioritized gear-check finding, paired with a short human recommendation. */
export interface GearFix {
  /** The `slot.type` this fix concerns (mirrors `finding.slot`). */
  slot: string;
  /** The original gear-check finding, unchanged. */
  finding: GearFinding;
  /** A short, human recommendation, e.g. "Enchant your cloak". */
  recommendation: string;
}

/**
 * Natural item nouns per slot, for the recommendation phrasing ("Enchant your cloak"). Slots absent
 * here fall back to the lowercased `slot.type`.
 */
const SLOT_NOUNS: Record<string, string> = {
  HEAD: "helm",
  NECK: "necklace",
  SHOULDER: "shoulders",
  BACK: "cloak",
  CHEST: "chest",
  WRIST: "bracers",
  HANDS: "gloves",
  WAIST: "belt",
  LEGS: "legs",
  FEET: "boots",
  FINGER_1: "ring",
  FINGER_2: "ring",
  TRINKET_1: "trinket",
  TRINKET_2: "trinket",
  MAIN_HAND: "weapon",
  OFF_HAND: "off-hand",
};

/**
 * Slot-category weight for within-tier ordering: weapons outrank trinkets, which outrank every other
 * slot. Combined with the slot's item level (see {@link slotImpact}) so higher-item-level slots sort
 * first within the same category. Slots absent here weigh 0.
 */
const SLOT_CATEGORY_WEIGHT: Record<string, number> = {
  MAIN_HAND: 2,
  OFF_HAND: 2,
  TRINKET_1: 1,
  TRINKET_2: 1,
};

/** Category weight dominates item level: one category step outranks the largest plausible ilvl gap. */
const CATEGORY_STEP = 10_000;

/** Actionable warnings sort ahead of informational notes; lower tier = higher priority. */
function tier(finding: GearFinding): number {
  return finding.severity === "warning" ? 0 : 1;
}

/** A slot's within-tier impact: category weight first, then its item level as the tiebreak. */
function slotImpact(slot: string, itemLevels: Map<string, number>): number {
  return (SLOT_CATEGORY_WEIGHT[slot] ?? 0) * CATEGORY_STEP + (itemLevels.get(slot) ?? 0);
}

/** A short, human recommendation for a finding, phrased by kind over the slot's natural noun. */
function recommend(finding: GearFinding): string {
  const noun = SLOT_NOUNS[finding.slot] ?? finding.slot.toLowerCase();
  switch (finding.kind) {
    case "missing-enchant":
      return `Enchant your ${noun}`;
    case "empty-socket":
      return `Socket your ${noun}`;
    case "missing-off-hand":
      return "Equip an off-hand";
    case "ilvl-outlier":
      return `Upgrade your ${noun}`;
  }
}

/**
 * Order a character's gear-check findings by impact, pairing each with a recommendation. Actionable
 * warnings (missing enchant / empty socket / missing off-hand) rank above informational item-level
 * outliers; within a tier, higher-impact slots first (weapons > trinkets > the rest, then higher item
 * level). The sort is stable, so equal-impact findings keep their input (head-to-toe) order. Returns
 * `[]` for a clean character.
 *
 * @param findings   the flat findings from `gearCheck`
 * @param itemLevels per-slot item levels (`slot.type` → item level); see {@link slotItemLevels}
 */
export function prioritizeGearFixes(
  findings: GearFinding[],
  itemLevels: Map<string, number>,
): GearFix[] {
  return findings
    .map((finding) => ({ slot: finding.slot, finding, recommendation: recommend(finding) }))
    .sort((a, b) => {
      const byTier = tier(a.finding) - tier(b.finding);
      if (byTier !== 0) return byTier;
      return slotImpact(b.slot, itemLevels) - slotImpact(a.slot, itemLevels);
    });
}

/**
 * Build the per-slot item-level map ({@link prioritizeGearFixes}'s second argument) from an equipment
 * doc. Slots with no reported item level are skipped.
 */
export function slotItemLevels(equipment: CharacterEquipment): Map<string, number> {
  const levels = new Map<string, number>();
  for (const item of equipment.equipped_items ?? []) {
    const slot = item.slot?.type;
    const value = item.level?.value;
    if (slot && typeof value === "number") levels.set(slot, value);
  }
  return levels;
}
