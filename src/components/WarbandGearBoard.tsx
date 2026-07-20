import { useMemo, useState } from "react";
import type { Region } from "../vendor/battlenet-wow-client";
import type { WarbandCharacter } from "../lib/warband";
import { useWarbandGear, weakestSlots, type WarbandRow } from "../lib/useWarbandGear";
import {
  sortWarbandRows,
  filterWarbandRows,
  type WarbandSort,
  type WarbandSortKey,
} from "../lib/warbandSort";
import { BOARD_SLOTS } from "../lib/slots";
import { ILVL_OUTLIER_THRESHOLD } from "../lib/gearCheck";
import { CLASS_COLORS } from "../lib/wow";
import { describeError } from "../lib/queries";
import { EmptyState } from "./EmptyState";
import { WarbandNeedsAttention } from "./WarbandNeedsAttention";

/** The sortable dimensions and their default direction (strongest / most-flagged first for numbers). */
const SORT_OPTIONS: { key: WarbandSortKey; label: string; defaultDir: 1 | -1 }[] = [
  { key: "name", label: "Name", defaultDir: 1 },
  { key: "itemLevel", label: "Item level", defaultDir: -1 },
  { key: "issues", label: "Issues", defaultDir: -1 },
  { key: "class", label: "Class", defaultDir: 1 },
];

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
  const [sort, setSort] = useState<WarbandSort>({ key: "itemLevel", dir: -1 });
  const [classKey, setClassKey] = useState<string | null>(null);
  const [role, setRole] = useState<string | null>(null);

  // Filter options come from the roster (class/role are known even before a row's gear resolves).
  const classOptions = useMemo(() => {
    const byKey = new Map<string, string>();
    for (const r of rows) {
      const key = r.character.classKey;
      if (key && !byKey.has(key)) byKey.set(key, r.character.className ?? key);
    }
    return [...byKey.entries()].sort((a, b) => a[1].localeCompare(b[1]));
  }, [rows]);
  const roleOptions = useMemo(() => {
    const set = new Set<string>();
    for (const r of rows) if (r.character.role) set.add(r.character.role);
    return [...set].sort();
  }, [rows]);

  const shown = useMemo(
    () => sortWarbandRows(filterWarbandRows(rows, { classKey, role }), sort),
    [rows, classKey, role, sort],
  );

  const toggleSort = (key: WarbandSortKey) =>
    setSort((s) =>
      s.key === key
        ? { key, dir: s.dir === 1 ? -1 : 1 }
        : { key, dir: SORT_OPTIONS.find((o) => o.key === key)?.defaultDir ?? 1 },
    );

  if (error) return <EmptyState message={describeError(error)} onRetry={() => void refetch()} />;

  return (
    <>
      <WarbandNeedsAttention rows={rows} />
      <div className="warband-controls">
        <label className="warband-filter">
          <span className="muted">Class</span>
          <select
            value={classKey ?? ""}
            onChange={(e) => setClassKey(e.target.value || null)}
            aria-label="Filter by class"
          >
            <option value="">All classes</option>
            {classOptions.map(([key, label]) => (
              <option key={key} value={key}>
                {label}
              </option>
            ))}
          </select>
        </label>
        <label className="warband-filter">
          <span className="muted">Role</span>
          <select
            value={role ?? ""}
            onChange={(e) => setRole(e.target.value || null)}
            aria-label="Filter by role"
          >
            <option value="">All roles</option>
            {roleOptions.map((r) => (
              <option key={r} value={r}>
                {r}
              </option>
            ))}
          </select>
        </label>
        <div className="warband-sort" role="group" aria-label="Sort">
          <span className="muted">Sort</span>
          {SORT_OPTIONS.map(({ key, label }) => {
            const active = sort.key === key;
            return (
              <button
                key={key}
                type="button"
                className={`ghost warband-sort-btn${active ? " active" : ""}`}
                aria-pressed={active}
                onClick={() => toggleSort(key)}
              >
                {label}
                {active ? (sort.dir === 1 ? " ▲" : " ▼") : ""}
              </button>
            );
          })}
        </div>
      </div>
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
            {shown.map((row) => (
              <WarbandBoardRow key={`${row.character.realm}/${row.character.name}`} row={row} />
            ))}
          </tbody>
        </table>
      </div>
    </>
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
