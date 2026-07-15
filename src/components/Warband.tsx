import { useEffect, useMemo, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import type { WarbandCharacter, WarbandData } from "../lib/warband";

// Blizzard class colours, keyed by the class file key (`classKey`).
const CLASS_COLORS: Record<string, string> = {
  Warrior: "#C69B6D",
  Paladin: "#F48CBA",
  Hunter: "#AAD372",
  Rogue: "#FFF468",
  Priest: "#FFFFFF",
  DeathKnight: "#C41E3A",
  Shaman: "#0070DD",
  Mage: "#3FC7EB",
  Warlock: "#8788EE",
  Monk: "#00FF98",
  Druid: "#FF7C0A",
  DemonHunter: "#A330C9",
  Evoker: "#33937F",
};

const ROLE_LABEL: Record<string, string> = {
  TANK: "Tank",
  HEALER: "Healer",
  DAMAGER: "DPS",
};

type SortKey = "name" | "realm" | "level" | "itemLevel" | "spec";
interface Sort {
  key: SortKey;
  dir: 1 | -1;
}

function professions(c: WarbandCharacter): string {
  return [c.professionPrimary, c.professionSecondary].filter(Boolean).join(", ");
}

function compare(a: WarbandCharacter, b: WarbandCharacter, key: SortKey): number {
  if (key === "level" || key === "itemLevel") {
    // Nulls last regardless of direction is handled by the caller flipping sign;
    // here just compare numerically with missing values as -Infinity.
    return (a[key] ?? -Infinity) - (b[key] ?? -Infinity);
  }
  const av = (key === "spec" ? a.spec : a[key]) ?? "";
  const bv = (key === "spec" ? b.spec : b[key]) ?? "";
  return String(av).localeCompare(String(bv));
}

export function Warband() {
  const [data, setData] = useState<WarbandData | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [sort, setSort] = useState<Sort>({ key: "itemLevel", dir: -1 });

  async function load() {
    setBusy(true);
    setError("");
    try {
      setData(await invoke<WarbandData>("get_warband"));
    } catch (e) {
      setError(String(e));
      setData(null);
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => {
    void load();
  }, []);

  const rows = useMemo(() => {
    if (!data) return [];
    return [...data.characters].sort((a, b) => sort.dir * compare(a, b, sort.key));
  }, [data, sort]);

  function toggleSort(key: SortKey) {
    setSort((s) =>
      s.key === key ? { key, dir: s.dir === 1 ? -1 : 1 } : { key, dir: key === "name" ? 1 : -1 },
    );
  }

  function Th({ label, sortKey }: { label: string; sortKey: SortKey }) {
    const active = sort.key === sortKey;
    return (
      <th
        onClick={() => toggleSort(sortKey)}
        style={{ cursor: "pointer", whiteSpace: "nowrap" }}
        title="Sort"
      >
        {label}
        {active ? (sort.dir === 1 ? " ▲" : " ▼") : ""}
      </th>
    );
  }

  return (
    <section className="card">
      <div className="row" style={{ justifyContent: "space-between", flexWrap: "wrap" }}>
        <h2 style={{ margin: 0 }}>Warband</h2>
        <div className="row">
          {data && (
            <span className="muted">
              {data.characters.length} characters · {data.account}
            </span>
          )}
          <button onClick={() => void load()} disabled={busy}>
            {busy ? "…" : "Refresh"}
          </button>
        </div>
      </div>

      {error && (
        <p className="muted" style={{ whiteSpace: "pre-wrap" }}>
          {error}
        </p>
      )}

      {!error && data && data.characters.length === 0 && (
        <p className="muted">No characters recorded yet.</p>
      )}

      {!error && rows.length > 0 && (
        <div style={{ overflowX: "auto" }}>
          <table className="grid">
            <thead>
              <tr>
                <Th label="Name" sortKey="name" />
                <Th label="Realm" sortKey="realm" />
                <Th label="Lvl" sortKey="level" />
                <Th label="iLvl" sortKey="itemLevel" />
                <Th label="Spec" sortKey="spec" />
                <th>Professions</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((c) => {
                const color = (c.classKey && CLASS_COLORS[c.classKey]) || undefined;
                const role = c.role ? (ROLE_LABEL[c.role] ?? c.role) : "";
                return (
                  <tr key={c.guid ?? `${c.name}-${c.realm}`}>
                    <td style={{ color, fontWeight: 600, whiteSpace: "nowrap" }}>
                      {c.name}
                      {c.guild ? <span className="muted"> &lt;{c.guild}&gt;</span> : null}
                    </td>
                    <td>{c.realm || "—"}</td>
                    <td>{c.level ?? "—"}</td>
                    <td>{c.itemLevel ?? "—"}</td>
                    <td style={{ whiteSpace: "nowrap" }}>
                      {c.spec || c.className || "—"}
                      {role ? <span className="muted"> · {role}</span> : null}
                    </td>
                    <td>{professions(c) || "—"}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
