import type { TokenView } from "../lib/useTokenHistory";
import { describeError } from "../lib/queries";
import { Sparkline } from "./Sparkline";
import { SkeletonLines } from "./Skeleton";

/**
 * Current WoW Token price plus a self-accumulated price-history sparkline. Price is in copper;
 * 1 gold = 10,000 copper. The capture (fetch + history) is owned by `useTokenHistory` in `App` so it
 * accrues app-wide; this component just renders what it's handed.
 */
export function TokenPrice({ token }: { token: TokenView }) {
  const { data, isFetching, isError, error, refetch, history } = token;

  const price =
    typeof data?.price === "number" ? `${Math.floor(data.price / 10000).toLocaleString()} g` : "";
  const updated = data?.last_updated_timestamp
    ? `Updated ${new Date(data.last_updated_timestamp).toLocaleString()}`
    : "";
  // First load only: no price yet and a fetch is in flight (a failure falls through to the error line).
  const loading = !data && isFetching && !isError;

  return (
    <section className="card">
      <div className="row" style={{ justifyContent: "space-between" }}>
        <h2 style={{ margin: 0 }}>WoW Token</h2>
        <button onClick={refetch} disabled={isFetching}>
          {isFetching ? "…" : "Refresh"}
        </button>
      </div>
      {loading ? (
        <SkeletonLines lines={2} />
      ) : (
        <>
          {price && <p className="big">{price}</p>}
          {isError ? (
            <p className="muted">{describeError(error)}</p>
          ) : (
            updated && <p className="muted">{updated}</p>
          )}
          {history.length >= 2 ? (
            <Sparkline values={history.map((p) => p.price)} />
          ) : (
            <p className="muted">Collecting price history…</p>
          )}
        </>
      )}
    </section>
  );
}
