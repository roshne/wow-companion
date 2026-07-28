import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import type { Region } from "../vendor/battlenet-wow-client";
import type { WarbandData } from "../lib/warband";
import type { KeystoneRow } from "../lib/keystoneBoard";
import { buildKeystoneBoard } from "../lib/keystoneBoard";
import { makeClient } from "../lib/bnet";
import { keystoneDungeonsQuery } from "../lib/queries";
import { CLASS_COLORS } from "../lib/wow";

/** Short difficulty labels, matching the addon's own vocabulary. */
const DIFFICULTY: Record<number, string> = {
  17: "LFR",
  14: "N",
  15: "H",
  16: "M",
  23: "M",
};

const plural = (n: number, one: string, many: string) => (n === 1 ? one : many);

function when(epoch: number | null): string {
  if (epoch == null) return "—";
  return new Date(epoch * 1000).toLocaleString();
}

/** The held keystone: level plus dungeon, degrading to the raw id and then to a dash. */
function Keystone({ row }: { row: KeystoneRow }) {
  if (row.keystoneLevel == null) return <span className="muted">—</span>;
  const dungeon =
    row.dungeonName ?? (row.keystoneMap != null ? `Dungeon ${row.keystoneMap}` : "Unknown dungeon");
  return (
    <span style={{ whiteSpace: "nowrap" }}>
      <strong>+{row.keystoneLevel}</strong> <span className="muted">{dungeon}</span>
    </span>
  );
}

function Lockouts({ row }: { row: KeystoneRow }) {
  if (row.locks.length === 0) return <span className="muted">—</span>;
  return (
    <>
      {row.locks.map((l, i) => (
        <span key={`${l.instanceId}-${l.difficultyId}`} style={{ whiteSpace: "nowrap" }}>
          {i > 0 ? <span className="muted"> · </span> : null}
          {l.name ?? `Instance ${l.instanceId}`}{" "}
          <span className="muted">
            {DIFFICULTY[l.difficultyId] ?? `D${l.difficultyId}`} {l.progress ?? 0}/{l.total ?? "?"}
          </span>
        </span>
      ))}
    </>
  );
}

/**
 * Keystones and lockouts across the warband — who's holding what key, how far into the week's M+
 * count they are, and what they're saved to.
 *
 * The one API join here is the keystone's dungeon **name**, resolved from the Mythic+ dungeon index:
 * the addon records a challenge-map id and that endpoint is keyed by the same ids. Lockout instance
 * ids are deliberately *not* joined to `journal-instance` — they come from `GetSavedInstanceInfo`, a
 * different id space, so the lookup would silently return the wrong instance. The addon already
 * stores each lockout's name, so its own value is used instead.
 *
 * As with the vault board, rows whose data predates the weekly reset are marked: a key recorded
 * before the reset has already been replaced in game.
 */
export function WarbandKeystoneBoard({
  data,
  region,
}: {
  data: WarbandData | null;
  region: Region;
}) {
  const bnet = useMemo(() => makeClient(region), [region]);
  // Best-effort enrichment: if this fails the board still renders, with dungeon ids instead of names.
  const { data: dungeons } = useQuery(keystoneDungeonsQuery(bnet));
  const board = useMemo(() => buildKeystoneBoard(data, dungeons), [data, dungeons]);

  if (board.rows.length === 0) {
    return <p className="muted">No keystones or lockouts recorded this week.</p>;
  }

  const stale = board.rows.filter((r) => r.stale).length;

  return (
    <>
      <p className="muted" style={{ marginTop: 0 }}>
        {board.withKeystone > 0 ? (
          <strong>
            {board.withKeystone} {plural(board.withKeystone, "keystone", "keystones")} held
          </strong>
        ) : (
          "No keystones held"
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
              <th>Keystone</th>
              <th>M+ this week</th>
              <th>Lockouts</th>
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
                    {row.stale ? (
                      <span
                        className="muted"
                        title={`Last scanned ${when(c.lastRefresh)}, before this week's reset — this key is last week's.`}
                      >
                        {" "}
                        · not seen this week
                      </span>
                    ) : null}
                  </td>
                  <td>
                    <Keystone row={row} />
                  </td>
                  <td>
                    {row.dungeonsDone != null
                      ? `${row.dungeonsDone}${row.dungeonsMax != null ? ` / ${row.dungeonsMax}` : ""}`
                      : "—"}
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
