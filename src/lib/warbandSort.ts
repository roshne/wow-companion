// Pure sort + filter over the warband gear board's rows (#118). Kept UI-free and unit-tested so the
// board (`WarbandGearBoard`) just wires controls to these. Rows whose gear hasn't resolved (or failed)
// have no live item level / issue count, so they sort **last** regardless of direction — a metric a
// character doesn't have shouldn't jump them to the top of a descending sort.

import type { WarbandRow } from "./useWarbandGear";

/** What to order the board by. */
export type WarbandSortKey = "name" | "itemLevel" | "issues" | "class";

/** A sort selection: the key and direction (1 ascending, -1 descending). */
export interface WarbandSort {
  key: WarbandSortKey;
  dir: 1 | -1;
}

/** Class/role filters; a `null`/absent dimension means "don't filter on it". */
export interface WarbandFilter {
  classKey?: string | null;
  role?: string | null;
}

/** The average of a row's live equipped item levels, or null when it has none loaded. */
function averageItemLevel(row: WarbandRow): number | null {
  if (!row.gear || row.gear.failed) return null;
  const values = Object.values(row.gear.itemLevels);
  if (values.length === 0) return null;
  return values.reduce((sum, v) => sum + v, 0) / values.length;
}

/** The sort metric for a row under a given key — `null` when the row has no value for it. */
function metric(row: WarbandRow, key: WarbandSortKey): number | string | null {
  const { character, gear } = row;
  switch (key) {
    case "name":
      return character.name;
    case "class":
      return character.className ?? character.classKey;
    case "issues":
      return gear && !gear.failed ? gear.findings.length : null;
    case "itemLevel":
      // Prefer the live equipped average; fall back to the roster's reported item level (available even
      // before this row's fetch resolves), so a still-loading row can still be ordered sensibly.
      return averageItemLevel(row) ?? character.itemLevel;
  }
}

/**
 * Sort a copy of `rows` by the given key/direction. Rows with no value for the key sort last (in either
 * direction); ties (and null-vs-null) break by character name ascending, for a stable, predictable order.
 */
export function sortWarbandRows(rows: WarbandRow[], sort: WarbandSort): WarbandRow[] {
  return [...rows].sort((a, b) => {
    const va = metric(a, sort.key);
    const vb = metric(b, sort.key);
    const aNull = va === null;
    const bNull = vb === null;
    if (aNull && bNull) return a.character.name.localeCompare(b.character.name);
    if (aNull) return 1; // nulls last, regardless of direction
    if (bNull) return -1;

    const base =
      typeof va === "string" && typeof vb === "string"
        ? va.localeCompare(vb)
        : (va as number) - (vb as number);
    if (base !== 0) return base * sort.dir;
    return a.character.name.localeCompare(b.character.name);
  });
}

/** Keep only rows matching every provided filter dimension (a null/absent dimension matches all). */
export function filterWarbandRows(rows: WarbandRow[], filter: WarbandFilter): WarbandRow[] {
  return rows.filter((row) => {
    if (filter.classKey && row.character.classKey !== filter.classKey) return false;
    if (filter.role && row.character.role !== filter.role) return false;
    return true;
  });
}
