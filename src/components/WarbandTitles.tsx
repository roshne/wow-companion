import { useDeferredValue, useId, useMemo, useState } from "react";
import type { WarbandData } from "../lib/warband";
import { buildTitleBoard, filterTitles } from "../lib/titles";

/** Rows rendered at once. The catalog runs to ~700 titles; the rest are reachable by searching. */
const RENDER_CAP = 200;

type Filter = "all" | "earned" | "unearned";

const FILTERS: { key: Filter; label: string }[] = [
  { key: "all", label: "All" },
  { key: "earned", label: "Earned" },
  { key: "unearned", label: "Unearned" },
];

function when(epoch: number | null): string {
  if (epoch == null) return "—";
  return new Date(epoch * 1000).toLocaleString();
}

/**
 * Every player title, earned and unearned, across the warband.
 *
 * Built entirely from the local export. The addon holds each character's earned titles *and* an
 * account-wide catalog of the whole title universe — and that catalog is the only way to know what's
 * **missing**, since Blizzard's REST API exposes no title catalogue to diff against. Using the API
 * here would cost one request per character to re-derive what the addon already has.
 *
 * Without a catalog the unearned set is unknowable, so it isn't claimed: the view says so and falls
 * back to the earned list, which is still useful.
 */
export function WarbandTitles({ data }: { data: WarbandData | null }) {
  const [filter, setFilter] = useState<Filter>("all");
  const [query, setQuery] = useState("");
  const searchId = useId();

  const board = useMemo(() => buildTitleBoard(data), [data]);
  // Filtering scans hundreds of rows on every keystroke; defer it so typing never blocks, the same
  // treatment the achievements browser got in #136.
  const deferredQuery = useDeferredValue(query);
  const visible = useMemo(
    () => filterTitles(board.rows, filter, deferredQuery),
    [board.rows, filter, deferredQuery],
  );

  if (board.rows.length === 0) {
    return <p className="muted">No titles recorded yet.</p>;
  }

  const shown = visible.slice(0, RENDER_CAP);

  return (
    <>
      <p className="muted" style={{ marginTop: 0 }}>
        <strong>{board.earnedCount.toLocaleString()} earned</strong>
        {board.hasCatalog ? (
          <>
            {" of "}
            {board.rows.length.toLocaleString()}
            {" · "}
            {board.unearnedCount.toLocaleString()} still to earn
          </>
        ) : (
          // Saying "0 unearned" here would be a claim the data can't support.
          <span> · no catalog recorded, so unearned titles are unknown</span>
        )}
        {board.scannedBy ? (
          <span title={`Titles are account-wide, so one character's scan serves the warband.`}>
            {" · catalog from "}
            {board.scannedBy}
            {" at "}
            {when(board.scannedAt)}
          </span>
        ) : null}
        {board.locale && board.locale !== "enUS" ? <> · names in {board.locale}</> : null}
      </p>

      {board.featured.length > 0 ? (
        // Collapsed by default: with a full warband this runs to dozens of entries and would push
        // the table itself off-screen, which is what the view is actually for.
        <details className="titles-featured">
          <summary className="muted">
            Currently displayed titles ({board.featured.length.toLocaleString()})
          </summary>
          <p className="muted">
            {board.featured.map(([who, title], i) => (
              <span key={who}>
                {i > 0 ? ", " : ""}
                <strong>{who}</strong> — {title}
              </span>
            ))}
          </p>
        </details>
      ) : null}

      <div className="row" style={{ gap: "0.5rem", marginBottom: "0.5rem", flexWrap: "wrap" }}>
        <div className="row" style={{ gap: "0.25rem" }} role="group" aria-label="Title filter">
          {FILTERS.map((f) => (
            <button
              key={f.key}
              className={filter === f.key ? "" : "ghost"}
              aria-pressed={filter === f.key}
              onClick={() => setFilter(f.key)}
            >
              {f.label}
            </button>
          ))}
        </div>
        <label htmlFor={searchId} className="muted">
          Search
        </label>
        <input
          id={searchId}
          type="search"
          value={query}
          placeholder="Title name"
          onChange={(e) => setQuery(e.target.value)}
        />
      </div>

      {shown.length === 0 ? (
        <p className="muted">No titles match.</p>
      ) : (
        <div style={{ overflowX: "auto" }}>
          <table className="grid">
            <thead>
              <tr>
                <th>Title</th>
                <th>Earned by</th>
              </tr>
            </thead>
            <tbody>
              {shown.map((row) => (
                <tr key={row.id} className={row.earned ? undefined : "muted"}>
                  <td>{row.name}</td>
                  <td>
                    {row.earnedBy.length === 0 ? (
                      <span className="muted">—</span>
                    ) : (
                      row.earnedBy.join(", ")
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {visible.length > shown.length ? (
        <p className="muted">
          Showing {shown.length.toLocaleString()} of {visible.length.toLocaleString()} — search to
          narrow.
        </p>
      ) : null}
    </>
  );
}
