import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import type { BlizzardClient } from "../vendor/battlenet-wow-client";
import { classColor, className, raceName } from "../lib/wow";
import {
  describeError,
  guildRosterQuery,
  guildAchievementsQuery,
  guildActivityQuery,
  type GuildRosterMember,
} from "../lib/queries";

type GuildTab = "roster" | "achievements" | "activity";

const TABS: { key: GuildTab; label: string }[] = [
  { key: "roster", label: "Roster" },
  { key: "achievements", label: "Achievements" },
  { key: "activity", label: "Activity" },
];

// Roster sort machinery — adapted from Warband.tsx for the guild-member shape.
type SortKey = "name" | "rank" | "level" | "race" | "class" | "realm";
interface Sort {
  key: SortKey;
  dir: 1 | -1;
}

// A large roster renders this many rows initially; a "Show all" button lifts the cap.
const ROSTER_CAP = 100;

/** Title-case a lowercase slug for display (e.g. "argent-dawn" -> "Argent Dawn"). */
function titleCase(value: string): string {
  return value.replace(/-/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

const memberName = (m: GuildRosterMember): string => m.character?.name ?? "";
const memberRealm = (m: GuildRosterMember): string => m.character?.realm?.slug ?? "";

function compare(a: GuildRosterMember, b: GuildRosterMember, key: SortKey): number {
  switch (key) {
    case "rank":
      return (a.rank ?? -Infinity) - (b.rank ?? -Infinity);
    case "level":
      return (a.character?.level ?? -Infinity) - (b.character?.level ?? -Infinity);
    case "race":
      return raceName(a.character?.playable_race?.id).localeCompare(
        raceName(b.character?.playable_race?.id),
      );
    case "class":
      return className(a.character?.playable_class?.id).localeCompare(
        className(b.character?.playable_class?.id),
      );
    case "realm":
      return memberRealm(a).localeCompare(memberRealm(b));
    case "name":
    default:
      return memberName(a).localeCompare(memberName(b));
  }
}

/** Sub-tabbed guild detail. Roster is fetched with the summary card; the others load on select. */
export function GuildDetail({
  bnet,
  realmSlug,
  nameSlug,
}: {
  bnet: BlizzardClient;
  realmSlug: string;
  nameSlug: string;
}) {
  const [tab, setTab] = useState<GuildTab>("roster");

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
      {tab === "roster" && <Roster bnet={bnet} realmSlug={realmSlug} nameSlug={nameSlug} />}
      {tab === "achievements" && (
        <Achievements bnet={bnet} realmSlug={realmSlug} nameSlug={nameSlug} />
      )}
      {tab === "activity" && <Activity bnet={bnet} realmSlug={realmSlug} nameSlug={nameSlug} />}
    </div>
  );
}

function Roster({
  bnet,
  realmSlug,
  nameSlug,
}: {
  bnet: BlizzardClient;
  realmSlug: string;
  nameSlug: string;
}) {
  const { data, isPending, isError, error } = useQuery(guildRosterQuery(bnet, realmSlug, nameSlug));
  const [sort, setSort] = useState<Sort>({ key: "rank", dir: 1 });
  const [showAll, setShowAll] = useState(false);

  const rows = useMemo(() => {
    const members = data?.members ?? [];
    return [...members].sort((a, b) => sort.dir * compare(a, b, sort.key));
  }, [data, sort]);

  if (isError) return <p className="muted">{describeError(error)}</p>;
  if (isPending || !data) return <p className="muted">Loading roster…</p>;
  if (rows.length === 0) return <p className="muted">No members.</p>;

  function toggleSort(key: SortKey) {
    setSort((s) =>
      s.key === key ? { key, dir: s.dir === 1 ? -1 : 1 } : { key, dir: key === "level" ? -1 : 1 },
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

  const visible = showAll ? rows : rows.slice(0, ROSTER_CAP);
  const capped = !showAll && rows.length > ROSTER_CAP;

  return (
    <>
      <div style={{ overflowX: "auto" }}>
        <table className="grid">
          <thead>
            <tr>
              <Th label="Name" sortKey="name" />
              <Th label="Rank" sortKey="rank" />
              <Th label="Lvl" sortKey="level" />
              <Th label="Race" sortKey="race" />
              <Th label="Class" sortKey="class" />
              <Th label="Realm" sortKey="realm" />
            </tr>
          </thead>
          <tbody>
            {visible.map((m) => {
              const classId = m.character?.playable_class?.id;
              const rank = m.rank;
              return (
                <tr key={m.character?.id ?? `${memberName(m)}-${memberRealm(m)}`}>
                  <td style={{ color: classColor(classId), fontWeight: 600, whiteSpace: "nowrap" }}>
                    {m.character?.name ?? "—"}
                  </td>
                  <td>{rank === 0 ? "GM" : rank != null ? `Rank ${rank}` : "—"}</td>
                  <td>{m.character?.level ?? "—"}</td>
                  <td>{raceName(m.character?.playable_race?.id)}</td>
                  <td style={{ whiteSpace: "nowrap" }}>{className(classId)}</td>
                  <td>{titleCase(memberRealm(m)) || "—"}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {capped && (
        <button className="ghost" style={{ marginTop: ".5rem" }} onClick={() => setShowAll(true)}>
          Show all {rows.length} members
        </button>
      )}
      <p className="muted" style={{ margin: ".35rem 0 0" }}>
        {capped ? `Showing ${ROSTER_CAP} of ${rows.length} members` : `${rows.length} members`}
      </p>
    </>
  );
}

function Achievements({
  bnet,
  realmSlug,
  nameSlug,
}: {
  bnet: BlizzardClient;
  realmSlug: string;
  nameSlug: string;
}) {
  const { data, isPending, isError, error } = useQuery(
    guildAchievementsQuery(bnet, realmSlug, nameSlug),
  );

  if (isError) return <p className="muted">{describeError(error)}</p>;
  if (isPending || !data) return <p className="muted">Loading achievements…</p>;

  const recent = data.recent_events ?? [];
  return (
    <>
      <dl className="stats">
        <div>
          <dt>Achievements earned</dt>
          <dd>{data.total_quantity?.toLocaleString() ?? "—"}</dd>
        </div>
        <div>
          <dt>Points</dt>
          <dd>{data.total_points?.toLocaleString() ?? "—"}</dd>
        </div>
      </dl>
      {recent.length > 0 ? (
        <>
          <h4 style={{ margin: ".75rem 0 .25rem" }}>Recently earned</h4>
          <ul className="muted" style={{ margin: 0, paddingLeft: "1.1rem" }}>
            {recent.slice(0, 10).map((e, i) => (
              <li key={e.achievement?.id ?? i}>
                {e.achievement?.name ?? "—"}
                {e.timestamp ? ` · ${new Date(e.timestamp).toLocaleDateString()}` : ""}
              </li>
            ))}
          </ul>
        </>
      ) : (
        <p className="muted">No recent achievements.</p>
      )}
    </>
  );
}

function Activity({
  bnet,
  realmSlug,
  nameSlug,
}: {
  bnet: BlizzardClient;
  realmSlug: string;
  nameSlug: string;
}) {
  const { data, isPending, isError, error } = useQuery(
    guildActivityQuery(bnet, realmSlug, nameSlug),
  );

  if (isError) return <p className="muted">{describeError(error)}</p>;
  if (isPending || !data) return <p className="muted">Loading activity…</p>;

  const activities = data.activities ?? [];
  if (activities.length === 0) return <p className="muted">No recent activity.</p>;

  return (
    <ul className="muted" style={{ margin: ".25rem 0 0", paddingLeft: "1.1rem" }}>
      {activities.slice(0, 20).map((a, i) => {
        const ca = a.character_achievement;
        return (
          <li key={i}>
            {ca?.character?.name ?? "Someone"} earned {ca?.achievement?.name ?? "an achievement"}
            {a.timestamp ? ` · ${new Date(a.timestamp).toLocaleDateString()}` : ""}
          </li>
        );
      })}
    </ul>
  );
}
