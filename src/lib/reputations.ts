// Pure shaping over the character reputations document (#108): distills each faction into a
// render-ready row (name, standing/renown label, progress) for the Reputations sub-tab, dropping
// factions with no name. No API call — everything comes from the already-fetched `/reputations` doc.

import type { CharacterReputations } from "./queries";

/** One faction's reputation, distilled to display strings for the Reputations table. */
export interface ReputationRow {
  /** Faction display name. */
  factionName: string;
  /** Standing label — `standing.name` (e.g. "Exalted"), a "Renown N" fallback, or "—". */
  standing: string;
  /** Progress within the current standing — "value / max" (localized), or "—" when unavailable. */
  progress: string;
}

/**
 * Distill a reputations document into display rows, one per faction that has a name (nameless entries
 * are dropped). The standing is `standing.name`, falling back to `Renown {renown_level}` when a renown
 * level is present without a name, else "—"; progress is `value / max` (localized) when both are
 * present. Document order is preserved. Returns `[]` for a document with no reputations.
 */
export function reputationRows(data: CharacterReputations): ReputationRow[] {
  const rows: ReputationRow[] = [];
  for (const rep of data.reputations ?? []) {
    const factionName = rep.faction?.name;
    if (!factionName) continue;

    const s = rep.standing;
    const standing =
      s?.name ?? (typeof s?.renown_level === "number" ? `Renown ${s.renown_level}` : "—");
    const progress =
      typeof s?.value === "number" && typeof s?.max === "number"
        ? `${s.value.toLocaleString()} / ${s.max.toLocaleString()}`
        : "—";

    rows.push({ factionName, standing, progress });
  }
  return rows;
}
