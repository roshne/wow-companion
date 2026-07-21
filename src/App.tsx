import { useEffect, useMemo, useState, type FormEvent } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { invoke } from "@tauri-apps/api/core";
import { makeClient } from "./lib/bnet";
import { onUnauthorized } from "./lib/auth";
import { useTokenHistory } from "./lib/useTokenHistory";
import { fetchRegionRealmIndexes, resolveCharacterRegion } from "./lib/region";
import { loadRegion, saveRegion } from "./lib/persist";
import { opsConfig, type OpsConfig } from "./lib/botops";
import type { Region } from "./vendor/battlenet-wow-client";
import { TokenPrice } from "./components/TokenPrice";
import { RealmStatus } from "./components/RealmStatus";
import { CharacterLookup } from "./components/CharacterLookup";
import { GuildLookup } from "./components/GuildLookup";
import { AuctionHouse } from "./components/AuctionHouse";
import { Warband } from "./components/Warband";
import { Settings } from "./components/Settings";
import { BotOps } from "./components/BotOps";
import { ErrorBoundary } from "./components/ErrorBoundary";
import "./App.css";

type Tab = "token" | "realms" | "character" | "guild" | "auctions" | "warband" | "botops";

function App() {
  const [hasCreds, setHasCreds] = useState<boolean | null>(null);
  const [clientId, setClientId] = useState("");
  const [clientSecret, setClientSecret] = useState("");
  const [region, setRegion] = useState<Region>(loadRegion);
  const [tab, setTab] = useState<Tab>("token");
  const [status, setStatus] = useState("");
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [ops, setOps] = useState<OpsConfig | null>(null);
  // A character to open on the Character tab (set when a Warband roster row is clicked); cleared
  // once CharacterLookup has consumed it, so it's a one-shot open.
  const [selectedCharacter, setSelectedCharacter] = useState<{
    realm: string;
    characterName: string;
  } | null>(null);

  const queryClient = useQueryClient();

  // Open a character's detail sheet from elsewhere (e.g. the Warband roster). The Warbandeer export
  // carries no region, so detect which region actually lists the alt's realm (best-effort, falling
  // back to the current region on an ambiguous or unknown realm) and switch the selector to it before
  // opening — otherwise a same-named realm in another region would 404. Kept void-returning; the
  // per-region index fetch is cached, so only a cold region touches the network.
  function openCharacter(sel: { realm: string; characterName: string }) {
    void (async () => {
      const indexes = await fetchRegionRealmIndexes(queryClient);
      setRegion(resolveCharacterRegion(sel.realm, indexes, region).region);
      setSelectedCharacter(sel);
      setTab("character");
    })();
  }

  // Rebuilt when the region changes; children re-fetch against the new region.
  const bnet = useMemo(() => makeClient(region), [region]);

  // Capture the token price app-wide (not just on the Token tab) so history accrues off-tab.
  const token = useTokenHistory(bnet, hasCreds === true);

  // Remember the selected region so the app reopens on it.
  useEffect(() => saveRegion(region), [region]);

  useEffect(() => {
    invoke<boolean>("has_credentials")
      .then(setHasCreds)
      .catch(() => setHasCreds(false));
  }, []);

  // Operator-only Bot Ops tab: shown only when ops mode is configured (an ops.json is present).
  // A broken or absent config resolves to null, keeping the tab hidden in normal use.
  useEffect(() => {
    opsConfig()
      .then(setOps)
      .catch(() => setOps(null));
  }, []);

  // A 401 from any data call means the stored secret is invalid/expired: clear it and route back to
  // the connect form so the user can reconnect, instead of failing silently.
  useEffect(
    () =>
      onUnauthorized(() => {
        void invoke("clear_credentials").finally(() => {
          setHasCreds(false);
          setStatus("Your Battle.net credentials were rejected — please reconnect.");
        });
      }),
    [],
  );

  async function saveCreds(e: FormEvent) {
    e.preventDefault();
    setStatus("Saving…");
    try {
      await invoke("save_credentials", { clientId, clientSecret });
      setClientId("");
      setClientSecret("");
      setHasCreds(true);
      setStatus("");
    } catch (err) {
      setStatus(`Error: ${String(err)}`);
    }
  }

  async function clearCreds() {
    await invoke("clear_credentials");
    setHasCreds(false);
  }

  if (hasCreds === null) {
    return (
      <main className="container">
        <p className="muted">Loading…</p>
      </main>
    );
  }

  if (!hasCreds) {
    return (
      <main className="container">
        <h1>WoW Companion</h1>
        <form className="card" onSubmit={saveCreds} style={{ maxWidth: 460, marginTop: "1rem" }}>
          <h2 style={{ marginTop: 0 }}>Connect your Battle.net client</h2>
          <p className="muted">
            Create one at <code>develop.battle.net/access/clients</code>. The secret is stored in
            your OS keychain — never in the app.
          </p>
          <input
            placeholder="Client ID"
            value={clientId}
            onChange={(e) => setClientId(e.currentTarget.value)}
          />
          <input
            type="password"
            placeholder="Client Secret"
            value={clientSecret}
            onChange={(e) => setClientSecret(e.currentTarget.value)}
          />
          <button type="submit">Save to keychain</button>
          {status && <p className="muted">{status}</p>}
        </form>
      </main>
    );
  }

  return (
    <main className="container">
      <header className="appbar">
        <h1>WoW Companion</h1>
        <div className="spacer" />
        <button className="ghost" onClick={() => setSettingsOpen(true)} aria-haspopup="dialog">
          <span aria-hidden="true">⚙</span> Settings
        </button>
      </header>

      {settingsOpen && (
        <Settings
          region={region}
          onRegionChange={setRegion}
          onDisconnect={() => {
            setSettingsOpen(false);
            void clearCreds();
          }}
          onClose={() => setSettingsOpen(false)}
        />
      )}

      <nav className="tabs">
        <button className={tab === "token" ? "active" : ""} onClick={() => setTab("token")}>
          WoW Token
        </button>
        <button className={tab === "realms" ? "active" : ""} onClick={() => setTab("realms")}>
          Realm Status
        </button>
        <button className={tab === "character" ? "active" : ""} onClick={() => setTab("character")}>
          Character
        </button>
        <button className={tab === "guild" ? "active" : ""} onClick={() => setTab("guild")}>
          Guild
        </button>
        <button className={tab === "auctions" ? "active" : ""} onClick={() => setTab("auctions")}>
          Auctions
        </button>
        <button className={tab === "warband" ? "active" : ""} onClick={() => setTab("warband")}>
          Warband
        </button>
        {ops && (
          <button className={tab === "botops" ? "active" : ""} onClick={() => setTab("botops")}>
            Bot Ops
          </button>
        )}
      </nav>

      <ErrorBoundary resetKeys={[tab, region]}>
        {tab === "token" && <TokenPrice token={token} />}
        {tab === "realms" && <RealmStatus bnet={bnet} />}
        {tab === "character" && (
          <CharacterLookup
            bnet={bnet}
            initial={selectedCharacter}
            onConsumed={() => setSelectedCharacter(null)}
          />
        )}
        {tab === "guild" && <GuildLookup bnet={bnet} />}
        {tab === "auctions" && <AuctionHouse bnet={bnet} />}
        {tab === "warband" && <Warband onOpenCharacter={openCharacter} region={region} />}
        {tab === "botops" && ops && <BotOps cfg={ops} />}
      </ErrorBoundary>

      <footer className="appfooter muted">{__BUILD_ID__}</footer>
    </main>
  );
}

export default App;
