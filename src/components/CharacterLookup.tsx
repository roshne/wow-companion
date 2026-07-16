import { useEffect, useMemo, useState, type FormEvent } from "react";
import { useQuery } from "@tanstack/react-query";
import type { BlizzardClient } from "../vendor/battlenet-wow-client";
import { loc } from "../lib/types";
import { classColor } from "../lib/wow";
import { resolveRealmSlug, toCharacterName } from "../lib/slug";
import { CharacterDetail } from "./CharacterDetail";
import {
  BnetError,
  characterQuery,
  characterMediaQuery,
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
  // Image sources that failed to load this lookup, so we can fall back render → avatar → placeholder.
  const [failedSrcs, setFailedSrcs] = useState<Set<string>>(new Set());
  const [recents, setRecents] = useState<RecentCharacter[]>(loadRecentCharacters);
  const [favorites, setFavorites] = useState<FavoriteCharacter[]>(loadFavoriteCharacters);

  const realmSlug = submitted?.realmSlug ?? "";
  const characterName = submitted?.characterName ?? "";

  const charQuery = useQuery({
    ...characterQuery(bnet, realmSlug, characterName),
    enabled: submitted !== null,
  });
  const mediaQuery = useQuery({
    ...characterMediaQuery(bnet, realmSlug, characterName),
    enabled: submitted !== null && charQuery.isSuccess,
  });
  const realmIndex = useQuery(realmIndexQuery(bnet));

  const char = charQuery.data ?? null;
  // Prefer the full-body render, then the avatar; skip any source that already failed to load.
  const media = mediaQuery.data ?? { render: null, avatar: null };
  const imageSrc = useMemo(() => {
    const candidates = [media.render, media.avatar].filter((s): s is string => !!s);
    return candidates.find((s) => !failedSrcs.has(s)) ?? null;
  }, [media.render, media.avatar, failedSrcs]);

  // Record a successful lookup in the recent-characters MRU (identity only; the profile re-fetches).
  useEffect(() => {
    if (submitted && charQuery.isSuccess) {
      setRecents(addRecentCharacter({ region: bnet.region, ...submitted }));
    }
  }, [submitted, charQuery.isSuccess, bnet.region]);

  function lookup(e: FormEvent) {
    e.preventDefault();
    const slug = resolveRealmSlug(realm, realmIndex.data ?? []);
    const character = toCharacterName(name);
    if (!slug || !character) {
      setFormError("Enter a realm and character name.");
      setSubmitted(null);
      return;
    }
    setFormError("");
    setFailedSrcs(new Set());
    setSubmitted({ realmSlug: slug, characterName: character });
  }

  // Re-run a lookup from a recent or favorite chip.
  function pickCharacter(r: { realmSlug: string; characterName: string }) {
    setRealm(r.realmSlug);
    setName(r.characterName);
    setFormError("");
    setFailedSrcs(new Set());
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
      {realmIndex.isError ? (
        <p className="muted">
          Couldn't load realm suggestions.{" "}
          <button type="button" className="ghost" onClick={() => void realmIndex.refetch()}>
            Retry
          </button>
        </p>
      ) : realmIndex.isLoading ? (
        <p className="muted">Loading realm suggestions…</p>
      ) : null}
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
          {imageSrc ? (
            <img
              className={imageSrc === media.render ? "char-render" : "avatar"}
              src={imageSrc}
              alt=""
              onError={() => setFailedSrcs((prev) => new Set(prev).add(imageSrc))}
            />
          ) : (
            <div
              className="avatar avatar-placeholder"
              aria-hidden="true"
              style={{ color: classColor(char.character_class?.id) }}
            >
              {char.name?.[0]?.toUpperCase() ?? "?"}
            </div>
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
              Level {char.level} {loc(char.race?.name)}{" "}
              <span style={{ color: classColor(char.character_class?.id), fontWeight: 600 }}>
                {loc(char.character_class?.name)}
              </span>
              {char.active_spec?.name ? ` · ${loc(char.active_spec.name)}` : ""}
            </p>
            {char.guild?.name ? (
              <p className="muted" style={{ margin: ".1rem 0" }}>
                &lt;{loc(char.guild.name)}&gt;
              </p>
            ) : null}
            <CharacterDetail
              bnet={bnet}
              realmSlug={realmSlug}
              characterName={characterName}
              summary={char}
            />
          </div>
        </div>
      )}
    </section>
  );
}
