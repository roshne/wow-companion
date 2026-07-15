import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import type { BlizzardClient } from "../vendor/battlenet-wow-client";
import { loc } from "../lib/types";
import { connectedRealmsQuery, describeError } from "../lib/queries";

/**
 * Realm status via the connected-realm search (dynamic namespace). Auto-fetches on mount and whenever
 * the region changes (region is in the queryKey). Names come back localized — read with `loc()`.
 */
export function RealmStatus({ bnet }: { bnet: BlizzardClient }) {
  const [filter, setFilter] = useState("");
  const { data, isFetching, isError, error, refetch } = useQuery(connectedRealmsQuery(bnet));
  const rows = data ?? [];

  const sub = isError
    ? describeError(error)
    : isFetching && rows.length === 0
      ? "Loading realms…"
      : `${rows.length} connected realms · ${bnet.region.toUpperCase()}`;

  const q = filter.trim().toLowerCase();
  const view = rows
    .map((cr) => ({
      cr,
      names: (cr.realms ?? [])
        .map((r) => loc(r.name))
        .filter(Boolean)
        .join(", "),
    }))
    .filter((x) => !q || x.names.toLowerCase().includes(q));

  return (
    <section className="card">
      <div className="row" style={{ justifyContent: "space-between", flexWrap: "wrap" }}>
        <h2 style={{ margin: 0 }}>Realm Status</h2>
        <div className="row">
          <input
            placeholder="Filter…"
            value={filter}
            onChange={(e) => setFilter(e.currentTarget.value)}
          />
          <button onClick={() => void refetch()} disabled={isFetching}>
            {isFetching ? "…" : "Refresh"}
          </button>
        </div>
      </div>
      {sub && <p className="muted">{sub}</p>}
      <div style={{ overflowX: "auto" }}>
        <table className="grid">
          <thead>
            <tr>
              <th>Realm(s)</th>
              <th>Status</th>
              <th>Population</th>
              <th>Queue</th>
            </tr>
          </thead>
          <tbody>
            {view.map(({ cr, names }) => {
              const up = (cr.status?.type ?? "").toUpperCase() === "UP";
              return (
                <tr key={cr.id}>
                  <td>{names || `#${cr.id}`}</td>
                  <td className={up ? "up" : "down"}>
                    {loc(cr.status?.name) || cr.status?.type || "?"}
                  </td>
                  <td>{loc(cr.population?.name) || cr.population?.type || "—"}</td>
                  <td>{cr.has_queue ? "Yes" : "No"}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}
