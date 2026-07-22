import { useEffect, useId, useMemo, useState, type FormEvent } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { invoke } from "@tauri-apps/api/core";
import { makeClient } from "./lib/bnet";
import { onUnauthorized } from "./lib/auth";
import { useTokenHistory } from "./lib/useTokenHistory";
import { fetchRegionRealmIndexes, resolveCharacterRegion } from "./lib/region";
import { loadRegion, saveRegion } from "./lib/persist";
import { opsConfig, type OpsTargetInfo } from "./lib/botops";
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
import { Tabs, tabId, panelId, type TabSpec } from "./components/Tabs";
import "./App.css";

type Tab = "token" | "realms" | "character" | "guild" | "auctions" | "warband" | "botops";

/** The always-present views, in nav order; Bot Ops is appended only when ops mode is configured. */
const MAIN_TABS: TabSpec<Tab>[] = [
  { key: "token", label: "WoW Token" },
  { key: "realms", label: "Realm Status" },
  { key: "character", label: "Character" },
  { key: "guild", label: "Guild" },
  { key: "auctions", label: "Auctions" },
  { key: "warband", label: "Warband" },
];

const BOT_OPS_TAB: TabSpec<Tab> = { key: "botops", label: "Bot Ops" };

/** The credentials gate's two views, shown only when ops mode lets an operator skip connecting. */
const GATE_TABS: TabSpec<Tab>[] = [{ key: "token", label: "Connect" }, BOT_OPS_TAB];

function App() {
  const [hasCreds, setHasCreds] = useState<boolean | null>(null);
  const [clientId, setClientId] = useState("");
  const [clientSecret, setClientSecret] = useState("");
  const [region, setRegion] = useState<Region>(loadRegion);
  const [tab, setTab] = useState<Tab>("token");
  const [status, setStatus] = useState("");
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [ops, setOps] = useState<OpsTargetInfo[] | null>(null);
  // A character to open on the Character tab (set when a Warband roster row is clicked); cleared
  // once CharacterLookup has consumed it, so it's a one-shot open.
  const [selectedCharacter, setSelectedCharacter] = useState<{
    realm: string;
    characterName: string;
  } | null>(null);

  const queryClient = useQueryClient();
  // Namespace for the tablist/panel ids wiring the nav to the view below it (see `Tabs`).
  const tabsBase = useId();

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

  // Ops mode, as a single narrowed value: a non-empty target list, or null. `opsConfig()` resolves to
  // nothing at all when there's no ops.json, so this must stay a truthy test, not `!== null`.
  const opsTargets = ops && ops.length > 0 ? ops : null;

  if (hasCreds === null) {
    return (
      <div className="container">
        <main>
          <p className="muted" role="status">
            Loading…
          </p>
        </main>
      </div>
    );
  }

  if (!hasCreds) {
    // Bot Ops is independent of Battle.net creds — when ops mode is on, let the operator reach it
    // without connecting. Otherwise the connect form is the whole view, as before.
    const gateTab: Tab = opsTargets && tab === "botops" ? "botops" : "token";
    return (
      <div className="container">
        <header className="appbar">
          <h1>WoW Companion</h1>
        </header>
        {opsTargets && (
          <Tabs base={tabsBase} label="Views" tabs={GATE_TABS} active={gateTab} onSelect={setTab} />
        )}
        <main
          id={opsTargets ? panelId(tabsBase) : undefined}
          role={opsTargets ? "tabpanel" : undefined}
          aria-labelledby={opsTargets ? tabId(tabsBase, gateTab) : undefined}
        >
          {opsTargets && gateTab === "botops" ? (
            <BotOps targets={opsTargets} />
          ) : (
            <form
              className="card"
              onSubmit={saveCreds}
              style={{ maxWidth: 460, marginTop: "1rem" }}
            >
              <h2 style={{ marginTop: 0 }}>Connect your Battle.net client</h2>
              <p className="muted">
                Create one at <code>develop.battle.net/access/clients</code>. The secret is stored
                in your OS keychain — never in the app.
              </p>
              <input
                aria-label="Client ID"
                placeholder="Client ID"
                value={clientId}
                onChange={(e) => setClientId(e.currentTarget.value)}
              />
              <input
                type="password"
                aria-label="Client Secret"
                placeholder="Client Secret"
                value={clientSecret}
                onChange={(e) => setClientSecret(e.currentTarget.value)}
              />
              <button type="submit">Save to keychain</button>
              {/* A live region, so a save result (or a rejected-credentials notice) is announced. */}
              {status && (
                <p className="muted" role="status">
                  {status}
                </p>
              )}
            </form>
          )}
        </main>
      </div>
    );
  }

  const mainTabs = opsTargets ? [...MAIN_TABS, BOT_OPS_TAB] : MAIN_TABS;

  return (
    <div className="container">
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

      <Tabs base={tabsBase} label="Views" tabs={mainTabs} active={tab} onSelect={setTab} />

      <main id={panelId(tabsBase)} role="tabpanel" aria-labelledby={tabId(tabsBase, tab)}>
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
          {tab === "botops" && opsTargets && <BotOps targets={opsTargets} />}
        </ErrorBoundary>
      </main>

      <footer className="appfooter muted">{__BUILD_ID__}</footer>
    </div>
  );
}

export default App;
