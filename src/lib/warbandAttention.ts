// Warband-wide "needs attention" roll-up (#119): aggregate the M1 gear-fix engine across every alt so
// the whole warband's gear state reads at a glance. Pure and UI-free — the summary component just
// renders what this returns. Runs `prioritizeGearFixes` (#103) over each resolved character's findings
// + item levels, skipping rows whose gear hasn't loaded or failed (no data to count).

import type { GearFindingKind } from "./gearCheck";
import { prioritizeGearFixes } from "./gearFix";
import type { WarbandRow } from "./useWarbandGear";

/** A fix kind and how many of it there are across the warband. */
export interface KindCount {
  kind: GearFindingKind;
  count: number;
}

/** The warband's aggregate gear-fix state. */
export interface WarbandAttention {
  /** Total prioritized gear fixes across the resolved characters. */
  totalFixes: number;
  /** How many resolved characters have at least one fix. */
  charactersNeedingAttention: number;
  /** How many characters have resolved (loaded, non-failed) — the denominator behind the totals. */
  resolvedCount: number;
  /** Fix counts by kind, most common first. */
  byKind: KindCount[];
}

/**
 * Roll up the warband's gear fixes. For each character whose gear has resolved (loaded and not failed),
 * run {@link prioritizeGearFixes} — converting the row's `itemLevels` `Record` to the `Map` the engine
 * takes — and tally the totals, the count of characters with any fix, and the fixes by kind. Rows still
 * loading or failed are skipped. `totalFixes === 0` with `resolvedCount > 0` means the warband is clean.
 */
export function rollUpAttention(rows: WarbandRow[]): WarbandAttention {
  let totalFixes = 0;
  let charactersNeedingAttention = 0;
  let resolvedCount = 0;
  const kindCounts = new Map<GearFindingKind, number>();

  for (const { gear } of rows) {
    if (!gear || gear.failed) continue;
    resolvedCount += 1;
    const fixes = prioritizeGearFixes(gear.findings, new Map(Object.entries(gear.itemLevels)));
    if (fixes.length > 0) charactersNeedingAttention += 1;
    totalFixes += fixes.length;
    for (const fix of fixes) {
      kindCounts.set(fix.finding.kind, (kindCounts.get(fix.finding.kind) ?? 0) + 1);
    }
  }

  const byKind = [...kindCounts.entries()]
    .map(([kind, count]) => ({ kind, count }))
    .sort((a, b) => b.count - a.count);

  return { totalFixes, charactersNeedingAttention, resolvedCount, byKind };
}
