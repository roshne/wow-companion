import { useEffect, useState } from "react";
import type { BlizzardClient } from "../vendor/battlenet-wow-client";
import { loc, type ConnectedRealm, type ConnectedRealmSearch } from "../lib/types";

/**
 * Realm status via the connected-realm search (dynamic namespace). The endpoint takes no `locale`,
 * so names come back localized — we read them with `loc()`. Paginates with `_page`.
 */
export function RealmStatus({ bnet }: { bnet: BlizzardClient }) {
  const [rows, setRows] = useState<ConnectedRealm[]>([]);
  const [sub, setSub] = useState("");
  const [busy, setBusy] = useState(false);
  const [filter, setFilter] = useState("");

  async function load() {
    setBusy(true);
    setRows([]);
    setSub("Loading realms…");
    try {
      const all: ConnectedRealm[] = [];
      let page = 1;
      let pageCount = 1;
      do {
        const { data, response } = await bnet.api.GET("/data/wow/search/connected-realm", {
          params: { query: { namespace: bnet.namespace("dynamic"), orderby: "id", _page: page } },
        });
        if (!response.ok) {
          setSub(`Failed (HTTP ${response.status}).`);
          return;
        }
        const s = data as unknown as ConnectedRealmSearch;
        pageCount = s.pageCount ?? 1;
        for (const r of s.results ?? []) if (r.data) all.push(r.data);
        page++;
      } while (page <= pageCount && page <= 20);
      setRows(all);
      setSub(`${all.length} connected realms · ${bnet.region.toUpperCase()}`);
    } catch (e) {
      setSub(`Error: ${String(e)}`);
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bnet]);

  const q = filter.trim().toLowerCase();
  const view = rows
    .map((cr) => ({ cr, names: (cr.realms ?? []).map((r) => loc(r.name)).filter(Boolean).join(", ") }))
    .filter((x) => !q || x.names.toLowerCase().includes(q));

  return (
    <section className="card">
      <div className="row" style={{ justifyContent: "space-between", flexWrap: "wrap" }}>
        <h2 style={{ margin: 0 }}>Realm Status</h2>
        <div className="row">
          <input placeholder="Filter…" value={filter} onChange={(e) => setFilter(e.currentTarget.value)} />
          <button onClick={() => void load()} disabled={busy}>
            {busy ? "…" : "Refresh"}
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
                  <td className={up ? "up" : "down"}>{loc(cr.status?.name) || cr.status?.type || "?"}</td>
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
