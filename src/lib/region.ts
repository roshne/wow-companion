// Best-effort region detection for warband alts. The Warbandeer export carries a realm *name* but no
// region, so opening an alt against the app's current region 404s whenever the alt actually lives
// elsewhere. These helpers match the realm against each region's realm index to pick the region that
// contains it, lazy-loading + caching the (near-static) indexes through TanStack Query.

import type { QueryClient } from "@tanstack/react-query";
import type { Region } from "../vendor/battlenet-wow-client";
import { makeClient } from "./bnet";
import { realmIndexQuery, type RealmIndexEntry } from "./queries";
import { findRealm, resolveRealmSlug } from "./slug";

/** Every WoW region, in the app's canonical order. */
export const REGIONS: Region[] = ["us", "eu", "kr", "tw"];

/** Per-region realm indexes; a region is absent when its index hasn't been (or couldn't be) loaded. */
export type RegionRealmIndexes = Partial<Record<Region, RealmIndexEntry[]>>;

/** A resolved place to open a character: which region's host, and the realm slug within it. */
export interface ResolvedCharacterRegion {
  region: Region;
  realmSlug: string;
}

/**
 * Best-effort region for a warband alt, whose export has a realm name but no region. Match the realm
 * against each region's realm index:
 *  - listed in exactly one region → that region, with the index's true slug;
 *  - listed in more than one region (realm names can collide across regions) → ambiguous;
 *  - listed in none → unknown.
 * Both ambiguous and unknown fall back to `fallbackRegion` (the currently-selected region), with the
 * slug resolved against that region's index — its true slug if listed there, else the derived slug.
 */
export function resolveCharacterRegion(
  realmName: string,
  indexes: RegionRealmIndexes,
  fallbackRegion: Region,
): ResolvedCharacterRegion {
  const matches: ResolvedCharacterRegion[] = [];
  for (const region of Object.keys(indexes) as Region[]) {
    const entry = findRealm(realmName, indexes[region] ?? []);
    if (entry) matches.push({ region, realmSlug: entry.slug });
  }
  if (matches.length === 1) return matches[0];
  return {
    region: fallbackRegion,
    realmSlug: resolveRealmSlug(realmName, indexes[fallbackRegion] ?? []),
  };
}

/**
 * Lazily fetch each region's realm index through TanStack Query, returning the ones that load. Reads
 * from the region-keyed cache when warm (the index is near-static, staleTime 60 min) and only hits the
 * network on a cold region — so detection stays on-demand (a roster click), never eager for the whole
 * roster. Best-effort: a region whose index fails to load is omitted rather than failing the lookup.
 */
export async function fetchRegionRealmIndexes(
  queryClient: QueryClient,
  regions: Region[] = REGIONS,
): Promise<RegionRealmIndexes> {
  const loaded = await Promise.all(
    regions.map(async (region): Promise<[Region, RealmIndexEntry[] | null]> => {
      try {
        return [region, await queryClient.fetchQuery(realmIndexQuery(makeClient(region)))];
      } catch {
        return [region, null];
      }
    }),
  );
  const indexes: RegionRealmIndexes = {};
  for (const [region, data] of loaded) if (data) indexes[region] = data;
  return indexes;
}
