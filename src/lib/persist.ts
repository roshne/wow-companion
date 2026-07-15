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

function isRecentCharacter(value: unknown): value is RecentCharacter {
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

function identity(c: RecentCharacter): string {
  return `${c.region}/${c.realmSlug}/${c.characterName}`;
}

/** The persisted MRU of recent characters (validated, capped), most-recent first. */
export function loadRecentCharacters(): RecentCharacter[] {
  const raw = readRaw(RECENTS_KEY);
  if (!raw) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(isRecentCharacter).slice(0, RECENTS_CAP);
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
