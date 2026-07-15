import { useEffect, useMemo, useState, type FormEvent } from "react";
import { invoke } from "@tauri-apps/api/core";
import { makeClient } from "./lib/bnet";
import { onUnauthorized } from "./lib/auth";
import type { Region } from "./vendor/battlenet-wow-client";
import { TokenPrice } from "./components/TokenPrice";
import { RealmStatus } from "./components/RealmStatus";
import { CharacterLookup } from "./components/CharacterLookup";
import { Warband } from "./components/Warband";
import { ErrorBoundary } from "./components/ErrorBoundary";
import "./App.css";

const REGIONS: Region[] = ["us", "eu", "kr", "tw"];
type Tab = "token" | "realms" | "character" | "warband";

function App() {
  const [hasCreds, setHasCreds] = useState<boolean | null>(null);
  const [clientId, setClientId] = useState("");
  const [clientSecret, setClientSecret] = useState("");
  const [region, setRegion] = useState<Region>("us");
  const [tab, setTab] = useState<Tab>("token");
  const [status, setStatus] = useState("");

  // Rebuilt when the region changes; children re-fetch against the new region.
  const bnet = useMemo(() => makeClient(region), [region]);

  useEffect(() => {
    invoke<boolean>("has_credentials")
      .then(setHasCreds)
      .catch(() => setHasCreds(false));
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
        <label className="muted">
          Region{" "}
          <select value={region} onChange={(e) => setRegion(e.currentTarget.value as Region)}>
            {REGIONS.map((r) => (
              <option key={r} value={r}>
                {r.toUpperCase()}
              </option>
            ))}
          </select>
        </label>
        <button className="ghost" onClick={clearCreds}>
          Disconnect
        </button>
      </header>

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
        <button className={tab === "warband" ? "active" : ""} onClick={() => setTab("warband")}>
          Warband
        </button>
      </nav>

      <ErrorBoundary resetKeys={[tab, region]}>
        {tab === "token" && <TokenPrice bnet={bnet} />}
        {tab === "realms" && <RealmStatus bnet={bnet} />}
        {tab === "character" && <CharacterLookup bnet={bnet} />}
        {tab === "warband" && <Warband />}
      </ErrorBoundary>
    </main>
  );
}

export default App;
