import { useMemo } from "react";
import { useQueries, useQuery, useQueryClient } from "@tanstack/react-query";
import type { BlizzardClient, Region } from "../vendor/battlenet-wow-client";
import { makeClient } from "./bnet";
import { characterEquipmentQuery, type CharacterEquipment } from "./queries";
import { fetchRegionRealmIndexes, resolveCharacterRegion, type RegionRealmIndexes } from "./region";
import { gearCheck, ILVL_OUTLIER_THRESHOLD, type GearFinding } from "./gearCheck";
import type { WarbandCharacter } from "./warband";

/** The character's largest equipped set — a proxy for their tier set (see {@link tierSetInfo}). */
export interface TierSet {
  name: string;
  pieces: number;
}

/** One warband character's derived gear: the region/realm it was fetched from, its per-slot item
 *  levels, its gear-check findings, and its largest equipped set. `failed` marks a character whose
 *  equipment fetch errored — a placeholder row, not real data. */
export interface WarbandGear {
  character: WarbandCharacter;
  region: Region;
  realmSlug: string;
  /** `slot.type` → item level, for the slots this character has equipped. */
  itemLevels: Record<string, number>;
  findings: GearFinding[];
  tierSet: TierSet | null;
  failed: boolean;
}

/**
 * One board row: a warband character and its gear once resolved. `gear` is `null` while that
 * character's equipment fetch is still in flight, so each row can render its own loading state and
 * appear independently — the board no longer waits on the whole roster.
 */
export interface WarbandRow {
  character: WarbandCharacter;
  gear: WarbandGear | null;
}

/** A resolved fetch target for a warband character: which region's host and the realm slug within it. */
export interface WarbandTarget {
  character: WarbandCharacter;
  region: Region;
  realmSlug: string;
}

/** `slot.type` → item level for each equipped slot that reports one (skips slots without a value). */
export function deriveItemLevels(equipment: CharacterEquipment): Record<string, number> {
  const itemLevels: Record<string, number> = {};
  for (const item of equipment.equipped_items ?? []) {
    const slot = item.slot?.type;
    const value = item.level?.value;
    if (slot && typeof value === "number") itemLevels[slot] = value;
  }
  return itemLevels;
}

/**
 * The character's weakest slot(s): the slot type(s) at the minimum item level — but only when that
 * minimum is more than {@link ILVL_OUTLIER_THRESHOLD} below their average, so an even set (or a single
 * slot) has no "weakest". Ties return every slot at the minimum.
 */
export function weakestSlots(itemLevels: Record<string, number>): string[] {
  const entries = Object.entries(itemLevels);
  if (entries.length < 2) return [];
  const values = entries.map(([, v]) => v);
  const min = Math.min(...values);
  const average = values.reduce((sum, v) => sum + v, 0) / values.length;
  if (average - min <= ILVL_OUTLIER_THRESHOLD) return [];
  return entries.filter(([, v]) => v === min).map(([slot]) => slot);
}

/**
 * The character's largest equipped set — a proxy for their tier set. A character can wear pieces of
 * more than one set, so group the equipped items by `set.item_set.id` and return the one with the most
 * pieces (no maintained tier-id list). Null when nothing equipped carries set data.
 */
export function tierSetInfo(equipment: CharacterEquipment): TierSet | null {
  const counts = new Map<number, TierSet>();
  for (const item of equipment.equipped_items ?? []) {
    const id = item.set?.item_set?.id;
    if (typeof id !== "number") continue;
    const existing = counts.get(id);
    if (existing) existing.pieces += 1;
    else counts.set(id, { name: item.set?.item_set?.name ?? "Set", pieces: 1 });
  }
  let best: TierSet | null = null;
  for (const set of counts.values()) if (!best || set.pieces > best.pieces) best = set;
  return best;
}

/** Derive one character's gear from its equipment document (the non-failed row). */
export function deriveGear(
  character: WarbandCharacter,
  region: Region,
  realmSlug: string,
  equipment: CharacterEquipment,
): WarbandGear {
  return {
    character,
    region,
    realmSlug,
    itemLevels: deriveItemLevels(equipment),
    findings: gearCheck(equipment),
    tierSet: tierSetInfo(equipment),
    failed: false,
  };
}

/**
 * Resolve each roster character to a fetch target — the region whose host holds it and the realm slug
 * within it — from the loaded realm indexes. The Warbandeer export carries only a realm *name*, so the
 * region is matched best-effort (current region as fallback); see {@link resolveCharacterRegion}.
 */
