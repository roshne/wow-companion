// Pure shaping over the character raid-encounters document (#110): distills the *most recent*
// expansion's raids into render-ready rows (raid name + per-difficulty boss progress) for the Raids
// sub-tab, so it stays scannable rather than dumping every expansion. No API call — everything comes
// from the already-fetched `/encounters/raids` document.

import type { CharacterRaids } from "./queries";

/** One difficulty of a raid, with its boss-kill progress. */
export interface RaidMode {
  /** Difficulty name (e.g. "Normal", "Heroic", "Mythic"). */
  difficulty: string;
  /** Bosses killed on this difficulty. */
  completed: number;
  /** Total bosses in the raid. */
  total: number;
}

/** One raid instance and the character's progress across the difficulties they've engaged. */
export interface RaidInstance {
  name: string;
  modes: RaidMode[];
}

/** The latest expansion's raid progression. */
export interface RaidProgress {
  /** The expansion's name, when present. */
  expansionName?: string;
  instances: RaidInstance[];
}

/**
 * Pick the newest expansion, by id where the payload provides one.
 *
 * Blizzard documents `expansions` as oldest-first, and taking the last entry relied on that alone —
 * a positional assumption whose failure mode is silent: a payload arriving in another order would
 * show a *stale* tier that still looks entirely plausible. Ids are monotonic and don't depend on
 * ordering, so they're preferred; position remains the fallback for a payload that omits them.
 *
 * A new raid inside the *current* expansion (a patch tier like 12.1's) needs nothing here — it
 * arrives as another instance under the same expansion.
 */
function newestExpansion<T extends { expansion?: { id?: number } }>(expansions: T[]): T {
  let best = expansions[expansions.length - 1];
  let bestId = best?.expansion?.id;
  for (const candidate of expansions) {
    const id = candidate.expansion?.id;
    if (typeof id !== "number") continue;
    if (typeof bestId !== "number" || id > bestId) {
      best = candidate;
      bestId = id;
    }
  }
  return best;
}

/**
 * Distill the most recent expansion's raid progress: its instances become rows carrying each engaged
 * difficulty's completed/total boss counts (missing counts default to 0). Instances and modes without
 * a name are dropped. Returns `null` when there are no expansions — the caller renders an empty state.
 */
export function latestRaidProgress(data: CharacterRaids): RaidProgress | null {
  const expansions = data.expansions ?? [];
  if (expansions.length === 0) return null;

  const latest = newestExpansion(expansions);
  const instances: RaidInstance[] = [];
  for (const inst of latest.instances ?? []) {
    const name = inst.instance?.name;
    if (!name) continue;

    const modes: RaidMode[] = [];
    for (const mode of inst.modes ?? []) {
      const difficulty = mode.difficulty?.name;
      if (!difficulty) continue;
      modes.push({
        difficulty,
        completed: mode.progress?.completed_count ?? 0,
        total: mode.progress?.total_count ?? 0,
      });
    }
    instances.push({ name, modes });
  }

  return { expansionName: latest.expansion?.name, instances };
}
