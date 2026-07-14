import { useEffect, useMemo, useState, type FormEvent } from "react";
import { invoke } from "@tauri-apps/api/core";
import { makeClient } from "./lib/bnet";
import type { Region } from "./vendor/battlenet-wow-client";
import { TokenPrice } from "./components/TokenPrice";
import { RealmStatus } from "./components/RealmStatus";
import { CharacterLookup } from "./components/CharacterLookup";
import "./App.css";

const REGIONS: Region[] = ["us", "eu", "kr", "tw"];
type Tab = "token" | "realms" | "character";

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
      </nav>

      {tab === "token" && <TokenPrice bnet={bnet} />}
      {tab === "realms" && <RealmStatus bnet={bnet} />}
      {tab === "character" && <CharacterLookup bnet={bnet} />}
    </main>
  );
}

export default App;