export function resolveWarbandTargets(
  characters: WarbandCharacter[],
  indexes: RegionRealmIndexes,
  fallbackRegion: Region,
): WarbandTarget[] {
  return characters.map((character) => {
    const { region, realmSlug } = resolveCharacterRegion(character.realm, indexes, fallbackRegion);
    return { character, region, realmSlug };
  });
}

/** A placeholder gear row for a character whose equipment fetch failed — no data, `failed: true`. */
function failedGear(
  character: WarbandCharacter,
  target: WarbandTarget | undefined,
  fallback: Region,
): WarbandGear {
  return {
    character,
    region: target?.region ?? fallback,
    realmSlug: target?.realmSlug ?? "",
    itemLevels: {},
    findings: [],
    tierSet: null,
    failed: true,
  };
}

/**
 * The whole warband's gear, streamed **row by row**. The near-static realm indexes load once (shared,
 * cached); then each character's equipment is fetched as its own query — keyed
 * `["character-equipment", region, slug, name]`, so it's shared with the paper doll — and derived via
 * {@link deriveGear}. Each row surfaces independently: `gear` is `null` until that character's fetch
 * settles, then the derived gear (or a `failed` placeholder), so early rows render without waiting on
 * slow ones. Lazy (only when there's a roster).
 *
 * The targets and the query list are memoized, which matters more than it looks: React Query re-runs a
 * query's `select` whenever the function's identity changes, so building the list inline re-derived
 * *every* character's gear (a `gearCheck` + item-level + tier-set pass over their whole equipment doc)
 * on *every* render — and with per-row streaming the board re-renders once per row that resolves, so
 * filling an N-character warband cost O(N²) derivations. (Structural sharing hid this: the re-derived
 * object is deep-equal, so React Query hands back the previous reference and nothing downstream
 * re-renders. The work was simply thrown away.) Memoized, each row derives once per fetch.
 */
export function useWarbandGear(characters: WarbandCharacter[], fallbackRegion: Region) {
  const queryClient = useQueryClient();

  // The realm indexes are the shared prerequisite for resolving each character's region — one fetch,
  // not one per row.
  const indexesQuery = useQuery({
    queryKey: ["region-realm-indexes"] as const,
    queryFn: () => fetchRegionRealmIndexes(queryClient),
    staleTime: 60 * 60_000,
  });
  const indexes = indexesQuery.data;
  const targets = useMemo(
    () => (indexes ? resolveWarbandTargets(characters, indexes, fallbackRegion) : null),
    [characters, indexes, fallbackRegion],
  );

  // One client per region (four at most) rather than one per character per render.
  const clients = useMemo(() => new Map<Region, BlizzardClient>(), []);

  // One query per character (only once targets are known); each shares the paper doll's per-character
  // equipment cache and derives its gear in `select`.
  const queries = useMemo(() => {
    function clientFor(region: Region): BlizzardClient {
      const existing = clients.get(region);
      if (existing) return existing;
      const client = makeClient(region);
      clients.set(region, client);
      return client;
    }
    return (targets ?? []).map((target) => ({
      ...characterEquipmentQuery(clientFor(target.region), target.realmSlug, target.character.name),
      select: (equipment: CharacterEquipment) =>
        deriveGear(target.character, target.region, target.realmSlug, equipment),
    }));
  }, [targets, clients]);

  const results = useQueries({ queries });

  // The failed-row placeholders, built once per target list. `select` already hands back a stable
  // object for a resolved row and a pending row's gear is plain `null`, so without these the *failed*
  // rows would be the one kind minting a fresh object each render — and so the one kind whose board
  // row could never memoize.
  const failedPlaceholders = useMemo(
    () => (targets ?? []).map((target) => failedGear(target.character, target, fallbackRegion)),
    [targets, fallbackRegion],
  );

  const rows: WarbandRow[] = characters.map((character, i) => {
    const result = results[i];
    if (result?.isSuccess) return { character, gear: result.data };
    // A result only exists once targets resolved, so the placeholder is always there alongside it.
    if (result?.isError)
      return {
        character,
        gear: failedPlaceholders[i] ?? failedGear(character, undefined, fallbackRegion),
      };
    return { character, gear: null };
  });

  return {
    rows,
    // A whole-board error only when the shared realm-index prerequisite hard-fails; per-character
    // equipment failures stay per-row (a `failed` gear placeholder).
    error: indexesQuery.isError ? indexesQuery.error : null,
    refetch: () => {
      void indexesQuery.refetch();
      for (const result of results) void result.refetch();
    },
  };
}
