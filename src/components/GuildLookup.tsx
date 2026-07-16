import { useState, type FormEvent } from "react";
import { useQuery } from "@tanstack/react-query";
import type { BlizzardClient } from "../vendor/battlenet-wow-client";
import { loc } from "../lib/types";
import { toRealmSlug, toGuildNameSlug } from "../lib/slug";
import { FACTION_COLORS } from "../lib/wow";
import { BnetError, describeError, guildQuery, realmIndexQuery } from "../lib/queries";
import { GuildDetail } from "./GuildDetail";

interface Submitted {
  realmSlug: string;
  nameSlug: string;
}

/** Title-case a lowercase slug for display (e.g. "argent-dawn" -> "Argent Dawn"). */
function titleCase(value: string): string {
  return value.replace(/-/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

/** Look up a guild by realm + name: a summary card plus a sub-tabbed roster / achievements / activity. */
export function GuildLookup({ bnet }: { bnet: BlizzardClient }) {
  const [realm, setRealm] = useState("");
  const [name, setName] = useState("");
  const [submitted, setSubmitted] = useState<Submitted | null>(null);
  const [formError, setFormError] = useState("");

  const realmSlug = submitted?.realmSlug ?? "";
  const nameSlug = submitted?.nameSlug ?? "";

  const guild = useQuery({
    ...guildQuery(bnet, realmSlug, nameSlug),
    enabled: submitted !== null,
  });
  const realmIndex = useQuery(realmIndexQuery(bnet));

  const data = guild.data ?? null;

  function lookup(e: FormEvent) {
    e.preventDefault();
    const realmSlugInput = toRealmSlug(realm);
    const nameSlugInput = toGuildNameSlug(name);
    if (!realmSlugInput || !nameSlugInput) {
      setFormError("Enter a realm and guild name.");
      setSubmitted(null);
      return;
    }
    setFormError("");
    setSubmitted({ realmSlug: realmSlugInput, nameSlug: nameSlugInput });
  }

  const sub = formError
    ? formError
    : guild.isFetching
      ? "Looking up…"
      : guild.isError
        ? guild.error instanceof BnetError && guild.error.status === 404
          ? "Guild not found — check the realm and guild name."
          : describeError(guild.error)
        : "";

  const factionType = data?.faction?.type;
  const factionColor = factionType ? FACTION_COLORS[factionType] : undefined;

  return (
    <section className="card">
      <h2 style={{ marginTop: 0 }}>Guild Lookup</h2>
      <form
        className="row"
        onSubmit={lookup}
        style={{ flexWrap: "wrap", justifyContent: "flex-start" }}
      >
        <input
          placeholder="Realm (e.g. Tichondrius)"
          list="guild-realm-options"
          value={realm}
          onChange={(e) => setRealm(e.currentTarget.value)}
        />
        <datalist id="guild-realm-options">
          {(realmIndex.data ?? []).map((r) => (
            <option key={r.slug} value={r.name} />
          ))}
        </datalist>
        <input
          placeholder="Guild name"
          value={name}
          onChange={(e) => setName(e.currentTarget.value)}
        />
        <button type="submit" disabled={guild.isFetching}>
          {guild.isFetching ? "…" : "Look up"}
        </button>
      </form>
      {sub && <p className="muted">{sub}</p>}
      {data && (
        <div>
          <h3 style={{ margin: "0 0 .25rem" }}>
            {loc(data.name) || titleCase(nameSlug)}
            {data.realm?.name ? <span className="muted"> — {loc(data.realm.name)}</span> : null}
          </h3>
          <dl className="stats">
            <div>
              <dt>Faction</dt>
              <dd style={{ color: factionColor }}>{loc(data.faction?.name) || "—"}</dd>
            </div>
            <div>
              <dt>Members</dt>
              <dd>{data.member_count?.toLocaleString() ?? "—"}</dd>
            </div>
            <div>
              <dt>Achievement points</dt>
              <dd>{data.achievement_points?.toLocaleString() ?? "—"}</dd>
            </div>
            {data.created_timestamp ? (
              <div>
                <dt>Created</dt>
                <dd>{new Date(data.created_timestamp).toLocaleDateString()}</dd>
              </div>
            ) : null}
          </dl>
          <GuildDetail bnet={bnet} realmSlug={realmSlug} nameSlug={nameSlug} />
        </div>
      )}
    </section>
  );
}
