import { useState } from "react";
import { useQuery, type UseQueryResult } from "@tanstack/react-query";
import type { BlizzardClient } from "../vendor/battlenet-wow-client";
import { loc } from "../lib/types";
import { FACTION_COLORS } from "../lib/wow";
import {
  characterMythicKeystoneQuery,
  characterPvpSummaryQuery,
  characterProfessionsQuery,
  characterSpecializationsQuery,
  characterReputationsQuery,
  characterMountsQuery,
  characterPetsQuery,
  characterToysQuery,
  characterRaidsQuery,
  describeError,
  type CharacterSummary,
} from "../lib/queries";
import { activeBuild } from "../lib/specializations";
import { reputationRows } from "../lib/reputations";
import { mountCount, petCount, toyCount } from "../lib/collections";
import { latestRaidProgress } from "../lib/raids";
import { SkeletonLines } from "./Skeleton";
import { EmptyState } from "./EmptyState";
import { PaperDoll } from "./PaperDoll";
import { Achievements } from "./Achievements";

type DetailTab =
  | "overview"
  | "spec"
  | "gear"
  | "mplus"
  | "pvp"
  | "professions"
  | "reputations"
  | "collections"
  | "raids"
  | "achievements";

const TABS: { key: DetailTab; label: string }[] = [
  { key: "overview", label: "Overview" },
  { key: "spec", label: "Spec" },
  { key: "gear", label: "Gear" },
  { key: "mplus", label: "M+" },
  { key: "pvp", label: "PvP" },
  { key: "professions", label: "Professions" },
  { key: "reputations", label: "Reputations" },
  { key: "collections", label: "Collections" },
  { key: "raids", label: "Raids" },
  { key: "achievements", label: "Achievements" },
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
      {tab === "spec" && (
        <Specializations bnet={bnet} realmSlug={realmSlug} characterName={characterName} />
      )}
      {tab === "gear" && (
        <PaperDoll bnet={bnet} realmSlug={realmSlug} characterName={characterName} />
      )}
      {tab === "mplus" && (
        <MythicPlus bnet={bnet} realmSlug={realmSlug} characterName={characterName} />
      )}
      {tab === "pvp" && <Pvp bnet={bnet} realmSlug={realmSlug} characterName={characterName} />}
      {tab === "professions" && (
        <Professions bnet={bnet} realmSlug={realmSlug} characterName={characterName} />
      )}
      {tab === "reputations" && (
        <Reputations bnet={bnet} realmSlug={realmSlug} characterName={characterName} />
      )}
      {tab === "collections" && (
        <Collections bnet={bnet} realmSlug={realmSlug} characterName={characterName} />
      )}
      {tab === "raids" && <Raids bnet={bnet} realmSlug={realmSlug} characterName={characterName} />}
      {tab === "achievements" && (
        <Achievements bnet={bnet} realmSlug={realmSlug} characterName={characterName} />
      )}
    </div>
  );
}

