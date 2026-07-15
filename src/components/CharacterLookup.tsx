import { useState, type FormEvent } from "react";
import { useQuery } from "@tanstack/react-query";
import type { BlizzardClient } from "../vendor/battlenet-wow-client";
import { loc } from "../lib/types";
import { toRealmSlug, toCharacterName } from "../lib/slug";
import { BnetError, characterQuery, characterAvatarQuery, describeError } from "../lib/queries";

interface Submitted {
  realmSlug: string;
  characterName: string;
}

/** Look up a character's profile summary (+ avatar) by realm slug and name (profile namespace). */
export function CharacterLookup({ bnet }: { bnet: BlizzardClient }) {
  const [realm, setRealm] = useState("");
  const [name, setName] = useState("");
  const [submitted, setSubmitted] = useState<Submitted | null>(null);
  const [formError, setFormError] = useState("");
  const [brokenAvatar, setBrokenAvatar] = useState("");

  const realmSlug = submitted?.realmSlug ?? "";
  const characterName = submitted?.characterName ?? "";

  const charQuery = useQuery({
    ...characterQuery(bnet, realmSlug, characterName),
    enabled: submitted !== null,
  });
  const avatarQuery = useQuery({
    ...characterAvatarQuery(bnet, realmSlug, characterName),
    enabled: submitted !== null && charQuery.isSuccess,
  });

  const char = charQuery.data ?? null;
  const avatar = avatarQuery.data ?? "";

  function lookup(e: FormEvent) {
    e.preventDefault();
    const slug = toRealmSlug(realm);
    const character = toCharacterName(name);
    if (!slug || !character) {
      setFormError("Enter a realm and character name.");
      setSubmitted(null);
      return;
    }
    setFormError("");
    setBrokenAvatar("");
    setSubmitted({ realmSlug: slug, characterName: character });
  }

  const sub = formError
    ? formError
    : charQuery.isFetching
      ? "Looking up…"
      : charQuery.isError
        ? charQuery.error instanceof BnetError && charQuery.error.status === 404
          ? "Character not found — check the realm slug and name."
          : describeError(charQuery.error)
        : "";

  return (
    <section className="card">
      <h2 style={{ marginTop: 0 }}>Character Lookup</h2>
      <form
        className="row"
        onSubmit={lookup}
        style={{ flexWrap: "wrap", justifyContent: "flex-start" }}
      >
        <input
          placeholder="Realm (e.g. Tichondrius)"
          value={realm}
          onChange={(e) => setRealm(e.currentTarget.value)}
        />
        <input
          placeholder="Character name"
          value={name}
          onChange={(e) => setName(e.currentTarget.value)}
        />
        <button type="submit" disabled={charQuery.isFetching}>
          {charQuery.isFetching ? "…" : "Look up"}
        </button>
      </form>
      {sub && <p className="muted">{sub}</p>}
      {char && (
        <div className="charcard">
          {avatar && avatar !== brokenAvatar && (
            <img className="avatar" src={avatar} alt="" onError={() => setBrokenAvatar(avatar)} />
          )}
          <div>
            <h3 style={{ margin: "0 0 .25rem" }}>
              {char.name}
              {char.realm?.name ? <span className="muted"> — {loc(char.realm.name)}</span> : null}
            </h3>
            <p style={{ margin: ".1rem 0" }}>
              Level {char.level} {loc(char.race?.name)} {loc(char.character_class?.name)}
              {char.active_spec?.name ? ` · ${loc(char.active_spec.name)}` : ""}
            </p>
            {char.guild?.name ? (
              <p className="muted" style={{ margin: ".1rem 0" }}>
                &lt;{loc(char.guild.name)}&gt;
              </p>
            ) : null}
            <dl className="stats">
              <div>
                <dt>Faction</dt>
                <dd>{loc(char.faction?.name) || "—"}</dd>
              </div>
              <div>
                <dt>Item level</dt>
                <dd>
                  {char.equipped_item_level ?? "—"}{" "}
                  <span className="muted">(avg {char.average_item_level ?? "—"})</span>
                </dd>
              </div>
              <div>
                <dt>Achievements</dt>
                <dd>{char.achievement_points?.toLocaleString() ?? "—"}</dd>
              </div>
              {char.last_login_timestamp ? (
                <div>
                  <dt>Last login</dt>
                  <dd>{new Date(char.last_login_timestamp).toLocaleDateString()}</dd>
                </div>
              ) : null}
            </dl>
          </div>
        </div>
      )}
    </section>
  );
}
