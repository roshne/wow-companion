import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import type { BlizzardClient } from "../vendor/battlenet-wow-client";
import { loc } from "../lib/types";
import { QUALITY_COLORS } from "../lib/wow";
import {
  characterEquipmentQuery,
  characterMythicKeystoneQuery,
  characterPvpSummaryQuery,
  characterProfessionsQuery,
  describeError,
  type CharacterSummary,
} from "../lib/queries";

type DetailTab = "overview" | "gear" | "mplus" | "pvp" | "professions";

const TABS: { key: DetailTab; label: string }[] = [
  { key: "overview", label: "Overview" },
  { key: "gear", label: "Gear" },
  { key: "mplus", label: "M+" },
  { key: "pvp", label: "PvP" },
  { key: "professions", label: "Professions" },
];

/**
 * A Blizzard `{r,g,b}` colour (as on `current_mythic_rating.color`) to a CSS `rgb(...)`. The API isn't
 * consistent about the scale across endpoints, so normalize: values that all look like 0–1 floats are
 * scaled to 0–255. Returns `undefined` when any channel is missing (so the tint is simply skipped).
 */
function rgbColor(color: { r?: number; g?: number; b?: number } | undefined): string | undefined {
  if (!color) return undefined;
  const { r, g, b } = color;
  if (typeof r !== "number" || typeof g !== "number" || typeof b !== "number") return undefined;
  const scale = Math.max(r, g, b) <= 1 ? 255 : 1;
  const ch = (v: number) => Math.min(255, Math.max(0, Math.round(v * scale)));
  return `rgb(${ch(r)}, ${ch(g)}, ${ch(b)})`;
}

/**
 * Sub-tabbed character detail. Overview reads the already-fetched summary (no extra call); other tabs
 * fetch their sub-resource lazily, only once selected.
 */
export function CharacterDetail({
  bnet,
  realmSlug,
  characterName,
  summary,
}: {
  bnet: BlizzardClient;
  realmSlug: string;
  characterName: string;
  summary: CharacterSummary;
}) {
  const [tab, setTab] = useState<DetailTab>("overview");

  return (
    <div>
      <nav className="tabs" style={{ marginTop: ".5rem" }}>
        {TABS.map((t) => (
          <button
            key={t.key}
            className={tab === t.key ? "active" : ""}
            onClick={() => setTab(t.key)}
          >
            {t.label}
          </button>
        ))}
      </nav>
      {tab === "overview" && <Overview summary={summary} />}
      {tab === "gear" && <Gear bnet={bnet} realmSlug={realmSlug} characterName={characterName} />}
      {tab === "mplus" && (
        <MythicPlus bnet={bnet} realmSlug={realmSlug} characterName={characterName} />
      )}
      {tab === "pvp" && <Pvp bnet={bnet} realmSlug={realmSlug} characterName={characterName} />}
      {tab === "professions" && (
        <Professions bnet={bnet} realmSlug={realmSlug} characterName={characterName} />
      )}
    </div>
  );
}

function Overview({ summary }: { summary: CharacterSummary }) {
  return (
    <dl className="stats">
      <div>
        <dt>Faction</dt>
        <dd>{loc(summary.faction?.name) || "—"}</dd>
      </div>
      <div>
        <dt>Item level</dt>
        <dd>
          {summary.equipped_item_level ?? "—"}{" "}
          <span className="muted">(avg {summary.average_item_level ?? "—"})</span>
        </dd>
      </div>
      <div>
        <dt>Achievements</dt>
        <dd>{summary.achievement_points?.toLocaleString() ?? "—"}</dd>
      </div>
      {summary.last_login_timestamp ? (
        <div>
          <dt>Last login</dt>
          <dd>{new Date(summary.last_login_timestamp).toLocaleDateString()}</dd>
        </div>
      ) : null}
    </dl>
  );
}

