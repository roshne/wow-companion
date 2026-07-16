// The app's single persistence helper, backed by localStorage.
//
// localStorage is the pragmatic choice for this small, low-write, non-secret payload: it's synchronous,
// so state can be seeded directly from it (the app opens on the last-used region with no flash). Keeping
// every read/write behind this one module means a later swap to the Tauri Store plugin (durability,
// Rust-side access) is a one-file change. Shared with future features (favorites, token history).
//
// All reads are validated (a wiped/garbage store degrades to sensible defaults) and all access is
// wrapped so a disabled or full store never throws.

import type { Region } from "../vendor/battlenet-wow-client";

const REGIONS: Region[] = ["us", "eu", "kr", "tw"];
const REGION_KEY = "wow-companion:region";
const THEME_KEY = "wow-companion:theme";
const RECENTS_KEY = "wow-companion:recent-characters";
const FAVORITE_CHARACTERS_KEY = "wow-companion:favorite-characters";
const FAVORITE_REALMS_KEY = "wow-companion:favorite-realms";
const WARBAND_SEEDED_KEY = "wow-companion:warband-seeded-regions";
const TOKEN_HISTORY_PREFIX = "wow-companion:token-history:";
const ITEM_NAMES_KEY = "wow-companion:item-names";

/** How many recently viewed characters to keep. */
export const RECENTS_CAP = 8;

/** How many token price points to keep per region (~a week at the ~20-min update cadence). */
export const TOKEN_HISTORY_CAP = 500;

/** A recently viewed character's identity — enough to re-run the lookup (the profile is re-fetched). */
export interface RecentCharacter {
  region: Region;
  realmSlug: string;
  characterName: string;
}

function readRaw(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function writeRaw(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    // Best-effort: private mode, quota, or no storage — persistence is non-essential.
  }
}

function isRegion(value: unknown): value is Region {
  return typeof value === "string" && (REGIONS as string[]).includes(value);
}

/** The persisted region, or "us" when absent/invalid. */
export function loadRegion(): Region {
  const raw = readRaw(REGION_KEY);
  return isRegion(raw) ? raw : "us";
}

export function saveRegion(region: Region): void {
  writeRaw(REGION_KEY, region);
}

// --- Theme choice: light / dark, or "system" to follow the OS `prefers-color-scheme`. -------------

/** The user's theme preference. "system" defers to the OS setting (the first-run default). */
export type ThemeChoice = "light" | "dark" | "system";

const THEMES: ThemeChoice[] = ["light", "dark", "system"];

function isThemeChoice(value: unknown): value is ThemeChoice {
  return typeof value === "string" && (THEMES as string[]).includes(value);
}

/** The persisted theme choice, or "system" when absent/invalid. */
export function loadTheme(): ThemeChoice {
  const raw = readRaw(THEME_KEY);
  return isThemeChoice(raw) ? raw : "system";
}

export function saveTheme(choice: ThemeChoice): void {
  writeRaw(THEME_KEY, choice);
}

function isCharacterRef(value: unknown): value is RecentCharacter {
  if (!value || typeof value !== "object") return false;
  const v = value as Record<string, unknown>;
  return (
    isRegion(v.region) &&
    typeof v.realmSlug === "string" &&
    v.realmSlug.length > 0 &&
    typeof v.characterName === "string" &&
    v.characterName.length > 0
  );
}

function identity(c: { region: Region; realmSlug: string; characterName: string }): string {
  return `${c.region}/${c.realmSlug}/${c.characterName}`;
}

/** The persisted MRU of recent characters (validated, capped), most-recent first. */
export function loadRecentCharacters(): RecentCharacter[] {
  const raw = readRaw(RECENTS_KEY);
  if (!raw) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(isCharacterRef).slice(0, RECENTS_CAP);
  } catch {
    return [];
  }
}

export function saveRecentCharacters(list: RecentCharacter[]): void {
  writeRaw(RECENTS_KEY, JSON.stringify(list.slice(0, RECENTS_CAP)));
}

/**
 * Add a character to the MRU: move-to-front, dedupe on region+realmSlug+characterName, cap at
 * RECENTS_CAP. Persists and returns the new list.
 */
