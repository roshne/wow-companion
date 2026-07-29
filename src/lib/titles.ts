import type { Title, WarbandData } from "./warband";

/** One row of the titles browser: a title, and which characters have earned it. */
export interface TitleRow {
  id: number;
  name: string;
  /** Character names that have earned it, sorted. Empty means unearned by the whole warband. */
  earnedBy: string[];
  earned: boolean;
}

/**
 * Blizzard's internal placeholders for unreleased titles, which the catalog scan picks up because it
 * deliberately reads the whole id range rather than only known titles.
 *
 * Matched on a name wrapped entirely in square brackets rather than the literal `[PH]`, so a later
 * variant is caught too. Verified safe against the live catalog: of 703 entries, exactly 4 match —
 * all named `[PH]` — and no legitimate title name is bracketed.
 */
const PLACEHOLDER_NAME = /^\[.*\]$/;

/** Whether a catalogued name is one of Blizzard's unreleased-title placeholders. */
export function isPlaceholderTitle(name: string): boolean {
  return PLACEHOLDER_NAME.test(name.trim());
}

export interface TitleBoard {
  rows: TitleRow[];
  earnedCount: number;
  /** Titles in the catalog nobody has earned. Zero when there's no catalog to diff against. */
  unearnedCount: number;
  /** False when no catalog was recorded, so "unearned" can't be computed and isn't claimed. */
  hasCatalog: boolean;
  locale: string | null;
  scannedAt: number | null;
  scannedBy: string | null;
  /** Characters carrying a featured title, as `[character, title]`, sorted by character. */
  featured: [character: string, title: string][];
  /**
   * Placeholder titles dropped from `rows`. Reported rather than discarded silently, so the counts
   * can be reconciled against the addon's own catalog tally.
   */
  placeholdersHidden: number;
}

/** Case-insensitive substring match, the behaviour a browse-and-search list wants. */
export function matchesQuery(name: string, query: string): boolean {
  const q = query.trim().toLowerCase();
  return q === "" || name.toLowerCase().includes(q);
}

/**
 * Build the titles browser from the local export alone.
 *
 * Deliberately no API involvement. The addon already holds every character's earned titles *and* the
 * account-wide catalog, so the REST `/titles` endpoint would add only freshness — at one request per
 * character. The genuinely additive half here (what's *unearned*) comes from the catalog, which the
 * API has no equivalent for at all.
 *
 * Without a catalog the unearned set is unknowable, so it isn't guessed: `hasCatalog` is false and
 * the rows are the earned ones only. Reporting "0 unearned" there would be a claim we can't support.
 */
export function buildTitleBoard(data: WarbandData | null): TitleBoard {
  const empty: TitleBoard = {
    rows: [],
    earnedCount: 0,
    unearnedCount: 0,
    hasCatalog: false,
    locale: null,
    scannedAt: null,
    scannedBy: null,
    featured: [],
    placeholdersHidden: 0,
  };
  if (!data) return empty;

  // Earned titles merged across the warband: id -> the characters that have it.
  const earnedBy = new Map<number, string[]>();
  const namesById = new Map<number, string>();
  const featured: [string, string][] = [];

  for (const character of data.characters) {
    const titles = character.titles;
    if (!titles) continue;
    if (titles.currentName) featured.push([character.name, titles.currentName]);
    for (const t of titles.known) {
      const holders = earnedBy.get(t.id);
      if (holders) holders.push(character.name);
      else earnedBy.set(t.id, [character.name]);
      // A per-character name is as good as the catalog's and covers titles the catalog lacks.
      if (!namesById.has(t.id)) namesById.set(t.id, t.name);
    }
  }

  const catalog = data.titleCatalog;
  for (const t of catalog?.titles ?? []) {
    if (!namesById.has(t.id)) namesById.set(t.id, t.name);
  }

  // Union of catalog and earned, so a title earned but absent from the catalog still appears — the
  // catalog is one character's scan, not a guaranteed superset.
  const ids = new Set<number>([...namesById.keys()]);
  const rows: TitleRow[] = [];
  let placeholdersHidden = 0;
  for (const id of ids) {
    const name = namesById.get(id) ?? `Title ${id}`;
    // Placeholders aren't obtainable, so they're noise in a "what's left to earn" list. Dropped
    // before the counts are taken, so "still to earn" describes titles you could actually get.
    if (isPlaceholderTitle(name)) {
      placeholdersHidden += 1;
      continue;
    }
    const holders = earnedBy.get(id) ?? [];
    rows.push({
      id,
      name,
      earnedBy: [...holders].sort((a, b) => a.localeCompare(b)),
      earned: holders.length > 0,
    });
  }
  rows.sort((a, b) => a.name.localeCompare(b.name) || a.id - b.id);
  featured.sort((a, b) => a[0].localeCompare(b[0]));

  const earnedCount = rows.filter((r) => r.earned).length;
  return {
    rows,
    earnedCount,
    unearnedCount: catalog ? rows.length - earnedCount : 0,
    hasCatalog: catalog != null,
    locale: catalog?.locale ?? null,
    scannedAt: catalog?.scannedAt ?? null,
    scannedBy: catalog?.scannedBy ?? null,
    featured,
    placeholdersHidden,
  };
}

/** Filter rows by earned state and a name query. */
export function filterTitles(
  rows: TitleRow[],
  filter: "all" | "earned" | "unearned",
  query: string,
): TitleRow[] {
  return rows.filter((r) => {
    if (filter === "earned" && !r.earned) return false;
    if (filter === "unearned" && r.earned) return false;
    return matchesQuery(r.name, query);
  });
}

/** A stable key for a title row. */
export const titleKey = (t: Title) => `${t.id}`;
