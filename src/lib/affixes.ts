// The current Mythic+ affix rotation — a global weekly fact the Game Data API exposes nowhere
// directly. It has to be assembled from a connected-realm leaderboard (the one route that carries
// `keystone_affixes`), which first needs the current period resolved. The two pure transforms here
// are the testable core of that assembly; the network chaining lives in `queries.ts`.

import type { paths } from "../vendor/battlenet-wow-client";

/** Response body of the Mythic Keystone Periods Index (dynamic namespace). */
export type PeriodIndex =
  paths["/data/wow/mythic-keystone/period/index"]["get"]["responses"][200]["content"]["application/json"];

/** The `keystone_affixes` array off a connected-realm mythic leaderboard (dynamic namespace). */
export type LeaderboardAffixes =
  paths["/data/wow/connected-realm/{connectedRealmId}/mythic-leaderboard/{dungeonId}/period/{period}"]["get"]["responses"][200]["content"]["application/json"]["keystone_affixes"];

/** One affix in the week's rotation: its id, a display name, and the key level it starts applying at. */
export interface AffixEntry {
  id: number;
  /** Localized affix name, or `Affix {id}` when the leaderboard didn't carry one. */
  name: string;
  /** The keystone level at which this affix begins to apply, if known. */
  startingLevel: number | null;
}

/**
 * The id of the current Mythic Keystone period.
 *
 * Prefers the index's explicit `current_period`; if that's absent, falls back to the highest period
 * id present (periods are issued in ascending order, so the newest is the current one). Returns null
 * when neither can be determined — the caller degrades to no affixes rather than guessing.
 */
export function resolveCurrentPeriodId(index: PeriodIndex | undefined): number | null {
  if (!index) return null;
  if (index.current_period?.id != null) return index.current_period.id;
  let latest: number | null = null;
  for (const p of index.periods ?? []) {
    if (p.id != null && (latest == null || p.id > latest)) latest = p.id;
  }
  return latest;
}

/**
 * Turn a leaderboard's `keystone_affixes` into the week's rotation, ordered by the key level each
 * affix starts at (base affix first). The leaderboard carries each affix's localized name inline, so
 * no separate catalogue lookup is needed; an affix that arrives without a name degrades to `Affix
 * {id}` (mirroring the board's `Dungeon {id}` fallback), and one without an id is dropped entirely.
 */
export function resolveAffixRotation(affixes: LeaderboardAffixes): AffixEntry[] {
  const rows: AffixEntry[] = [];
  for (const a of affixes ?? []) {
    const id = a.keystone_affix?.id;
    if (id == null) continue;
    const name = a.keystone_affix?.name;
    rows.push({
      id,
      name: name != null && name.length > 0 ? name : `Affix ${id}`,
      startingLevel: a.starting_level ?? null,
    });
  }
  rows.sort((x, y) => {
    const xl = x.startingLevel ?? Number.POSITIVE_INFINITY;
    const yl = y.startingLevel ?? Number.POSITIVE_INFINITY;
    if (xl !== yl) return xl - yl;
    return x.id - y.id;
  });
  return rows;
}
