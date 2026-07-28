import type { InstanceLock, WarbandCharacter, WarbandData } from "./warband";
import type { KeystoneDungeon } from "./queries";
import { isStale, levelCap } from "./vaultBoard";

/** One row of the keystone + lockout board. */
export interface KeystoneRow {
  character: WarbandCharacter;
  /** Level of the keystone this character is holding, if any. */
  keystoneLevel: number | null;
  /**
   * Name of that keystone's dungeon, resolved from the API's Mythic+ dungeon index.
   * Null when the character holds no key, or when the id isn't in the index.
   */
  dungeonName: string | null;
  /** The raw challenge-map id, kept so an unresolved dungeon can still be identified. */
  keystoneMap: number | null;
  /** Mythic+ runs completed this week, against the vault's top threshold. */
  dungeonsDone: number | null;
  dungeonsMax: number | null;
  /** Every lockout with progress — raids and dungeons alike — most prestigious difficulty first. */
  locks: InstanceLock[];
  /** Data predates the current weekly reset, so a key shown here is *last* week's. */
  stale: boolean;
}

export interface KeystoneBoard {
  rows: KeystoneRow[];
  weekStart: number | null;
  lastRefresh: number | null;
  /** Rows holding a key — the headline count. */
  withKeystone: number;
}

/**
 * Index the Mythic+ dungeon catalogue by challenge-map id.
 *
 * Sound because the addon's `keystoneMap` is a challenge-map id and so are these — the same id
 * space. Deliberately *not* done for lockouts: those ids come from `GetSavedInstanceInfo`, which is
 * the game's saved-instance space rather than the API's journal-instance space, so joining them to
 * `journal-instance` would return the wrong instance or none at all. The addon already records each
 * lockout's name, so nothing is lost by leaving them alone.
 */
export function indexDungeons(dungeons: KeystoneDungeon[] | undefined): Map<number, string> {
  return new Map((dungeons ?? []).map((d) => [d.id, d.name]));
}

function locksOf(character: WarbandCharacter): InstanceLock[] {
  return character.locks
    .filter((l) => (l.progress ?? 0) > 0)
    .sort((a, b) => b.difficultyId - a.difficultyId);
}

/**
 * Build the keystone + lockout board.
 *
 * Ordered by what's actionable: characters holding a key first (highest key first — the one you'd
 * most want run), then those with lockouts, then the rest by name. Stale rows sort last within their
 * group, since a key recorded before the reset is last week's and has already been replaced.
 */
export function buildKeystoneBoard(
  data: WarbandData | null,
  dungeons: KeystoneDungeon[] | undefined,
): KeystoneBoard {
  if (!data) return { rows: [], weekStart: null, lastRefresh: null, withKeystone: 0 };

  const weekStart = data.wealth?.week?.start ?? null;
  const byId = indexDungeons(dungeons);
  const cap = levelCap(data.characters);

  const rows: KeystoneRow[] = data.characters
    .filter((c) => cap != null && c.level === cap)
    // A character with neither a key nor a lockout has nothing to say on this board.
    .filter((c) => c.weekly?.keystoneLevel != null || c.locks.some((l) => (l.progress ?? 0) > 0))
    .map((c) => {
      const map = c.weekly?.keystoneMap ?? null;
      return {
        character: c,
        keystoneLevel: c.weekly?.keystoneLevel ?? null,
        dungeonName: map != null ? (byId.get(map) ?? null) : null,
        keystoneMap: map,
        dungeonsDone: c.weekly?.dungeonsDone ?? null,
        dungeonsMax: c.weekly?.dungeonsMax ?? null,
        locks: locksOf(c),
        stale: isStale(c, weekStart),
      };
    });

  rows.sort((a, b) => {
    if (a.stale !== b.stale) return a.stale ? 1 : -1;
    const ak = a.keystoneLevel ?? -1;
    const bk = b.keystoneLevel ?? -1;
    if (ak !== bk) return bk - ak;
    if (a.locks.length !== b.locks.length) return b.locks.length - a.locks.length;
    return a.character.name.localeCompare(b.character.name);
  });

  let lastRefresh: number | null = null;
  for (const r of rows) {
    const t = r.character.lastRefresh;
    if (t != null && (lastRefresh == null || t > lastRefresh)) lastRefresh = t;
  }

  return {
    rows,
    weekStart,
    lastRefresh,
    withKeystone: rows.filter((r) => r.keystoneLevel != null).length,
  };
}