function Gear({
  bnet,
  realmSlug,
  characterName,
}: {
  bnet: BlizzardClient;
  realmSlug: string;
  characterName: string;
}) {
  const { data, isPending, isError, error } = useQuery(
    characterEquipmentQuery(bnet, realmSlug, characterName),
  );

  if (isError) return <p className="muted">{describeError(error)}</p>;
  if (isPending || !data) return <p className="muted">Loading gear…</p>;

  const items = (data.equipped_items ?? []).filter((it) => it.slot?.name);
  if (items.length === 0) return <p className="muted">No equipped items.</p>;

  return (
    <div style={{ overflowX: "auto" }}>
      <table className="grid">
        <thead>
          <tr>
            <th>Slot</th>
            <th>Item</th>
            <th>iLvl</th>
          </tr>
        </thead>
        <tbody>
          {items.map((it, i) => (
            <tr key={it.slot?.type ?? i}>
              <td>{loc(it.slot?.name)}</td>
              <td style={{ color: it.quality?.type ? QUALITY_COLORS[it.quality.type] : undefined }}>
                {it.name ?? "—"}
              </td>
              <td>{it.level?.value ?? "—"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function MythicPlus({
  bnet,
  realmSlug,
  characterName,
}: {
  bnet: BlizzardClient;
  realmSlug: string;
  characterName: string;
}) {
  const { data, isPending, isError, error } = useQuery(
    characterMythicKeystoneQuery(bnet, realmSlug, characterName),
  );

  if (isError) return <p className="muted">{describeError(error)}</p>;
  if (isPending || !data) return <p className="muted">Loading Mythic+…</p>;

  const rating = data.current_mythic_rating?.rating;
  const periodId = data.current_period?.period?.id;
  if (typeof rating !== "number" && typeof periodId !== "number") {
    return <p className="muted">No Mythic+ activity.</p>;
  }

  return (
    <dl className="stats">
      <div>
        <dt>Mythic+ rating</dt>
        <dd style={{ color: rgbColor(data.current_mythic_rating?.color) }}>
          {typeof rating === "number" ? Math.round(rating).toLocaleString() : "—"}
        </dd>
      </div>
      {typeof periodId === "number" ? (
        <div>
          <dt>Current period</dt>
          <dd>#{periodId}</dd>
        </div>
      ) : null}
    </dl>
  );
}

function Pvp({
  bnet,
  realmSlug,
  characterName,
}: {
  bnet: BlizzardClient;
  realmSlug: string;
  characterName: string;
}) {
  const { data, isPending, isError, error } = useQuery(
    characterPvpSummaryQuery(bnet, realmSlug, characterName),
  );

  if (isError) return <p className="muted">{describeError(error)}</p>;
  if (isPending || !data) return <p className="muted">Loading PvP…</p>;

  const maps = (data.pvp_map_statistics ?? []).filter((m) => m.world_map?.name);

  return (
    <>
      <dl className="stats">
        <div>
          <dt>Honor level</dt>
          <dd>{data.honor_level ?? "—"}</dd>
        </div>
        <div>
          <dt>Honorable kills</dt>
          <dd>{data.honorable_kills?.toLocaleString() ?? "—"}</dd>
        </div>
      </dl>
      {maps.length > 0 ? (
        <div style={{ overflowX: "auto" }}>
          <table className="grid">
            <thead>
              <tr>
                <th>Battleground</th>
                <th>Played</th>
                <th>Won</th>
                <th>Lost</th>
              </tr>
            </thead>
            <tbody>
              {maps.map((m, i) => (
                <tr key={m.world_map?.id ?? i}>
                  <td>{loc(m.world_map?.name)}</td>
                  <td>{m.match_statistics?.played ?? "—"}</td>
                  <td>{m.match_statistics?.won ?? "—"}</td>
                  <td>{m.match_statistics?.lost ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <p className="muted">No battleground statistics.</p>
      )}
    </>
  );
}

function Professions({
  bnet,
  realmSlug,
  characterName,
}: {
  bnet: BlizzardClient;
  realmSlug: string;
  characterName: string;
}) {
  const { data, isPending, isError, error } = useQuery(
    characterProfessionsQuery(bnet, realmSlug, characterName),
  );

  if (isError) return <p className="muted">{describeError(error)}</p>;
  if (isPending || !data) return <p className="muted">Loading professions…</p>;

  // Primaries then secondaries; both share the same {profession, tiers} shape.
  const groups = [...(data.primaries ?? []), ...(data.secondaries ?? [])].filter(
    (p) => p.profession?.name,
  );
  if (groups.length === 0) return <p className="muted">No professions.</p>;

  return (
    <div>
      {groups.map((p, i) => (
        <div key={p.profession?.id ?? i} style={{ marginBottom: ".6rem" }}>
          <h4 style={{ margin: "0 0 .15rem" }}>{loc(p.profession?.name)}</h4>
          {(p.tiers ?? []).length > 0 ? (
            <ul className="muted" style={{ margin: 0, paddingLeft: "1.1rem" }}>
              {(p.tiers ?? []).map((t, j) => (
                <li key={t.tier?.id ?? j}>
                  {loc(t.tier?.name)} — {t.skill_points ?? 0} / {t.max_skill_points ?? 0}
                </li>
              ))}
            </ul>
          ) : (
            <p className="muted" style={{ margin: 0 }}>
              No tiers.
            </p>
          )}
        </div>
      ))}
    </div>
  );
}
