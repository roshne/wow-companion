import { useId, useMemo } from "react";
import type { CharacterEquipment } from "../lib/queries";
import type { GearFinding } from "../lib/gearCheck";
import { prioritizeGearFixes, slotItemLevels } from "../lib/gearFix";

/**
 * The "fix these" panel: the character's gear-check findings turned into a prioritized, most-impactful
 * -first checklist (via {@link prioritizeGearFixes}), so the Gear tab says *what to upgrade next* — not
 * just what's flagged. Sits beside the gear-check summary. Renders nothing for a clean character — the
 * summary's "All good" already covers that state, so there's no second clean-state line.
 *
 * Each row is the recommendation string, in impact order, with a decorative severity dot (the text
 * carries the meaning; the dot and the list position are supplementary).
 */
export function FixThesePanel({
  findings,
  equipment,
}: {
  findings: GearFinding[];
  equipment: CharacterEquipment;
}) {
  const fixes = useMemo(
    () => prioritizeGearFixes(findings, slotItemLevels(equipment)),
    [findings, equipment],
  );
  const titleId = useId();

  if (fixes.length === 0) return null;

  return (
    <section className="fix-these" aria-labelledby={titleId}>
      <p className="fix-these-title" id={titleId}>
        Fix these
      </p>
      <ol className="fix-these-list">
        {fixes.map((fix, i) => (
          <li key={`${fix.slot}-${fix.finding.kind}-${i}`} className="fix-these-item">
            <span
              className={`fix-these-dot fix-these-dot-${fix.finding.severity}`}
              aria-hidden="true"
            />
            {fix.recommendation}
          </li>
        ))}
      </ol>
    </section>
  );
}
