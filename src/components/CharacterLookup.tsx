import { useState, type FormEvent } from "react";
import type { BlizzardClient } from "../vendor/battlenet-wow-client";
import { loc, type CharacterSummary, type CharacterMedia } from "../lib/types";

/** Look up a character's profile summary (+ avatar) by realm slug and name (profile namespace). */
export function CharacterLookup({ bnet }: { bnet: BlizzardClient }) {
  const [realm, setRealm] = useState("");
  const [name, setName] = useState("");
  const [char, setChar] = useState<CharacterSummary | null>(null);
  const [avatar, setAvatar] = useState("");
  const [sub, setSub] = useState("");
  const [busy, setBusy] = useState(false);

  async function lookup(e: FormEvent) {
    e.preventDefault();
    const realmSlug = realm.trim().toLowerCase().replace(/\s+/g, "-");
    const characterName = name.trim().toLowerCase();
    if (!realmSlug || !characterName) {
      setSub("Enter a realm and character name.");
      return;
    }
    setBusy(true);
    setChar(null);
    setAvatar("");
    setSub("Looking up…");
    try {
      const namespace = bnet.namespace("profile");
      const path = { realmSlug, characterName };
      const { data, response } = await bnet.api.GET(
        "/profile/wow/character/{realmSlug}/{characterName}",
        { params: { path, query: { namespace, locale: "en_US" } } },
      );
      if (!response.ok) {
        setSub(
          response.status === 404
            ? "Character not found — check the realm slug and name."
            : `Failed (HTTP ${response.status}).`,
        );
        return;
      }
      setChar(data as unknown as CharacterSummary);
      setSub("");

      // Best-effort avatar (separate media document).
      const media = await bnet.api.GET(
        "/profile/wow/character/{realmSlug}/{characterName}/character-media",
        { params: { path, query: { namespace, locale: "en_US" } } },
      );
      if (media.response.ok) {
        const m = media.data as unknown as CharacterMedia;
        const a = m.assets?.find((x) => x.key === "avatar")?.value;
        if (a) setAvatar(a);
      }
    } catch (err) {
      setSub(`Error: ${String(err)}`);
    } finally {
      setBusy(false);
    }
  }

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
        <button type="submit" disabled={busy}>
          {busy ? "…" : "Look up"}
        </button>
      </form>
      {sub && <p className="muted">{sub}</p>}
      {char && (
        <div className="charcard">
          {avatar && <img className="avatar" src={avatar} alt="" onError={() => setAvatar("")} />}
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