export function addRecentCharacter(entry: RecentCharacter): RecentCharacter[] {
  const key = identity(entry);
  const next = [entry, ...loadRecentCharacters().filter((c) => identity(c) !== key)].slice(
    0,
    RECENTS_CAP,
  );
  saveRecentCharacters(next);
  return next;
}

// --- Favorites: user-curated pins (uncapped). Characters and realms are stored separately; realm
// pins are keyed by slug so the warband's realms can seed into them. -------------------------------

/** A pinned character (same identity shape as a recent). */
export interface FavoriteCharacter {
  region: Region;
  realmSlug: string;
  characterName: string;
}

export function loadFavoriteCharacters(): FavoriteCharacter[] {
  const raw = readRaw(FAVORITE_CHARACTERS_KEY);
  if (!raw) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter(isCharacterRef) : [];
  } catch {
    return [];
  }
}

export function saveFavoriteCharacters(list: FavoriteCharacter[]): void {
  writeRaw(FAVORITE_CHARACTERS_KEY, JSON.stringify(list));
}

/** Whether a character is currently pinned. */
export function isFavoriteCharacter(list: FavoriteCharacter[], entry: FavoriteCharacter): boolean {
  const id = identity(entry);
  return list.some((f) => identity(f) === id);
}

/** Toggle a character pin (add if absent, remove if present). Persists; returns the new list. */
export function toggleFavoriteCharacter(entry: FavoriteCharacter): FavoriteCharacter[] {
  const list = loadFavoriteCharacters();
  const id = identity(entry);
  const next = list.some((f) => identity(f) === id)
    ? list.filter((f) => identity(f) !== id)
    : [...list, entry];
  saveFavoriteCharacters(next);
  return next;
}

/** Remove a character pin (e.g. a dead/404'd entry). Persists; returns the new list. */
export function removeFavoriteCharacter(entry: FavoriteCharacter): FavoriteCharacter[] {
  const id = identity(entry);
  const next = loadFavoriteCharacters().filter((f) => identity(f) !== id);
  saveFavoriteCharacters(next);
  return next;
}

/** A pinned realm, keyed by slug (region-scoped). */
export interface FavoriteRealm {
  region: Region;
  realmSlug: string;
}

function isFavoriteRealm(value: unknown): value is FavoriteRealm {
  if (!value || typeof value !== "object") return false;
  const v = value as Record<string, unknown>;
  return isRegion(v.region) && typeof v.realmSlug === "string" && v.realmSlug.length > 0;
}

function realmIdentity(region: Region, realmSlug: string): string {
  return `${region}/${realmSlug}`;
}

export function loadFavoriteRealms(): FavoriteRealm[] {
  const raw = readRaw(FAVORITE_REALMS_KEY);
  if (!raw) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter(isFavoriteRealm) : [];
  } catch {
    return [];
  }
}

export function saveFavoriteRealms(list: FavoriteRealm[]): void {
  writeRaw(FAVORITE_REALMS_KEY, JSON.stringify(list));
}

/** Whether a realm slug is pinned in a region. */
export function isRealmFavorited(
  list: FavoriteRealm[],
  region: Region,
  realmSlug: string,
): boolean {
  const id = realmIdentity(region, realmSlug);
  return list.some((f) => realmIdentity(f.region, f.realmSlug) === id);
}

/** Add the given realm slugs as pins if absent (used to seed from the warband). Returns the new list. */
export function ensureRealmFavorites(region: Region, realmSlugs: string[]): FavoriteRealm[] {
  const list = loadFavoriteRealms();
  const present = new Set(list.map((f) => realmIdentity(f.region, f.realmSlug)));
  const additions = realmSlugs
    .filter((slug) => !present.has(realmIdentity(region, slug)))
    .map((slug) => ({ region, realmSlug: slug }));
  if (additions.length === 0) return list;
  const next = [...list, ...additions];
  saveFavoriteRealms(next);
  return next;
}

/**
 * Toggle a whole connected-realm row: if any of its slugs is pinned, remove them all; otherwise pin
 * them all. Persists; returns the new list.
 */
export function toggleFavoriteRealmRow(region: Region, realmSlugs: string[]): FavoriteRealm[] {
  const list = loadFavoriteRealms();
  const ids = new Set(realmSlugs.map((slug) => realmIdentity(region, slug)));
  const anyPinned = list.some((f) => ids.has(realmIdentity(f.region, f.realmSlug)));
  const next = anyPinned
    ? list.filter((f) => !ids.has(realmIdentity(f.region, f.realmSlug)))
    : [...list, ...realmSlugs.map((slug) => ({ region, realmSlug: slug }))];
  saveFavoriteRealms(next);
  return next;
}

