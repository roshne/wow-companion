import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import type { BlizzardClient } from "../vendor/battlenet-wow-client";
import { loc } from "../lib/types";
import { QUALITY_COLORS } from "../lib/wow";
import { characterEquipmentQuery, describeError, type CharacterSummary } from "../lib/queries";

type DetailTab = "overview" | "gear";

const TABS: { key: DetailTab; label: string }[] = [
  { key: "overview", label: "Overview" },
  { key: "gear", label: "Gear" },
];

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
