import { useMemo } from "react";
import type { WarbandData } from "../lib/warband";
import type { TrackProgress, VaultRow } from "../lib/vaultBoard";
import { buildVaultBoard } from "../lib/vaultBoard";
import { CLASS_COLORS } from "../lib/wow";

/** Short difficulty labels, matching the addon's own vocabulary. */
const RAID_DIFFICULTY: Record<number, string> = {
  17: "LFR",
  14: "N",
  15: "H",
  16: "M",
};

const plural = (n: number, one: string, many: string) => (n === 1 ? one : many);

/** Format a server-time epoch as a local date-time, or an em dash when absent. */
function when(epoch: number | null): string {
  if (epoch == null) return "—";
  return new Date(epoch * 1000).toLocaleString();
}

/**
 * One track's three slots as pips. A filled pip is an unlocked reward; each carries its
 * threshold/progress and reward item level in a title, so the detail is available without
 * crowding the grid.
 */
function Pips({ track, label }: { track: TrackProgress; label: string }) {
  if (track.total === 0) return <span className="muted">—</span>;
  return (
    <span aria-label={`${label}: ${track.unlocked} of ${track.total} unlocked`}>
      {track.slots.map((s, i) => (
        <span
          key={i}
          className={s.complete ? "vault-pip vault-pip-on" : "vault-pip"}
          aria-hidden="true"
          title={
            s.complete
              ? `${s.progress}/${s.threshold} — unlocked${s.ilvl ? `, item level ${s.ilvl}` : ""}`
              : `${s.progress}/${s.threshold} — locked`
          }
        >
          {s.complete ? "●" : "○"}
        </span>
      ))}
    </span>
  );
}

/** This week's raid lockouts, most prestigious first, as "Name N 3/8". */
function Lockouts({ row }: { row: VaultRow }) {
  if (row.raidLocks.length === 0) return <span className="muted">—</span>;
  return (
    <>
      {row.raidLocks.map((l, i) => (
        <span key={`${l.instanceId}-${l.difficultyId}`} style={{ whiteSpace: "nowrap" }}>
          {i > 0 ? <span className="muted"> · </span> : null}
          {l.name ?? `Instance ${l.instanceId}`}{" "}
          <span className="muted">
            {RAID_DIFFICULTY[l.difficultyId] ?? `D${l.difficultyId}`} {l.progress ?? 0}/
            {l.total ?? "?"}
          </span>
        </span>
      ))}
    </>
  );
}

/**
 * The warband-wide Great Vault board: one row per max-level character, the three tracks as pips, and
 * this week's raid lockouts alongside (same weekly cadence, same parse).
 *
 * The addon database is written only at logout or `/reload`, so a character not played since the
 * weekly reset carries *last* week's vault. Those rows are marked rather than rendered as an empty
 * vault — otherwise "you've done nothing this week" and "we haven't seen you this week" look
 * identical, and the second one isn't actionable.
 */
export function WarbandVaultBoard({ data }: { data: WarbandData | null }) {
  const board = useMemo(() => buildVaultBoard(data), [data]);

  if (board.rows.length === 0) {
    return (
      <p className="muted">
        No Great Vault data recorded yet
        {board.levellingExcluded > 0
          ? ` (${board.levellingExcluded} ${plural(board.levellingExcluded, "character is", "characters are")} below the level cap)`
          : ""}
        .
      </p>
    );
  }

  const unclaimed = board.rows.filter((r) => r.hasUnclaimed).length;
  const stale = board.rows.filter((r) => r.stale).length;

  return (
    <>
      <p className="muted" style={{ marginTop: 0 }}>
        {unclaimed > 0 ? (
          <strong>
            {unclaimed} {plural(unclaimed, "character has", "characters have")} a reward waiting
          </strong>
        ) : (
          "No rewards waiting"
        )}
        {" · week began "}
        {when(board.weekStart)}
        {" · data as of "}
        {when(board.lastRefresh)}
        {stale > 0 ? ` · ${stale} not seen since the reset` : ""}
      </p>

      <div style={{ overflowX: "auto" }}>
        <table className="grid">
          <thead>
            <tr>
              <th>Character</th>
              <th>Raid</th>
              <th>Dungeons</th>
              <th>World</th>
              <th>Raid lockouts</th>
            </tr>
          </thead>
          <tbody>
            {board.rows.map((row) => {
              const c = row.character;
              const color = (c.classKey && CLASS_COLORS[c.classKey]) || undefined;
              return (
                <tr key={c.guid ?? `${c.name}-${c.realm}`} className={row.stale ? "muted" : ""}>
                  <td style={{ whiteSpace: "nowrap" }}>
                    <span style={{ color, fontWeight: 600 }}>{c.name}</span>
                    {row.hasUnclaimed ? (
                      <span
                        className="vault-badge"
                        title="A Great Vault reward is waiting to be collected"
                      >
                        {" "}
                        reward waiting
                      </span>
                    ) : null}
                    {row.stale ? (
                      <span
                        className="muted"
                        title={`Last scanned ${when(c.lastRefresh)}, before this week's reset — these figures are last week's.`}
                      >
                        {" "}
                        · not seen this week
                      </span>
                    ) : null}
                  </td>
                  <td>
                    <Pips track={row.raid} label="Raid" />
                  </td>
                  <td>
                    <Pips track={row.dungeons} label="Dungeons" />
                  </td>
                  <td>
                    <Pips track={row.world} label="World" />
                  </td>
                  <td>
                    <Lockouts row={row} />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </>
  );
}
