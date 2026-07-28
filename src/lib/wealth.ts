import type { WarbandData, WarbandWeek } from "./warband";

/** 1 gold = 10,000 copper. Both the addon's gold and the token endpoint's price are in copper. */
const COPPER_PER_GOLD = 10_000;

/**
 * Days of game time one WoW Token grants.
 *
 * A game rule, not data — neither the API nor the addon reports it — so it lives here as a single
 * named constant rather than being inlined into a calculation. If Blizzard changes it, this is the
 * only line to edit. (The kind of constant #149's sweep exists to find.)
 */
export const DAYS_PER_TOKEN = 30;

/** Copper to whole gold, the way the app displays it everywhere else. */
export function goldFrom(copper: number): number {
  return Math.floor(copper / COPPER_PER_GOLD);
}

/**
 * Total warband wealth in copper: the warband bank plus every character's last-known gold — the
 * addon's own `GetWarbandWealth` definition, so the figure matches what Warbandeer shows in game.
 *
 * `null` when nothing is known at all, so a caller can tell "not recorded" from "you have nothing".
 * A character with no recorded gold contributes nothing rather than dragging the total to zero;
 * that's the common case, since gold is only captured when a character has been played.
 */
export function totalWealthCopper(data: WarbandData | null): number | null {
  if (!data) return null;

  const bank = data.wealth?.bankGold ?? null;
  let characters = 0;
  let anyCharacterKnown = false;
  for (const c of data.characters) {
    if (c.gold != null) {
      characters += c.gold;
      anyCharacterKnown = true;
    }
  }

  if (bank == null && !anyCharacterKnown) return null;
  return (bank ?? 0) + characters;
}

/**
 * How many WoW Tokens the warband's wealth buys at the current price.
 *
 * Fractional on purpose — rounding here would hide that you're just short of one. `null` when the
 * price is missing or non-positive: dividing by zero would render `Infinity`, which looks like a
 * real answer.
 */
export function tokensFor(
  wealthCopper: number | null,
  priceCopper: number | null | undefined,
): number | null {
  if (wealthCopper == null) return null;
  if (typeof priceCopper !== "number" || priceCopper <= 0) return null;
  return wealthCopper / priceCopper;
}

/**
 * A token count as a readable span of game time.
 *
 * One token is 30 days, so a token count and a month count are *the same number* — printing both
 * would look like two facts and read as a mistake. This converts to whatever unit actually reads
 * well at that magnitude instead.
 */
export function describeGameTime(tokens: number | null): string | null {
  if (tokens == null) return null;
  const days = tokens * DAYS_PER_TOKEN;
  if (days < 1) return "less than a day";
  if (days < 60) return `${Math.round(days)} days`;
  const months = days / DAYS_PER_TOKEN;
  if (days < 730) return `${Math.round(months)} months`;
  return `${(days / 365).toFixed(1)} years`;
}

/**
 * Gold made (or lost) so far in the open week: current wealth against the week's opening baseline.
 *
 * Negative is a real, common answer — the live history has several losing weeks — so it is returned
 * as-is rather than clamped.
 */
export function weekChangeCopper(
  totalCopper: number | null,
  week: WarbandWeek | null | undefined,
): number | null {
  if (totalCopper == null || week?.baseline == null) return null;
  return totalCopper - week.baseline;
}

/** The most recent closed weeks, newest first. The addon stores history oldest-first. */
export function recentWeeks(
  history: WarbandWeek[] | null | undefined,
  count: number,
): WarbandWeek[] {
  if (!history || count <= 0) return [];
  return history.slice(-count).reverse();
}
