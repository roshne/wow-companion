import type {
  InstanceLock,
  VaultSlot,
  WarbandCharacter,
  WarbandData,
  WarbandWeek,
} from "./warband";

/** One Great Vault track, with its slots and how many are unlocked. */
export interface TrackProgress {
  slots: VaultSlot[];
  unlocked: number;
  total: number;
}

/** One row of the Great Vault board. */
export interface VaultRow {
  character: WarbandCharacter;
  raid: TrackProgress;
  dungeons: TrackProgress;
  world: TrackProgress;
  /** A reward is sitting uncollected — the one genuinely actionable state on this board. */
  hasUnclaimed: boolean;
  /**
   * The character hasn't been scanned since the current weekly reset, so its vault figures describe
   * *last* week. Distinguishing this from a genuinely empty vault is the whole point of the row:
   * "you've done nothing this week" and "we haven't seen you this week" look identical otherwise.
   */
  stale: boolean;
  /** This week's raid lockouts, most prestigious difficulty first. */
  raidLocks: InstanceLock[];
}

export interface VaultBoard {
  rows: VaultRow[];
  /** Start of the current weekly reset, as the addon computed it. Null if it recorded none. */
  weekStart: number | null;
  /** Newest scan time across the shown characters — the board's "as of". */
  lastRefresh: number | null;
  /** Characters excluded for being below the warband's level cap. */
  levellingExcluded: number;
}

function track(slots: VaultSlot[] | undefined): TrackProgress {
  const list = slots ?? [];
  return { slots: list, unlocked: list.filter((s) => s.complete).length, total: list.length };
}

/**
 * The warband's level cap, derived from its own highest character rather than hardcoded.
 *
 * Deliberately not a constant. A literal max level is an expansion-bound assumption that goes stale
 * at the next level-cap raise — exactly the kind of thing the season-rollover audit exists to hunt —
 * and deriving it is self-correcting. The degenerate case (nobody at the real cap) shows the
 * warband's most advanced characters instead, which is a reasonable thing to show anyway.
 */
export function levelCap(characters: WarbandCharacter[]): number | null {
  let cap: number | null = null;
  for (const c of characters) {
    if (c.level != null && (cap == null || c.level > cap)) cap = c.level;
  }
  return cap;
}

/**
 * Whether a character's data predates the current weekly reset.
 *
 * Both sides come from the addon: `lastRefresh` is when it last scanned the character, and the week
 * start is the reset boundary it computed itself — so this never has to encode a region's reset
 * schedule. Unknowable (either side missing) counts as *not* stale: claiming staleness we can't
 * demonstrate would be worse than staying quiet.
 */
export function isStale(character: WarbandCharacter, weekStart: number | null): boolean {
  if (weekStart == null || character.lastRefresh == null) return false;
  return character.lastRefresh < weekStart;
}

function raidLocksOf(character: WarbandCharacter): InstanceLock[] {
  return character.locks
    .filter((l) => l.isRaid === true && (l.progress ?? 0) > 0)
    .sort((a, b) => b.difficultyId - a.difficultyId);
}

/**
 * Build the Great Vault board.
 *
 * Rows are ordered by what needs doing rather than alphabetically: unclaimed rewards first (the only
 * state that costs you something by being ignored), then fewest slots unlocked — the characters with
 * the most left to earn — then name. Stale rows sort last within their group, since their figures
 * describe last week and can't be acted on.
 */
export function buildVaultBoard(data: WarbandData | null): VaultBoard {
  if (!data) return { rows: [], weekStart: null, lastRefresh: null, levellingExcluded: 0 };

  const weekStart = weekStartOf(data.wealth?.week ?? null);
  const cap = levelCap(data.characters);

  const eligible = data.characters.filter((c) => cap != null && c.level === cap);
  const levellingExcluded = data.characters.length - eligible.length;

  const rows: VaultRow[] = eligible
    // The Great Vault is a max-level feature, so a character with no vault data at all has nothing
    // to show — an empty row would read as "nothing earned" rather than "nothing recorded".
    .filter((c) => c.weekly?.vault != null)
    .map((c) => {
      const vault = c.weekly!.vault!;
      return {
        character: c,
        raid: track(vault.raid),
        dungeons: track(vault.dungeons),
        world: track(vault.world),
        hasUnclaimed: c.weekly?.hasUnclaimedVault === true,
        stale: isStale(c, weekStart),
        raidLocks: raidLocksOf(c),
      };
    });

  rows.sort((a, b) => {
    if (a.hasUnclaimed !== b.hasUnclaimed) return a.hasUnclaimed ? -1 : 1;
    if (a.stale !== b.stale) return a.stale ? 1 : -1;
    const au = a.raid.unlocked + a.dungeons.unlocked + a.world.unlocked;
    const bu = b.raid.unlocked + b.dungeons.unlocked + b.world.unlocked;
    if (au !== bu) return au - bu;
    return a.character.name.localeCompare(b.character.name);
  });

  let lastRefresh: number | null = null;
  for (const r of rows) {
    const t = r.character.lastRefresh;
    if (t != null && (lastRefresh == null || t > lastRefresh)) lastRefresh = t;
  }

  return { rows, weekStart, lastRefresh, levellingExcluded };
}

/** The reset boundary the addon recorded for the open week. */
function weekStartOf(week: WarbandWeek | null): number | null {
  return week?.start ?? null;
}
