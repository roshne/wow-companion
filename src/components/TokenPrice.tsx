import { useState } from "react";
import type { BlizzardClient } from "../vendor/battlenet-wow-client";

/** Current WoW Token price (dynamic namespace). Price is in copper; 1 gold = 10,000 copper. */
export function TokenPrice({ bnet }: { bnet: BlizzardClient }) {
  const [price, setPrice] = useState("");
  const [sub, setSub] = useState("");
  const [busy, setBusy] = useState(false);

  async function load() {
    setBusy(true);
    setPrice("");
    setSub("Fetching…");
    try {
      const { data, response } = await bnet.api.GET("/data/wow/token/index", {
        params: { query: { namespace: bnet.namespace("dynamic"), locale: "en_US" } },
      });
      if (!response.ok) {
        setSub(`Failed (HTTP ${response.status}).`);
        return;
      }
      const d = data as unknown as { price?: number; last_updated_timestamp?: number };
      if (typeof d.price === "number") {
        setPrice(`${Math.floor(d.price / 10000).toLocaleString()} g`);
        setSub(
          d.last_updated_timestamp
            ? `Updated ${new Date(d.last_updated_timestamp).toLocaleString()}`
            : "",
        );
      } else {
        setSub("No price in the response.");
      }
    } catch (e) {
      setSub(`Error: ${String(e)}`);
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="card">
      <div className="row" style={{ justifyContent: "space-between" }}>
        <h2 style={{ margin: 0 }}>WoW Token</h2>
        <button onClick={load} disabled={busy}>
          {busy ? "…" : "Refresh"}
        </button>
      </div>
      {price && <p className="big">{price}</p>}
      {sub && <p className="muted">{sub}</p>}
    </section>
  );
}
