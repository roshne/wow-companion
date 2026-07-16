import { describe, it, expect } from "vitest";
import {
  aggregateRealmAuctions,
  aggregateCommodities,
  type RealmAuctionEntry,
  type CommodityEntry,
} from "./auctions";

describe("aggregateRealmAuctions", () => {
  it("groups by item id: cheapest buyout, total quantity, listing count", () => {
    const auctions: RealmAuctionEntry[] = [
      { id: 1, item: { id: 100 }, buyout: 5000, quantity: 2 },
      { id: 2, item: { id: 100 }, buyout: 3000, quantity: 1 },
      { id: 3, item: { id: 200 }, buyout: 9999, quantity: 5 },
    ];
    const rows = aggregateRealmAuctions(auctions);

    const a = rows.find((r) => r.itemId === 100)!;
    expect(a).toEqual({ itemId: 100, minPrice: 3000, totalQuantity: 3, listings: 2 });
    const b = rows.find((r) => r.itemId === 200)!;
    expect(b).toEqual({ itemId: 200, minPrice: 9999, totalQuantity: 5, listings: 1 });
  });

  it("treats bid-only listings (no buyout) as having no price but still counts quantity", () => {
    const auctions: RealmAuctionEntry[] = [
      { id: 1, item: { id: 100 }, bid: 4000, quantity: 3 }, // bid-only, no buyout
      { id: 2, item: { id: 100 }, bid: 2000, quantity: 1 },
    ];
    const rows = aggregateRealmAuctions(auctions);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toEqual({ itemId: 100, minPrice: null, totalQuantity: 4, listings: 2 });
  });

  it("uses the cheapest buyout even when some listings of the item are bid-only", () => {
    const auctions: RealmAuctionEntry[] = [
      { id: 1, item: { id: 100 }, bid: 4000, quantity: 1 }, // no buyout
      { id: 2, item: { id: 100 }, buyout: 7000, quantity: 1 },
      { id: 3, item: { id: 100 }, buyout: 6000, quantity: 1 },
    ];
    const rows = aggregateRealmAuctions(auctions);
    expect(rows[0].minPrice).toBe(6000);
    expect(rows[0].totalQuantity).toBe(3);
    expect(rows[0].listings).toBe(3);
  });

  it("skips entries missing an item id", () => {
    const auctions: RealmAuctionEntry[] = [
      { id: 1, item: {}, buyout: 100, quantity: 1 },
      { id: 2, buyout: 200, quantity: 1 },
      { id: 3, item: { id: 300 }, buyout: 300, quantity: 1 },
    ];
    const rows = aggregateRealmAuctions(auctions);
    expect(rows.map((r) => r.itemId)).toEqual([300]);
  });

  it("defaults a missing quantity to zero", () => {
    const auctions: RealmAuctionEntry[] = [{ id: 1, item: { id: 100 }, buyout: 500 }];
    expect(aggregateRealmAuctions(auctions)[0].totalQuantity).toBe(0);
  });

  it("returns an empty array for undefined or empty input", () => {
    expect(aggregateRealmAuctions(undefined)).toEqual([]);
    expect(aggregateRealmAuctions([])).toEqual([]);
  });
});

describe("aggregateCommodities", () => {
  it("groups by item id: cheapest unit price, total quantity, listing count", () => {
    const auctions: CommodityEntry[] = [
      { id: 1, item: { id: 100 }, unit_price: 250, quantity: 40 },
      { id: 2, item: { id: 100 }, unit_price: 180, quantity: 60 },
      { id: 3, item: { id: 200 }, unit_price: 5, quantity: 1000 },
    ];
    const rows = aggregateCommodities(auctions);

    const a = rows.find((r) => r.itemId === 100)!;
    expect(a).toEqual({ itemId: 100, minPrice: 180, totalQuantity: 100, listings: 2 });
    const b = rows.find((r) => r.itemId === 200)!;
    expect(b).toEqual({ itemId: 200, minPrice: 5, totalQuantity: 1000, listings: 1 });
  });

  it("skips entries missing an item id and defaults missing quantity to zero", () => {
    const auctions: CommodityEntry[] = [
      { id: 1, unit_price: 5, quantity: 10 },
      { id: 2, item: { id: 300 }, unit_price: 7 },
    ];
    const rows = aggregateCommodities(auctions);
    expect(rows).toEqual([{ itemId: 300, minPrice: 7, totalQuantity: 0, listings: 1 }]);
  });

  it("returns an empty array for undefined or empty input", () => {
    expect(aggregateCommodities(undefined)).toEqual([]);
    expect(aggregateCommodities([])).toEqual([]);
  });
});
