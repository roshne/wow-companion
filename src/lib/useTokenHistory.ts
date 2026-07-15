import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import type { BlizzardClient } from "../vendor/battlenet-wow-client";
import { tokenQuery, type TokenIndex } from "./queries";
import { loadTokenHistory, appendTokenPrice, type TokenPricePoint } from "./persist";

/** ~20 min matches Blizzard's token update cadence; dedupe makes any extra fetch a cheap no-op. */
const CAPTURE_INTERVAL_MS = 20 * 60 * 1000;

/** What a token display needs: the current fetch state plus the accumulated per-region series. */
export interface TokenView {
  data: TokenIndex | undefined;
  isFetching: boolean;
  isError: boolean;
  error: unknown;
  refetch: () => void;
  history: TokenPricePoint[];
}

/**
 * Fetch the current token price and accumulate a per-region price history. Intended to be mounted
 * app-wide (not just on the Token tab) so points accrue even while another tab is open: it captures on
 * an interval, on window focus, and in the background. Each new price is appended (deduped on the
 * server's `last_updated_timestamp`).
 */
export function useTokenHistory(bnet: BlizzardClient, enabled = true): TokenView {
  const query = useQuery({
    ...tokenQuery(bnet),
    enabled,
    refetchInterval: CAPTURE_INTERVAL_MS,
    refetchIntervalInBackground: true,
    refetchOnWindowFocus: true,
  });

  const [history, setHistory] = useState<TokenPricePoint[]>(() => loadTokenHistory(bnet.region));

  // Show the stored series for whichever region is active.
  useEffect(() => {
    setHistory(loadTokenHistory(bnet.region));
  }, [bnet.region]);

  // Append each new price point (deduped on the server timestamp).
  const price = query.data?.price;
  const t = query.data?.last_updated_timestamp;
  useEffect(() => {
    if (typeof price === "number" && typeof t === "number") {
      setHistory(appendTokenPrice(bnet.region, { t, price }));
    }
  }, [price, t, bnet.region]);

  return {
    data: query.data,
    isFetching: query.isFetching,
    isError: query.isError,
    error: query.error,
    refetch: () => void query.refetch(),
    history,
  };
}
