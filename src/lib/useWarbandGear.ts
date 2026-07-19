import { useQuery, useQueryClient, type QueryClient } from "@tanstack/react-query";
import type { Region } from "../vendor/battlenet-wow-client";
import { makeClient } from "./bnet";
import { characterEquipmentQuery, type CharacterEquipment } from "./queries";
import { fetchRegionRealmIndexes, resolveCharacterRegion } from "./region";
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

/** How many characters' equipment to fetch at once — a big roster shouldn't be one giant burst. */
const CONCURRENCY = 6;

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

/** Run `task` over `items` with at most `limit` in flight at once, preserving input order. */
async function mapWithConcurrency<T, R>(
  items: T[],
  limit: number,
  task: (item: T) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  async function worker() {
    while (next < items.length) {
      const index = next++;
      results[index] = await task(items[index]);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}

/**
 * Fetch and derive each warband character's gear. The Warbandeer export carries only a realm *name*, so
 * each character's region is resolved (best-effort, current region as fallback) before fetching its
 * equipment — cached per character under `["character-equipment", region, slug, name]`, so it's shared
 * with the paper doll. Best-effort: a character whose fetch throws comes back `failed` with empty data
 * rather than failing the whole board, and fetches run with a small concurrency cap.
 */
export async function fetchWarbandGear(
  queryClient: QueryClient,
  characters: WarbandCharacter[],
  fallbackRegion: Region,
): Promise<WarbandGear[]> {
  const indexes = await fetchRegionRealmIndexes(queryClient);
  return mapWithConcurrency(characters, CONCURRENCY, async (character) => {
    const { region, realmSlug } = resolveCharacterRegion(character.realm, indexes, fallbackRegion);
    try {
      const equipment = await queryClient.fetchQuery(
        characterEquipmentQuery(makeClient(region), realmSlug, character.name),
      );
      return {
        character,
        region,
        realmSlug,
        itemLevels: deriveItemLevels(equipment),
        findings: gearCheck(equipment),
        tierSet: tierSetInfo(equipment),
        failed: false,
      };
    } catch {
      return {
        character,
        region,
        realmSlug,
        itemLevels: {},
        findings: [],
        tierSet: null,
        failed: true,
      };
    }
  });
}

/** A stable, order-independent cache key for a roster. */
function rosterKey(characters: WarbandCharacter[]): string {
  return characters
    .map((c) => `${c.realm}/${c.name}`)
    .sort()
    .join(",");
}

/**
 * The whole warband's gear as one cached query — the data source for the gear board. Lazy (only when
 * there's a roster), keyed on the roster + fallback region; each character's underlying equipment is
 * also cached individually via {@link fetchWarbandGear}.
 */
export function useWarbandGear(characters: WarbandCharacter[], fallbackRegion: Region) {
  const queryClient = useQueryClient();
  return useQuery({
    queryKey: ["warband-gear", fallbackRegion, rosterKey(characters)] as const,
    queryFn: () => fetchWarbandGear(queryClient, characters, fallbackRegion),
    enabled: characters.length > 0,
    staleTime: 2 * 60_000,
  });
}
