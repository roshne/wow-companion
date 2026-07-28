import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import type { Region } from "../vendor/battlenet-wow-client";
import type { WarbandData } from "../lib/warband";
import { makeClient } from "../lib/bnet";
import { tokenQuery } from "../lib/queries";
import {
  describeGameTime,
  goldFrom,
  recentWeeks,
  tokensFor,
  totalWealthCopper,
  weekChangeCopper,
} from "../lib/wealth";

const gold = (copper: number) => `${goldFrom(copper).toLocaleString()} g`;

/**
 * A gold delta with its sign and the tone to render it in.
 *
 * Flat covers both an exactly-zero week (the live history has one) and a sub-gold change, because
 * the sign has to agree with the number that's actually shown — "+0 g" coloured as a gain reads as a
 * bug, and a change too small to survive rounding isn't a gain either.
 */
function delta(copper: number): { text: string; tone: "up" | "down" | "flat" } {
  const magnitude = goldFrom(Math.abs(copper));
  if (magnitude === 0) return { text: "0 g", tone: "flat" };
  return {
    text: `${copper < 0 ? "−" : "+"}${magnitude.toLocaleString()} g`,
    tone: copper < 0 ? "down" : "up",
  };
}

/**
 * Warband wealth, and what it's worth in WoW Tokens.
 *
 * The one fusion in the app that needs no new data: the addon already records gold and the token
 * price is already fetched, and both are in copper so the ratio is a straight division. The point is
 * legibility — "3,010,416 gold" means little, "11 tokens, about 11 months of game time" is a fact
 * you can act on.
 *
 * The token price is read through the same `tokenQuery` the app-wide capture uses, so this shares
 * its cache rather than issuing a second request. If it hasn't loaded (or failed), the gold still
 * renders and only the conversion is omitted — the local figure must never depend on the network.
 *
 * Renders nothing at all when no wealth was recorded, since this sits above every Warband view and
 * an empty placeholder there would be noise.
 */
export function WarbandWealth({ data, region }: { data: WarbandData | null; region: Region }) {
  const bnet = useMemo(() => makeClient(region), [region]);
  const { data: token } = useQuery(tokenQuery(bnet));

  const total = useMemo(() => totalWealthCopper(data), [data]);
  const tokens = tokensFor(total, token?.price);
  const gameTime = describeGameTime(tokens);
  const change = weekChangeCopper(total, data?.wealth?.week);
  const weeks = recentWeeks(data?.wealth?.history, 3);
  const { text: changeText, tone: changeTone } = delta(change ?? 0);

  if (total == null) return null;

  return (
    <p className="warband-wealth">
      <strong>{gold(total)}</strong>
      {tokens != null ? (
        <>
          {" · "}
          {tokens.toLocaleString(undefined, { maximumFractionDigits: 1 })} tokens
          {gameTime ? <span className="muted"> ({gameTime} of game time)</span> : null}
        </>
      ) : null}
      {change != null ? (
        <>
          {" · "}
          <span className={changeTone === "flat" ? undefined : `wealth-${changeTone}`}>
            {changeText}
          </span>
          <span className="muted"> this week</span>
        </>
      ) : null}
      {weeks.length > 0 ? (
        <span className="muted" title="Closed weeks, most recent first">
          {" · previous: "}
          {weeks.map((w) => (w.made == null ? "—" : delta(w.made).text)).join(", ")}
        </span>
      ) : null}
    </p>
  );
}
