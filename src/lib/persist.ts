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
const RECENTS_KEY = "wow-companion:recent-characters";
const FAVORITE_CHARACTERS_KEY = "wow-companion:favorite-characters";
const FAVORITE_REALMS_KEY = "wow-companion:favorite-realms";
const WARBAND_SEEDED_KEY = "wow-companion:warband-seeded-regions";

/** How many recently viewed characters to keep. */
export const RECENTS_CAP = 8;

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
