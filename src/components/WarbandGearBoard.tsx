import type { Region } from "../vendor/battlenet-wow-client";
import type { WarbandCharacter } from "../lib/warband";
import { useWarbandGear, weakestSlots, type WarbandRow } from "../lib/useWarbandGear";
import { BOARD_SLOTS } from "../lib/slots";
import { ILVL_OUTLIER_THRESHOLD } from "../lib/gearCheck";
import { CLASS_COLORS } from "../lib/wow";
import { describeError } from "../lib/queries";
import { EmptyState } from "./EmptyState";

/**
 * The warband gear board: a characters × slots item-level matrix. Each row is a warband character and
 * each column an equipment slot; a cell shows that slot's item level, subtly tinted when it's well
 * below the character's own average (a relative-strength cue). Rows stream in independently — a row
 * shows "Loading…" until its own equipment fetch settles — so the board fills as each character
 * resolves rather than waiting on the whole roster. Best-effort per character: a row whose equipment
 * failed to load says so.
 */
export function WarbandGearBoard({
  characters,
  region,
}: {
  characters: WarbandCharacter[];
  region: Region;
}) {
  const { rows, error, refetch } = useWarbandGear(characters, region);

  if (error) return <EmptyState message={describeError(error)} onRetry={() => void refetch()} />;

  return (
    <div style={{ overflowX: "auto" }}>
      <table className="grid warband-board" aria-label="Warband gear by slot">
        <thead>
          <tr>
            <th>Character</th>
            <th className="warband-board-slot" title="Largest equipped set (tier-set proxy)">
              Set
            </th>
            {BOARD_SLOTS.map((s) => (
              <th key={s.type} className="warband-board-slot">
                {s.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <WarbandBoardRow key={`${row.character.realm}/${row.character.name}`} row={row} />
          ))}
        </tbody>
      </table>
    </div>
  );
}

/**
 * One character's row: the class-colored name (always available from the roster), then a per-slot
 * item-level cell — or a "Loading…" notice while its fetch is in flight, or a "Couldn't load gear"
 * notice if it failed.
 */
function WarbandBoardRow({ row }: { row: WarbandRow }) {
  const { character, gear } = row;
  const color = (character.classKey && CLASS_COLORS[character.classKey]) || undefined;
  const name = (
    <th scope="row" className="warband-board-name" style={{ color }} title={character.realm}>
      {character.name}
    </th>
  );

  if (!gear) {
    return (
      <tr>
        {name}
        <td colSpan={BOARD_SLOTS.length + 1} className="muted">
          Loading…
        </td>
      </tr>
    );
  }

  if (gear.failed) {
    return (
      <tr>
        {name}
        <td colSpan={BOARD_SLOTS.length + 1} className="muted">
          Couldn't load gear
        </td>
      </tr>
    );
  }

  const average = boardAverage(gear.itemLevels);
  const weakest = new Set(weakestSlots(gear.itemLevels));
  const tier = gear.tierSet;
  return (
    <tr>
      {name}
      <td className="warband-board-set">
        {tier && tier.pieces >= 2 ? <span title={tier.name}>{tier.pieces}pc</span> : "—"}
      </td>
      {BOARD_SLOTS.map((s) => {
        const value = gear.itemLevels[s.type];
        const low =
          typeof value === "number" && average !== null && average - value > ILVL_OUTLIER_THRESHOLD;
        const className = [
          "warband-board-cell",
          low ? "warband-board-cell-low" : "",
          weakest.has(s.type) ? "warband-board-cell-weakest" : "",
        ]
          .filter(Boolean)
          .join(" ");
        return (
          <td
            key={s.type}
            className={className}
            title={weakest.has(s.type) ? "Weakest slot" : undefined}
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
