import { useEffect, useState, type FormEvent } from "react";
import { useQuery } from "@tanstack/react-query";
import type { BlizzardClient } from "../vendor/battlenet-wow-client";
import { loc } from "../lib/types";
import { toRealmSlug, toCharacterName } from "../lib/slug";
import {
  BnetError,
  characterQuery,
  characterAvatarQuery,
  describeError,
  realmIndexQuery,
} from "../lib/queries";
import {
  addRecentCharacter,
  loadRecentCharacters,
  loadFavoriteCharacters,
  toggleFavoriteCharacter,
  removeFavoriteCharacter,
  isFavoriteCharacter,
  type RecentCharacter,
  type FavoriteCharacter,
} from "../lib/persist";

interface Submitted {
  realmSlug: string;
  characterName: string;
}

/** Title-case a lowercase slug/name for display (e.g. "argent-dawn" -> "Argent Dawn"). */
function titleCase(value: string): string {
  return value.replace(/-/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

/** Look up a character's profile summary (+ avatar) by realm slug and name (profile namespace). */
export function CharacterLookup({ bnet }: { bnet: BlizzardClient }) {
  const [realm, setRealm] = useState("");
  const [name, setName] = useState("");
  const [submitted, setSubmitted] = useState<Submitted | null>(null);
  const [formError, setFormError] = useState("");
  const [brokenAvatar, setBrokenAvatar] = useState("");
  const [recents, setRecents] = useState<RecentCharacter[]>(loadRecentCharacters);
  const [favorites, setFavorites] = useState<FavoriteCharacter[]>(loadFavoriteCharacters);

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
  const realmIndex = useQuery(realmIndexQuery(bnet));

  const char = charQuery.data ?? null;
  const avatar = avatarQuery.data ?? "";

  // Record a successful lookup in the recent-characters MRU (identity only; the profile re-fetches).
  useEffect(() => {
    if (submitted && charQuery.isSuccess) {
      setRecents(addRecentCharacter({ region: bnet.region, ...submitted }));
    }
  }, [submitted, charQuery.isSuccess, bnet.region]);

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

  // Re-run a lookup from a recent or favorite chip.
  function pickCharacter(r: { realmSlug: string; characterName: string }) {
    setRealm(r.realmSlug);
    setName(r.characterName);
    setFormError("");
    setBrokenAvatar("");
    setSubmitted({ realmSlug: r.realmSlug, characterName: r.characterName });
  }

  const regionRecents = recents.filter((r) => r.region === bnet.region);
  const regionFavorites = favorites.filter((f) => f.region === bnet.region);
  const currentFavorite: FavoriteCharacter | null = submitted
    ? {
        region: bnet.region,
        realmSlug: submitted.realmSlug,
        characterName: submitted.characterName,
      }
    : null;
  const currentIsFavorited = currentFavorite
    ? isFavoriteCharacter(favorites, currentFavorite)
    : false;

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
          list="realm-options"
          value={realm}
          onChange={(e) => setRealm(e.currentTarget.value)}
        />
        <datalist id="realm-options">
          {(realmIndex.data ?? []).map((r) => (
            <option key={r.slug} value={r.name} />
          ))}
        </datalist>
        <input
          placeholder="Character name"
          value={name}
          onChange={(e) => setName(e.currentTarget.value)}
        />
        <button type="submit" disabled={charQuery.isFetching}>
          {charQuery.isFetching ? "…" : "Look up"}
        </button>
      </form>
      {regionFavorites.length > 0 && (
        <div className="row" style={{ flexWrap: "wrap", gap: ".4rem", alignItems: "center" }}>
          <span className="muted">Favorites:</span>
          {regionFavorites.map((f) => (
            <span key={`${f.realmSlug}/${f.characterName}`} className="row" style={{ gap: 0 }}>
              <button type="button" className="ghost" onClick={() => pickCharacter(f)}>
                {`★ ${titleCase(f.characterName)} · ${titleCase(f.realmSlug)}`}
              </button>
              <button
                type="button"
                className="ghost"
                aria-label={`Remove ${f.characterName} from favorites`}
                onClick={() => setFavorites(removeFavoriteCharacter(f))}
              >
                ×
              </button>
            </span>
          ))}
        </div>
      )}
      {regionRecents.length > 0 && (
        <div className="row" style={{ flexWrap: "wrap", gap: ".4rem" }}>
          <span className="muted">Recent:</span>
          {regionRecents.map((r) => (
            <button
              key={`${r.realmSlug}/${r.characterName}`}
              type="button"
              className="ghost"
              onClick={() => pickCharacter(r)}
            >
              {`${titleCase(r.characterName)} · ${titleCase(r.realmSlug)}`}
            </button>
          ))}
        </div>
      )}
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
            <button
              type="button"
              className="ghost"
              style={{ marginBottom: ".25rem" }}
              onClick={() =>
                currentFavorite && setFavorites(toggleFavoriteCharacter(currentFavorite))
              }
            >
              {currentIsFavorited ? "★ Favorited" : "☆ Favorite"}
            </button>
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
