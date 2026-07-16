// Auction-house data model and aggregation.
//
// The browser has two *modes*, each backed by a different endpoint and per-listing shape:
//   - "realm"       — a connected realm's auction house (`buyout`/`bid`, gear `bonus_lists`/`modifiers`,
//                     pet fields); prices are per *stack*.
//   - "commodities" — the region-wide stackable-goods market (`unit_price`); prices are per *unit*.
//
// Both snapshots can carry tens of thousands of listings, so they're collapsed **by `item.id`** into a
// compact `AggregatedRow[]` (min price, total quantity, listing count) before anything renders. This is
// what makes viewport-only name resolution pay off: far fewer distinct ids to resolve, and the held
// snapshot stays small. Aggregation is pure and deterministic (first-seen id order) so it's testable in
// isolation from the network.

import type { paths } from "../vendor/battlenet-wow-client";

/** A connected realm's auction snapshot (dynamic namespace). */
export type RealmAuctions =
  paths["/data/wow/connected-realm/{connectedRealmId}/auctions"]["get"]["responses"][200]["content"]["application/json"];

/** One realm auction listing: an item (with bonus lists / modifiers / pet fields), bid, buyout, stack. */
export type RealmAuctionEntry = NonNullable<RealmAuctions["auctions"]>[number];

/** The region-wide commodities snapshot (dynamic namespace). */
export type Commodities =
  paths["/data/wow/auctions/commodities"]["get"]["responses"][200]["content"]["application/json"];

/** One commodity listing: an item id, a per-unit price, and a stackable quantity. */
export type CommodityEntry = NonNullable<Commodities["auctions"]>[number];

/** Which auction market is being browsed. */
export type AuctionMode = "realm" | "commodities";

/**
 * One item's collapsed listings. `minPrice` is the cheapest per-*stack* buyout (realm) or per-*unit*
 * price (commodities), in copper — `null` when no listing carries a price (e.g. a realm item that's
 * only ever up for bid). `totalQuantity` sums stack sizes across all listings; `listings` counts them.
 */
export interface AggregatedRow {
  itemId: number;
  minPrice: number | null;
  totalQuantity: number;
  listings: number;
}

/** Fold the lowest price into a running minimum, treating a missing/invalid price as "no price". */
function lowerPrice(current: number | null, price: number | undefined): number | null {
  if (typeof price !== "number" || !Number.isFinite(price)) return current;
  return current === null ? price : Math.min(current, price);
}

/** Aggregate realm auctions by item id: cheapest `buyout`, total quantity, listing count. */
export function aggregateRealmAuctions(auctions: RealmAuctionEntry[] | undefined): AggregatedRow[] {
  const byItem = new Map<number, AggregatedRow>();
  for (const a of auctions ?? []) {
    const id = a.item?.id;
    if (typeof id !== "number") continue;
    const row = byItem.get(id) ?? { itemId: id, minPrice: null, totalQuantity: 0, listings: 0 };
    row.minPrice = lowerPrice(row.minPrice, a.buyout);
    row.totalQuantity += a.quantity ?? 0;
    row.listings += 1;
    byItem.set(id, row);
  }
  return [...byItem.values()];
}

/** Aggregate region commodities by item id: cheapest `unit_price`, total quantity, listing count. */
export function aggregateCommodities(auctions: CommodityEntry[] | undefined): AggregatedRow[] {
  const byItem = new Map<number, AggregatedRow>();
  for (const a of auctions ?? []) {
    const id = a.item?.id;
    if (typeof id !== "number") continue;
    const row = byItem.get(id) ?? { itemId: id, minPrice: null, totalQuantity: 0, listings: 0 };
    row.minPrice = lowerPrice(row.minPrice, a.unit_price);
    row.totalQuantity += a.quantity ?? 0;
    row.listings += 1;
    byItem.set(id, row);
  }
  return [...byItem.values()];
}
