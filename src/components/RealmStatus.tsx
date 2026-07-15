import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import type { BlizzardClient } from "../vendor/battlenet-wow-client";
import { loc } from "../lib/types";
import { toRealmSlug } from "../lib/slug";
import { connectedRealmsQuery, describeError } from "../lib/queries";
import { warbandQuery } from "../lib/warband";
import {
  loadFavoriteRealms,
  toggleFavoriteRealmRow,
  ensureRealmFavorites,
  hasSeededWarband,
  markWarbandSeeded,
  type FavoriteRealm,
} from "../lib/persist";

/** Join the distinct, non-empty values across a connected realm's constituent realms. */
function distinctJoin(values: (string | undefined)[]): string {
  return [...new Set(values.filter((v): v is string => Boolean(v)))].join(", ");
}

/**
 * Realm status via the connected-realm search (dynamic namespace). Auto-fetches on mount and whenever
 * the region changes (region is in the queryKey). Names come back localized — read with `loc()`.
 */
export function RealmStatus({ bnet }: { bnet: BlizzardClient }) {
  const [filter, setFilter] = useState("");
  const [realmFavorites, setRealmFavorites] = useState<FavoriteRealm[]>(loadFavoriteRealms);
  const { data, isFetching, isError, error, refetch } = useQuery(connectedRealmsQuery(bnet));
  const warband = useQuery(warbandQuery());
  const rows = data ?? [];

  // One-time per region: pin the realms where the user's warband characters live. Intersecting the
  // warband's realm slugs with the realms that actually exist in this region means a warband from a
  // different region seeds nothing (no cross-region false pins).
  useEffect(() => {
    if (!data || !warband.data || hasSeededWarband(bnet.region)) return;
    const realmSlugsInRegion = new Set(
      data.flatMap((cr) => (cr.realms ?? []).map((r) => r.slug).filter((s): s is string => !!s)),
    );
    const warbandSlugs = [
      ...new Set(warband.data.characters.map((c) => toRealmSlug(c.realm))),
    ].filter((slug) => realmSlugsInRegion.has(slug));
    if (warbandSlugs.length) setRealmFavorites(ensureRealmFavorites(bnet.region, warbandSlugs));
    markWarbandSeeded(bnet.region);
  }, [data, warband.data, bnet.region]);

  const favSlugs = new Set(
    realmFavorites.filter((f) => f.region === bnet.region).map((f) => f.realmSlug),
  );

  const sub = isError
    ? describeError(error)
    : isFetching && rows.length === 0
      ? "Loading realms…"
      : `${rows.length} connected realms · ${bnet.region.toUpperCase()}`;

  const q = filter.trim().toLowerCase();
  const view = rows
    .map((cr) => {
      const realms = cr.realms ?? [];
      const slugs = realms.map((r) => r.slug).filter((s): s is string => !!s);
      return {
        cr,
        slugs,
        favorited: slugs.some((s) => favSlugs.has(s)),
        names: realms
          .map((r) => loc(r.name))
          .filter(Boolean)
          .join(", "),
        type: distinctJoin(realms.map((r) => loc(r.type?.name) || r.type?.type)),
        category: distinctJoin(realms.map((r) => loc(r.category))),
        timezone: distinctJoin(realms.map((r) => r.timezone)),
      };
    })
    .filter((x) => !q || x.names.toLowerCase().includes(q))
    .sort((a, b) => Number(b.favorited) - Number(a.favorited));

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
              <th aria-label="Favorite"></th>
              <th>Realm(s)</th>
              <th>Type</th>
              <th>Category</th>
              <th>Status</th>
              <th>Population</th>
              <th>Timezone</th>
              <th>Queue</th>
            </tr>
          </thead>
          <tbody>
            {view.map(({ cr, slugs, favorited, names, type, category, timezone }) => {
              const up = (cr.status?.type ?? "").toUpperCase() === "UP";
              return (
                <tr key={cr.id}>
                  <td>
                    <button
                      type="button"
                      className="ghost"
                      aria-label={favorited ? "Unpin realm" : "Pin realm"}
                      aria-pressed={favorited}
                      onClick={() => setRealmFavorites(toggleFavoriteRealmRow(bnet.region, slugs))}
                    >
                      {favorited ? "★" : "☆"}
                    </button>
                  </td>
                  <td>{names || `#${cr.id}`}</td>
                  <td>{type || "—"}</td>
                  <td>{category || "—"}</td>
                  <td className={up ? "up" : "down"}>
                    {loc(cr.status?.name) || cr.status?.type || "?"}
                  </td>
                  <td>{loc(cr.population?.name) || cr.population?.type || "—"}</td>
                  <td>{timezone || "—"}</td>
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
