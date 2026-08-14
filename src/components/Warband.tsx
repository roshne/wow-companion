import { useEffect, useMemo, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import type { Region } from "../vendor/battlenet-wow-client";
import type { WarbandCharacter, WarbandData } from "../lib/warband";
import { CLASS_COLORS } from "../lib/wow";
import { WarbandGearBoard } from "./WarbandGearBoard";
import { WarbandVaultBoard } from "./WarbandVaultBoard";
import { WarbandKeystoneBoard } from "./WarbandKeystoneBoard";
import { WarbandCurrencies } from "./WarbandCurrencies";
import { WarbandWealth } from "./WarbandWealth";
import { WarbandTitles } from "./WarbandTitles";
import { WarbandExpiryBoard } from "./WarbandExpiryBoard";
import { WarbandAllCharacters } from "./WarbandAllCharacters";

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

export function Warband({
  onOpenCharacter,
  region,
  hasCredentials = true,
}: {
  /** Open a character's detail sheet — the roster row's name button calls this. */
  onOpenCharacter: (sel: { realm: string; characterName: string }) => void;
  /** The app's current region — the fallback for resolving each alt's region on the gear board. */
  region: Region;
  /**
   * Whether a Battle.net client is connected. This tab is reachable without one — the export is a
   * local file — but the two views that call the API can't work, so they say so instead of failing.
   */
  hasCredentials?: boolean;
}) {
  const [data, setData] = useState<WarbandData | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [sort, setSort] = useState<Sort>({ key: "itemLevel", dir: -1 });
  // Roster (the default), the warband-wide gear board, or the Great Vault board. The gear board only
  // mounts — and only then fetches every alt's equipment — when selected, so that fetch stays lazy.
  // The vault board needs no fetch at all: it reads the same local export the roster already has.
  const [view, setView] = useState<
    "roster" | "all" | "board" | "vault" | "keys" | "currencies" | "titles" | "expiry"
  >("roster");

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

  // Whether the addon export gave us anything. Six of the seven views are built entirely from it; the
  // seventh asks Battle.net instead, which is exactly the case where the addon may be absent — a
  // player who has the app but not the addon still has characters, and this is where they see them.
  const hasAddon = !!data && data.characters.length > 0;
  // Whether the export read has produced an answer yet. The fallback below must wait for it —
  // otherwise the first paint of every load shows the account view and then swaps to the roster.
  const settled = data !== null || error !== "";
  // Fall back to the one view that doesn't need the addon, so an addon-less load lands somewhere real
  // rather than on an empty Roster.
  const shownView = hasAddon ? view : "all";

  function toggleSort(key: SortKey) {
    setSort((s) =>
      s.key === key ? { key, dir: s.dir === 1 ? -1 : 1 } : { key, dir: key === "name" ? 1 : -1 },
    );
  }

  function Th({ label, sortKey }: { label: string; sortKey: SortKey }) {
    const active = sort.key === sortKey;
    return (
      <th
        className="sortable"
        onClick={() => toggleSort(sortKey)}
        aria-sort={active ? (sort.dir === 1 ? "ascending" : "descending") : "none"}
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

      {/* Warband-wide context rather than another view, so it sits above the toggles and stays
          visible whichever board is selected. Renders nothing when no wealth was recorded. */}
      {!error && data && data.characters.length > 0 && (
        <WarbandWealth data={data} region={region} />
      )}

      {settled && (hasAddon || hasCredentials) && (
        // Toggles rather than a tablist (they read as buttons, not a tab strip), so the active one
        // announces itself through `aria-pressed`. The addon-backed six only appear when there's an
        // export to back them; "All characters" stands alone because it doesn't need one.
        <div
          className="row"
          style={{ gap: "0.25rem", marginBottom: "0.5rem" }}
          role="group"
          aria-label="Warband view"
        >
          {hasAddon && (
            <button
              className={shownView === "roster" ? "" : "ghost"}
              aria-pressed={shownView === "roster"}
              onClick={() => setView("roster")}
            >
              Roster
            </button>
          )}
          <button
            className={shownView === "all" ? "" : "ghost"}
            aria-pressed={shownView === "all"}
            onClick={() => setView("all")}
          >
            All characters
          </button>
          {hasAddon && (
            <>
              <button
                className={shownView === "board" ? "" : "ghost"}
                aria-pressed={shownView === "board"}
                onClick={() => setView("board")}
              >
                Gear board
              </button>
              <button
                className={shownView === "vault" ? "" : "ghost"}
                aria-pressed={shownView === "vault"}
                onClick={() => setView("vault")}
              >
                Great Vault
              </button>
              <button
                className={shownView === "keys" ? "" : "ghost"}
                aria-pressed={shownView === "keys"}
                onClick={() => setView("keys")}
              >
                Keys &amp; locks
              </button>
              <button
                className={shownView === "currencies" ? "" : "ghost"}
                aria-pressed={shownView === "currencies"}
                onClick={() => setView("currencies")}
              >
                Currencies
              </button>
              <button
                className={shownView === "titles" ? "" : "ghost"}
                aria-pressed={shownView === "titles"}
                onClick={() => setView("titles")}
              >
                Titles
              </button>
              <button
                className={shownView === "expiry" ? "" : "ghost"}
                aria-pressed={shownView === "expiry"}
                onClick={() => setView("expiry")}
              >
                Mail &amp; auctions
              </button>
            </>
          )}
        </div>
      )}

      {!error &&
        shownView === "board" &&
        data &&
        data.characters.length > 0 &&
        // The only view here that genuinely needs the API: it fetches every character's equipment.
        // Without a client it would render a row per character, each failing separately.
        (hasCredentials ? (
          <WarbandGearBoard characters={data.characters} region={region} />
        ) : (
          <p className="muted">
            The gear board reads each character&rsquo;s equipment from the Battle.net API, so it
            needs a Client ID / Secret. Add one in Settings — the other views here come from the
            addon and work without it.
          </p>
        ))}

      {/* Deliberately not gated on `error`: a missing addon export is exactly when this view is the
          only one with anything to show. Connecting an account does need the client credentials,
          though — without them there's nothing to connect with. */}
      {settled &&
        shownView === "all" &&
        (hasCredentials ? (
          <WarbandAllCharacters data={data} region={region} />
        ) : (
          <p className="muted">
            Seeing every character on your account means asking Battle.net, which needs a Client ID
            / Secret. Add one in Settings — the other views here come from the addon and work
            without it.
          </p>
        ))}

      {!error && shownView === "vault" && data && data.characters.length > 0 && (
        <WarbandVaultBoard data={data} />
      )}

      {!error && shownView === "keys" && data && data.characters.length > 0 && (
        <WarbandKeystoneBoard data={data} region={region} />
      )}

      {!error && shownView === "currencies" && data && data.characters.length > 0 && (
        <WarbandCurrencies data={data} region={region} />
      )}

      {!error && shownView === "titles" && data && data.characters.length > 0 && (
        <WarbandTitles data={data} />
      )}

      {!error && shownView === "expiry" && data && data.characters.length > 0 && (
        <WarbandExpiryBoard data={data} />
      )}

      {!error && shownView === "roster" && rows.length > 0 && (
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
                    <td style={{ whiteSpace: "nowrap" }}>
                      {/* The name links to the Character tab, which is an API view — without a
                          client there's nowhere to go, so it renders as plain text. */}
                      {c.realm && hasCredentials ? (
                        <button
                          type="button"
                          className="rowlink"
                          onClick={() => onOpenCharacter({ realm: c.realm, characterName: c.name })}
                          title={`Open ${c.name}`}
                          style={{ color }}
                        >
                          {c.name}
                        </button>
                      ) : (
                        <span style={{ color, fontWeight: 600 }}>{c.name}</span>
                      )}
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
