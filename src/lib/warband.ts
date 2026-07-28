import { queryOptions } from "@tanstack/react-query";
import { invoke } from "@tauri-apps/api/core";

/**
 * One currency a character holds, from the addon's `currency` table.
 *
 * `key` is the addon's own field name (`HeroDawncrest`, `CofferKeyShard`, …), not a Blizzard
 * currency id — the saved data carries no ids. Mapping a key to the vendored static-data bundle
 * (which is id-keyed) needs a key→id bridge on the consuming side.
 *
 * The addon stores either a bare quantity or a table with cap detail, so everything past `quantity`
 * is null for the bare form.
 */
export interface WarbandCurrency {
  key: string;
  quantity: number;
  /** Earned this week — or this season, for the currencies capped season-wide. */
  earned: number | null;
  max: number | null;
  weeklyMax: number | null;
  capped: boolean | null;
}

/** One week of warband wealth. An open week carries `baseline`; a closed one `ending` and `made`. */
export interface WarbandWeek {
  /** Server-time of the weekly reset this week began at. */
  start: number | null;
  baseline: number | null;
  ending: number | null;
  /** `ending - baseline`; may be negative. */
  made: number | null;
}

/**
 * Account-wide wealth — the warband bank is shared, so the addon stores it once rather than per
 * character. All amounts are **copper**. Deliberately raw: the addon's own "total wealth" (bank plus
 * every character's last-known gold) is derived by the consumer, not reported here.
 */
export interface WarbandWealth {
  bankGold: number | null;
  /** The currently-open week. */
  week: WarbandWeek | null;
  /** Closed weeks, oldest first. */
  history: WarbandWeek[];
}

/** One character from the Warbandeer addon export (via the `get_warband` Rust command). */
export interface WarbandCharacter {
  name: string;
  realm: string;
  guid: string | null;
  classId: number | null;
  classKey: string | null;
  className: string | null;
  level: number | null;
  itemLevel: number | null;
  spec: string | null;
  role: string | null;
  professionPrimary: string | null;
  professionSecondary: string | null;
  guild: string | null;
  faction: string | null;
  /** This character's own gold in **copper**, lifted out of the currency table. */
  gold: number | null;
  /** Every other recorded currency, sorted by key so the list is stable across reads. */
  currencies: WarbandCurrency[];
}

/** The full warband export: account label, source path, the character list, and account-wide wealth. */
export interface WarbandData {
  account: string;
  source: string;
  characters: WarbandCharacter[];
  /** Null when the export predates the addon's account-wide wealth tracking. */
  wealth: WarbandWealth | null;
}

/**
 * Read the local Warbandeer export via the Rust `get_warband` command. Region-agnostic (the export
 * has no region), so a single cache key. `retry: false` — a missing addon/file is a definitive result,
 * not a transient error to back off on.
 */
export const warbandQuery = () =>
  queryOptions({
    queryKey: ["warband"] as const,
    queryFn: () => invoke<WarbandData>("get_warband"),
    retry: false,
    staleTime: 5 * 60_000,
  });