/** Whether the warband realms have already been seeded for a region (seeding runs once per region). */
export function hasSeededWarband(region: Region): boolean {
  const raw = readRaw(WARBAND_SEEDED_KEY);
  if (!raw) return false;
  try {
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) && parsed.includes(region);
  } catch {
    return false;
  }
}

export function markWarbandSeeded(region: Region): void {
  const raw = readRaw(WARBAND_SEEDED_KEY);
  let regions: string[] = [];
  try {
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    if (Array.isArray(parsed)) regions = parsed.filter((r): r is string => typeof r === "string");
  } catch {
    regions = [];
  }
  if (!regions.includes(region)) {
    regions.push(region);
    writeRaw(WARBAND_SEEDED_KEY, JSON.stringify(regions));
  }
}

// --- Token price history: self-accumulated per region (the API only returns the current price). -----

/** One WoW Token price sample. `t` is the server's `last_updated_timestamp`; `price` is in copper. */
export interface TokenPricePoint {
  t: number;
  price: number;
}

function isTokenPricePoint(value: unknown): value is TokenPricePoint {
  if (!value || typeof value !== "object") return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.t === "number" && Number.isFinite(v.t) && typeof v.price === "number" && v.price >= 0
  );
}

/** The persisted token price series for a region (validated, capped), oldest first. */
export function loadTokenHistory(region: Region): TokenPricePoint[] {
  const raw = readRaw(TOKEN_HISTORY_PREFIX + region);
  if (!raw) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter(isTokenPricePoint).slice(-TOKEN_HISTORY_CAP) : [];
  } catch {
    return [];
  }
}

/**
 * Append a price sample, deduped on the server timestamp (a repeat within the ~20-min window is a
 * no-op), capped as a ring buffer. Persists and returns the new series.
 */
export function appendTokenPrice(region: Region, point: TokenPricePoint): TokenPricePoint[] {
  const history = loadTokenHistory(region);
  const last = history[history.length - 1];
  if (last && last.t === point.t) return history;
  const next = [...history, point].slice(-TOKEN_HISTORY_CAP);
  writeRaw(TOKEN_HISTORY_PREFIX + region, JSON.stringify(next));
  return next;
}

// --- Resolved item names: the persistent cache behind the auction browser's viewport-only name
// resolution. Item names (en_US) are region-independent, so the cache is a single global map keyed by
// numeric item id and kept indefinitely (item names effectively never change). ------------------------

/** A resolved item: its localized display name and quality tier (for colouring). */
export interface ResolvedItem {
  name: string;
  /** The API's `quality.type` (e.g. "EPIC"), when known. */
  quality?: string;
}

function isResolvedItem(value: unknown): value is ResolvedItem {
  if (!value || typeof value !== "object") return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.name === "string" &&
    v.name.length > 0 &&
    (v.quality === undefined || typeof v.quality === "string")
  );
}

/**
 * The persisted item-name cache, keyed by numeric item id (JSON object keys are strings; numeric
 * lookups coerce, so `cache[123]` works). Invalid entries are dropped.
 */
export function loadItemNames(): Record<number, ResolvedItem> {
  const raw = readRaw(ITEM_NAMES_KEY);
  if (!raw) return {};
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return {};
    const out: Record<number, ResolvedItem> = {};
    for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
      const id = Number(key);
      if (Number.isInteger(id) && isResolvedItem(value)) {
        out[id] = value.quality === undefined ? { name: value.name } : value;
      }
    }
    return out;
  } catch {
    return {};
  }
}

/**
 * Merge freshly resolved items into the persisted cache (new entries win), persist, and return the
 * merged map. A no-op merge (nothing new) still returns the current cache without a write.
 */
export function mergeItemNames(
  entries: Record<number, ResolvedItem>,
): Record<number, ResolvedItem> {
  const current = loadItemNames();
  if (Object.keys(entries).length === 0) return current;
  const next = { ...current, ...entries };
  writeRaw(ITEM_NAMES_KEY, JSON.stringify(next));
  return next;
}
