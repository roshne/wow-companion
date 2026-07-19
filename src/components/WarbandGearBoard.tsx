import type { Region } from "../vendor/battlenet-wow-client";
import type { WarbandCharacter } from "../lib/warband";
import { useWarbandGear, type WarbandGear } from "../lib/useWarbandGear";
import { BOARD_SLOTS } from "../lib/slots";
import { ILVL_OUTLIER_THRESHOLD } from "../lib/gearCheck";
import { CLASS_COLORS } from "../lib/wow";
import { describeError } from "../lib/queries";
import { SkeletonLines } from "./Skeleton";
import { EmptyState } from "./EmptyState";

/**
 * The warband gear board: a characters × slots item-level matrix. Each row is a warband character and
 * each column an equipment slot; a cell shows that slot's item level, subtly tinted when it's well
 * below the character's own average (a relative-strength cue — explicit weakest-slot callouts are a
 * sibling issue). Best-effort per character: a row whose equipment failed to load says so.
 */
export function WarbandGearBoard({
  characters,
  region,
}: {
  characters: WarbandCharacter[];
  region: Region;
}) {
  const gear = useWarbandGear(characters, region);

  if (gear.isPending) return <SkeletonLines lines={6} />;
  if (gear.isError)
    return <EmptyState message={describeError(gear.error)} onRetry={() => void gear.refetch()} />;

  return (
    <div style={{ overflowX: "auto" }}>
      <table className="grid warband-board" aria-label="Warband gear by slot">
        <thead>
          <tr>
            <th>Character</th>
            {BOARD_SLOTS.map((s) => (
              <th key={s.type} className="warband-board-slot">
                {s.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {gear.data.map((g) => (
            <WarbandBoardRow key={`${g.character.realm}/${g.character.name}`} gear={g} />
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** One character's row: the class-colored name, then a per-slot item-level cell (or a failed notice). */
function WarbandBoardRow({ gear }: { gear: WarbandGear }) {
  const { character } = gear;
  const color = (character.classKey && CLASS_COLORS[character.classKey]) || undefined;
  const name = (
    <th scope="row" className="warband-board-name" style={{ color }} title={character.realm}>
      {character.name}
    </th>
  );

  if (gear.failed) {
    return (
      <tr>
        {name}
        <td colSpan={BOARD_SLOTS.length} className="muted">
          Couldn't load gear
        </td>
      </tr>
    );
  }

  const average = boardAverage(gear.itemLevels);
  return (
    <tr>
      {name}
      {BOARD_SLOTS.map((s) => {
        const value = gear.itemLevels[s.type];
        const low =
          typeof value === "number" && average !== null && average - value > ILVL_OUTLIER_THRESHOLD;
        return (
          <td
            key={s.type}
            className={low ? "warband-board-cell warband-board-cell-low" : "warband-board-cell"}
          >
            {value ?? "—"}
          </td>
        );
      })}
    </tr>
  );
}

/** The character's average equipped item level, or null when they have no rated gear. */
function boardAverage(itemLevels: Record<string, number>): number | null {
  const values = Object.values(itemLevels);
  if (values.length === 0) return null;
  return values.reduce((sum, v) => sum + v, 0) / values.length;
}
