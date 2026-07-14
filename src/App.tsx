import { useEffect, useState, type FormEvent } from "react";
import { invoke } from "@tauri-apps/api/core";
import { makeClient } from "./lib/bnet";
import type { Region } from "./vendor/battlenet-wow-client";
import "./App.css";

const REGIONS: Region[] = ["us", "eu", "kr", "tw"];

const card: React.CSSProperties = {
  border: "1px solid #8884",
  borderRadius: 8,
  padding: "1rem 1.25rem",
  margin: "1rem auto",
  maxWidth: 640,
  textAlign: "left",
};

function App() {
  const [hasCreds, setHasCreds] = useState(false);
  const [clientId, setClientId] = useState("");
  const [clientSecret, setClientSecret] = useState("");
  const [region, setRegion] = useState<Region>("us");
  const [status, setStatus] = useState("");
  const [result, setResult] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    invoke<boolean>("has_credentials").then(setHasCreds).catch(() => {});
  }, []);

  async function saveCreds(e: FormEvent) {
    e.preventDefault();
    setStatus("Saving…");
    try {
      await invoke("save_credentials", { clientId, clientSecret });
      setClientId("");
      setClientSecret("");
      setHasCreds(true);
      setStatus("Credentials saved to the OS keychain.");
    } catch (err) {
      setStatus(`Error: ${String(err)}`);
    }
  }

  async function clearCreds() {
    await invoke("clear_credentials");
    setHasCreds(false);
    setResult("");
    setStatus("Credentials cleared.");
  }

  async function testToken() {
    setBusy(true);
    setStatus("Requesting token from Rust…");
    setResult("");
    try {
      const token = await invoke<string>("get_access_token");
      setStatus(`Token acquired (ends …${token.slice(-6)}). The secret never left Rust.`);
    } catch (err) {
      setStatus(`Error: ${String(err)}`);
    } finally {
      setBusy(false);
    }
  }

  async function loadTokenPrice() {
    setBusy(true);
    setStatus("Fetching the current WoW Token price…");
    setResult("");
    try {
      const bnet = makeClient(region);
      const { data, error, response } = await bnet.api.GET("/data/wow/token/index", {
        params: { query: { namespace: bnet.namespace("dynamic"), locale: "en_US" } },
      });
      if (error !== undefined) {
        setStatus(`Request failed (HTTP ${response.status}).`);
      } else {
        setStatus("WoW Token price (raw response):");
        setResult(JSON.stringify(data, null, 2));
      }
    } catch (err) {
      setStatus(`Error: ${String(err)}`);
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="container">
      <h1>WoW Companion</h1>
      <p>A Battle.net Web API desktop client — your client secret stays in Rust / the OS keychain.</p>

      {!hasCreds ? (
        <form style={card} onSubmit={saveCreds}>
          <h2>Connect your Battle.net client</h2>
          <p>
            Create one at <code>develop.battle.net/access/clients</code>, then paste the ID and secret.
          </p>
          <p>
            <input
              style={{ width: "100%" }}
              placeholder="Client ID"
              value={clientId}
              onChange={(e) => setClientId(e.currentTarget.value)}
            />
          </p>
          <p>
            <input
              style={{ width: "100%" }}
              type="password"
              placeholder="Client Secret"
              value={clientSecret}
              onChange={(e) => setClientSecret(e.currentTarget.value)}
            />
          </p>
          <button type="submit">Save to keychain</button>
        </form>
      ) : (
        <div style={card}>
          <div className="row" style={{ flexWrap: "wrap", gap: "0.5rem", justifyContent: "flex-start" }}>
            <label>
              Region:{" "}
              <select value={region} onChange={(e) => setRegion(e.currentTarget.value as Region)}>
                {REGIONS.map((r) => (
                  <option key={r} value={r}>
                    {r}
                  </option>
                ))}
              </select>
            </label>
            <button onClick={testToken} disabled={busy}>
              Test token
            </button>
            <button onClick={loadTokenPrice} disabled={busy}>
              Load WoW Token price
            </button>
            <button onClick={clearCreds} disabled={busy}>
              Clear credentials
            </button>
          </div>
        </div>
      )}

      {status && <p>{status}</p>}
      {result && (
        <pre style={{ ...card, overflowX: "auto", whiteSpace: "pre-wrap" }}>{result}</pre>
      )}
    </main>
  );
}

export default App;
