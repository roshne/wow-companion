// Pure shaping over the character specializations document (#107): distills the active spec + its
// active talent loadout into a small, render-ready `ActiveBuild`, so the Spec sub-tab can show *how a
// character is built* without walking the full (deeply-nested) talent trees. No API call — everything
// comes from the already-fetched `/specializations` document.

import type { CharacterSpecializations } from "./queries";

/** The character's active spec + active loadout, distilled for display. */
export interface ActiveBuild {
  /** Active specialization name (`active_specialization.name`). */
  specName?: string;
  /** Active hero talent tree name, when the class/spec has one. */
  heroTreeName?: string;
  /** The active loadout's talent import string (`talent_loadout_code`). */
  loadoutCode?: string;
  /** How many class talents the active loadout selects. */
  classTalentCount: number;
  /** How many hero talents the active loadout selects. */
  heroTalentCount: number;
}

/**
 * Distill the active build from a specializations document: the active spec, its hero talent tree, and
 * the active loadout's import code + talent counts. Matches the loadout by `active_specialization.id`
 * (not merely the first spec), then the `is_active` loadout within that spec. Returns `null` when the
 * document has no active specialization — the caller renders an empty state. When the active spec has
 * no active loadout, the code is `undefined` and the counts are `0`.
 */
export function activeBuild(data: CharacterSpecializations): ActiveBuild | null {
  const active = data.active_specialization;
  if (!active) return null;

  const spec = (data.specializations ?? []).find((s) => s.specialization?.id === active.id);
  const loadout = (spec?.loadouts ?? []).find((l) => l.is_active);

  return {
    specName: active.name,
    heroTreeName: data.active_hero_talent_tree?.name,
    loadoutCode: loadout?.talent_loadout_code,
    classTalentCount: loadout?.selected_class_talents?.length ?? 0,
    heroTalentCount: loadout?.selected_hero_talents?.length ?? 0,
  };
}
