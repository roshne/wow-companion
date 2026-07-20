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
 * Distill the most recent expansion's raid progress. Blizzard returns `expansions` oldest-first, so the
 * last entry is current; its instances become rows carrying each engaged difficulty's completed/total
 * boss counts (missing counts default to 0). Instances and modes without a name are dropped. Returns
 * `null` when there are no expansions — the caller renders an empty state.
 */
export function latestRaidProgress(data: CharacterRaids): RaidProgress | null {
  const expansions = data.expansions ?? [];
  if (expansions.length === 0) return null;

  const latest = expansions[expansions.length - 1];
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
