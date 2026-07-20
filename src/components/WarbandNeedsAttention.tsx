import type { WarbandRow } from "../lib/useWarbandGear";
import type { GearFindingKind } from "../lib/gearCheck";
import { rollUpAttention } from "../lib/warbandAttention";

/** Human labels (singular, plural) for each fix kind, for the by-kind breakdown. */
const KIND_LABELS: Record<GearFindingKind, [singular: string, plural: string]> = {
  "missing-enchant": ["missing enchant", "missing enchants"],
  "empty-socket": ["empty socket", "empty sockets"],
  "missing-off-hand": ["missing off-hand", "missing off-hands"],
  "ilvl-outlier": ["low-item-level slot", "low-item-level slots"],
};

const plural = (n: number, singular: string, pluralForm: string) =>
  n === 1 ? singular : pluralForm;

/**
 * The warband-wide "needs attention" summary: the M1 gear-fix engine rolled up across every alt
 * (via {@link rollUpAttention}), so the whole warband's gear state reads at a glance — a headline count
 * plus a by-kind breakdown, or an "all set" note when clean. Renders nothing until at least one
 * character has resolved (nothing to summarize yet).
 */
export function WarbandNeedsAttention({ rows }: { rows: WarbandRow[] }) {
  const { totalFixes, charactersNeedingAttention, resolvedCount, byKind } = rollUpAttention(rows);

  if (resolvedCount === 0) return null;

  if (totalFixes === 0) {
    return (
      <p className="warband-attention warband-attention-clean">
        All set — no gear fixes across the warband.
      </p>
    );
  }

  const breakdown = byKind
    .map(
      ({ kind, count }) => `${count} ${plural(count, KIND_LABELS[kind][0], KIND_LABELS[kind][1])}`,
    )
    .join(" · ");

  return (
    <p className="warband-attention warband-attention-issues">
      <strong>{totalFixes.toLocaleString()}</strong> {plural(totalFixes, "fix", "fixes")} across{" "}
      {charactersNeedingAttention} {plural(charactersNeedingAttention, "character", "characters")}
      {breakdown ? <span className="muted"> — {breakdown}</span> : null}
    </p>
  );
}