function Overview({ summary }: { summary: CharacterSummary }) {
  return (
    <dl className="stats">
      <div>
        <dt>Faction</dt>
        <dd
          style={{
            color: summary.faction?.type ? FACTION_COLORS[summary.faction.type] : undefined,
          }}
        >
          {loc(summary.faction?.name) || "—"}
        </dd>
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

function Specializations({
  bnet,
  realmSlug,
  characterName,
}: {
  bnet: BlizzardClient;
  realmSlug: string;
  characterName: string;
}) {
  const { data, isPending, isError, error, refetch } = useQuery(
    characterSpecializationsQuery(bnet, realmSlug, characterName),
  );

  if (isError) return <EmptyState message={describeError(error)} onRetry={() => void refetch()} />;
  if (isPending || !data) return <SkeletonLines lines={4} />;

  const build = activeBuild(data);
  if (!build) return <EmptyState message="No specialization data." />;

  const code = build.loadoutCode;
  return (
    <>
      <dl className="stats">
        <div>
          <dt>Specialization</dt>
          <dd>{build.specName ?? "—"}</dd>
        </div>
        {build.heroTreeName ? (
          <div>
            <dt>Hero talents</dt>
            <dd>{build.heroTreeName}</dd>
          </div>
        ) : null}
        <div>
          <dt>Talents</dt>
          <dd>
            {build.classTalentCount} class · {build.heroTalentCount} hero
          </dd>
        </div>
      </dl>
      {code ? (
        <div className="loadout">
          <div className="loadout-head">
            <span className="muted">Talent import string</span>
            <button
              type="button"
              className="loadout-copy"
              onClick={() => void navigator.clipboard?.writeText(code)}
            >
              Copy
            </button>
          </div>
          <code className="loadout-code">{code}</code>
        </div>
      ) : null}
    </>
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
  const { data, isPending, isError, error, refetch } = useQuery(
    characterMythicKeystoneQuery(bnet, realmSlug, characterName),
  );

  if (isError) return <EmptyState message={describeError(error)} onRetry={() => void refetch()} />;
  if (isPending || !data) return <SkeletonLines lines={3} />;

  const rating = data.current_mythic_rating?.rating;
  const periodId = data.current_period?.period?.id;
  if (typeof rating !== "number" && typeof periodId !== "number") {
    return <EmptyState message="No Mythic+ activity." />;
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
  const { data, isPending, isError, error, refetch } = useQuery(
    characterPvpSummaryQuery(bnet, realmSlug, characterName),
  );

  if (isError) return <EmptyState message={describeError(error)} onRetry={() => void refetch()} />;
  if (isPending || !data) return <SkeletonLines lines={4} />;

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
  const { data, isPending, isError, error, refetch } = useQuery(
    characterProfessionsQuery(bnet, realmSlug, characterName),
  );

  if (isError) return <EmptyState message={describeError(error)} onRetry={() => void refetch()} />;
  if (isPending || !data) return <SkeletonLines lines={4} />;

  // Primaries then secondaries; both share the same {profession, tiers} shape.
  const groups = [...(data.primaries ?? []), ...(data.secondaries ?? [])].filter(
    (p) => p.profession?.name,
  );
  if (groups.length === 0) return <EmptyState message="No professions." />;

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

function Reputations({
  bnet,
  realmSlug,
  characterName,
}: {
  bnet: BlizzardClient;
  realmSlug: string;
  characterName: string;
}) {
  const { data, isPending, isError, error, refetch } = useQuery(
    characterReputationsQuery(bnet, realmSlug, characterName),
  );

  if (isError) return <EmptyState message={describeError(error)} onRetry={() => void refetch()} />;
  if (isPending || !data) return <SkeletonLines lines={4} />;

  const rows = reputationRows(data);
  if (rows.length === 0) return <EmptyState message="No reputations." />;

  return (
    <div style={{ overflowX: "auto" }}>
      <table className="grid">
        <thead>
          <tr>
            <th>Faction</th>
            <th>Standing</th>
            <th>Progress</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.factionName}>
              <td>{r.factionName}</td>
              <td>{r.standing}</td>
              <td>{r.progress}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** A collection stat's display value: "—" on error, "…" while loading, else the localized count. */
function collectionStat<T>(query: UseQueryResult<T>, count: (data: T) => number): string {
  if (query.isError) return "—";
  if (!query.data) return "…";
  return count(query.data).toLocaleString();
}

function Collections({
  bnet,
  realmSlug,
  characterName,
}: {
  bnet: BlizzardClient;
  realmSlug: string;
  characterName: string;
}) {
  // Three independent collection reads: each stat shows its own count/loading/error, so one slow or
  // failed sub-document never blanks the whole tab.
  const mounts = useQuery(characterMountsQuery(bnet, realmSlug, characterName));
  const pets = useQuery(characterPetsQuery(bnet, realmSlug, characterName));
  const toys = useQuery(characterToysQuery(bnet, realmSlug, characterName));

  return (
    <dl className="stats">
      <div>
        <dt>Mounts</dt>
        <dd>{collectionStat(mounts, mountCount)}</dd>
      </div>
      <div>
        <dt>Pets</dt>
        <dd>{collectionStat(pets, petCount)}</dd>
      </div>
      <div>
        <dt>Toys</dt>
        <dd>{collectionStat(toys, toyCount)}</dd>
      </div>
    </dl>
  );
}

function Raids({
  bnet,
  realmSlug,
  characterName,
}: {
  bnet: BlizzardClient;
  realmSlug: string;
  characterName: string;
}) {
  const { data, isPending, isError, error, refetch } = useQuery(
    characterRaidsQuery(bnet, realmSlug, characterName),
  );

  if (isError) return <EmptyState message={describeError(error)} onRetry={() => void refetch()} />;
  if (isPending || !data) return <SkeletonLines lines={4} />;

  const progress = latestRaidProgress(data);
  const hasRows = progress?.instances.some((i) => i.modes.length > 0) ?? false;
  if (!progress || !hasRows) return <EmptyState message="No raid progression." />;

  return (
    <>
      {progress.expansionName ? (
        <p className="muted" style={{ margin: "0.25rem 0 0" }}>
          {progress.expansionName}
        </p>
      ) : null}
      <div style={{ overflowX: "auto" }}>
        <table className="grid">
          <thead>
            <tr>
              <th>Raid</th>
              <th>Difficulty</th>
              <th>Bosses</th>
            </tr>
          </thead>
          <tbody>
            {progress.instances.flatMap((inst) =>
              inst.modes.map((m) => (
                <tr key={`${inst.name}-${m.difficulty}`}>
                  <td>{inst.name}</td>
                  <td>{m.difficulty}</td>
                  <td>
                    {m.completed} / {m.total}
                  </td>
                </tr>
              )),
            )}
          </tbody>
        </table>
      </div>
    </>
  );
}
