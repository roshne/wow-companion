import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import type { BlizzardClient } from "../vendor/battlenet-wow-client";
import { tokenQuery, describeError } from "../lib/queries";

/**
 * Current WoW Token price (dynamic namespace). A user-triggered read: nothing loads until the button
 * is pressed (which flips the query on); pressing it again `refetch()`es. Cached per region.
 */
export function TokenPrice({ bnet }: { bnet: BlizzardClient }) {
  const [enabled, setEnabled] = useState(false);
  const { data, isFetching, isError, error, refetch } = useQuery({
    ...tokenQuery(bnet),
    enabled,
  });

  const price =
    typeof data?.price === "number" ? `${Math.floor(data.price / 10000).toLocaleString()} g` : "";
  const updated = data?.last_updated_timestamp
    ? `Updated ${new Date(data.last_updated_timestamp).toLocaleString()}`
    : "";

  return (
    <section className="card">
      <div className="row" style={{ justifyContent: "space-between" }}>
        <h2 style={{ margin: 0 }}>WoW Token</h2>
        <button onClick={() => (enabled ? void refetch() : setEnabled(true))} disabled={isFetching}>
          {isFetching ? "…" : "Refresh"}
        </button>
      </div>
      {price && <p className="big">{price}</p>}
      {isError ? (
        <p className="muted">{describeError(error)}</p>
      ) : (
        updated && <p className="muted">{updated}</p>
      )}
    </section>
  );
}
