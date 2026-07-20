// Pure shaping over the character achievements document (#111): distills the aggregate totals plus a
// flat, most-recent-first list of earned achievements, and a name filter over it — so the Achievements
// sub-tab (a virtualized, filterable list) stays a thin view. No API call — everything comes from the
// already-fetched `/achievements` document.

import type { CharacterAchievements } from "./queries";

/** One earned achievement, distilled for the list. */
export interface EarnedAchievement {
  /** The achievement's id (used as a stable list key). */
  id: number;
  /** The achievement's display name. */
  name: string;
  /** When it was earned (epoch ms), when the API reports it. */
  completedTimestamp?: number;
}

/** The achievements document distilled: aggregate totals plus the earned list (most-recent first). */
export interface AchievementSummary {
  totalQuantity: number;
  totalPoints: number;
  earned: EarnedAchievement[];
}

/**
 * Distill an achievements document: the aggregate `total_quantity` / `total_points`, and the earned
 * achievements as a flat list sorted most-recent first (entries without a `completed_timestamp` sort
 * last). Entries with no name are dropped. Totals default to 0.
 */
export function summarizeAchievements(data: CharacterAchievements): AchievementSummary {
  const earned: EarnedAchievement[] = [];
  for (const entry of data.achievements ?? []) {
    const name = entry.achievement?.name;
    if (!name) continue;
    earned.push({
      id: entry.achievement?.id ?? entry.id ?? 0,
      name,
      completedTimestamp: entry.completed_timestamp,
    });
  }
  earned.sort((a, b) => (b.completedTimestamp ?? 0) - (a.completedTimestamp ?? 0));

  return {
    totalQuantity: data.total_quantity ?? 0,
    totalPoints: data.total_points ?? 0,
    earned,
  };
}

/**
 * Filter an earned-achievement list by a case-insensitive name substring. A blank query returns the
 * list unchanged.
 */
export function filterAchievements(list: EarnedAchievement[], query: string): EarnedAchievement[] {
  const q = query.trim().toLowerCase();
  if (!q) return list;
  return list.filter((a) => a.name.toLowerCase().includes(q));
}
