// Reconciling the two things that both claim to list your characters.
//
// They are not competing sources of the same fact — they are authorities over different facts:
//
//   * **Battle.net is the authority on which characters exist.** It returns every character on the
//     account, including ones never logged into since the addon was installed.
//   * **The addon is the authority on what they have done.** Item level, spec, gold, the Great Vault,
//     lockouts, currencies and titles exist nowhere in the API's account index.
//
// So a merged row prefers the addon wherever both describe a character, and the merged *list* is
// driven by the API. A row's `source` records which side it came from, because the difference is
// visible to the player: an api-only row is missing item level and spec not because the character is
// unplayed, but because the addon has never seen it. Left unlabelled those rows read as neglected.

import type { AccountCharacter } from "./accountProfile";
import type { WarbandCharacter } from "./warband";

/** Which source(s) a merged row came from. */
export type RosterSource = "both" | "api-only" | "addon-only";

/** One character, merged across both sources. */
export interface RosterRow {
  /** Stable identity for React keys and sorting: realm + name, normalized. */
  key: string;
  name: string;
  realmName: string;
  /** Which WoW account the character belongs to; null for a row only the addon knows. */
  wowAccountId: number | null;
  className: string | null;
  /** The addon's class key (`MAGE`), for class colouring. Only ever present on an addon row. */
  classKey: string | null;
  race: string | null;
  faction: string | null;
  level: number | null;
  /** Addon-only: the API's account index carries no item level. */
  itemLevel: number | null;
  /** Addon-only. */
  spec: string | null;
  /** Addon-only. */
  guild: string | null;
  source: RosterSource;
  /** The API entry carried a `protected_character` link. */
  protected: boolean;
}

/**
 * The identity two sources are matched on.
 *
 * Both sides store a realm *display* name ("Area 52"), so matching on that is exact even for realms
 * whose slug isn't a hyphenation of their name ("Aggra (Português)" → `aggra-portugues`). The slug is
 * indexed as a second key anyway, so a source that happens to hold a slugged value still matches.
 */
function identity(name: string, realm: string): string {
  return `${realm.trim().toLowerCase()}|${name.trim().toLowerCase()}`;
}

/**
 * Merge the API's character index with the addon's records.
 *
 * Ordering is by realm then name, so a row keeps its position as sources come and go — sorting by a
 * column the sparse rows lack would otherwise shuffle them into a block at one end.
 */
export function mergeRoster(api: AccountCharacter[], addon: WarbandCharacter[]): RosterRow[] {
  // Index the addon's records under both realm forms, and remember which got consumed so whatever
  // is left over can be surfaced rather than silently dropped.
  const byIdentity = new Map<string, WarbandCharacter>();
  for (const c of addon) {
    byIdentity.set(identity(c.name, c.realm), c);
  }
  const consumed = new Set<WarbandCharacter>();

  const rows: RosterRow[] = api.map((a) => {
    const match =
      byIdentity.get(identity(a.name, a.realmName)) ??
      byIdentity.get(identity(a.name, a.realmSlug));
    if (match) consumed.add(match);
    return {
      key: identity(a.name, a.realmName),
      name: a.name,
      realmName: a.realmName,
      wowAccountId: a.wowAccountId,
      // The addon's class name is preferred only because it's the same string the rest of the
      // Warband tab shows; either source is correct.
      className: match?.className ?? a.class,
      classKey: match?.classKey ?? null,
      race: a.race,
      faction: match?.faction ?? a.faction,
      // Level is the one fact both carry. The API's is current; the addon's is as of last logout.
      level: a.level ?? match?.level ?? null,
      itemLevel: match?.itemLevel ?? null,
      spec: match?.spec ?? null,
      guild: match?.guild ?? null,
      source: match ? "both" : "api-only",
      protected: a.protected,
    };
  });

  // A character the addon knows but the API didn't return: a different Battle.net account, a
  // different region than the one selected, or a deleted character the addon still remembers.
  // Shown rather than dropped — disappearing without explanation is worse than an odd row.
  for (const c of addon) {
    if (consumed.has(c)) continue;
    rows.push({
      key: identity(c.name, c.realm),
      name: c.name,
      realmName: c.realm,
      wowAccountId: null,
      className: c.className,
      classKey: c.classKey,
      race: null,
      faction: c.faction,
      level: c.level,
      itemLevel: c.itemLevel,
      spec: c.spec,
      guild: c.guild,
      source: "addon-only",
      protected: false,
    });
  }

  return rows.sort(
    (a, b) => a.realmName.localeCompare(b.realmName) || a.name.localeCompare(b.name),
  );
}

/** The counts behind the summary line — what each source contributed. */
export interface RosterCounts {
  total: number;
  /** Rows both sources describe: the ones with item level, spec and everything else. */
  deep: number;
  /** Rows Battle.net returned that the addon has never seen. */
  apiOnly: number;
  /** Rows only the addon remembers. */
  addonOnly: number;
}

export function rosterCounts(rows: RosterRow[]): RosterCounts {
  return {
    total: rows.length,
    deep: rows.filter((r) => r.source === "both").length,
    apiOnly: rows.filter((r) => r.source === "api-only").length,
    addonOnly: rows.filter((r) => r.source === "addon-only").length,
  };
}
