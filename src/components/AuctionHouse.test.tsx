import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { screen, fireEvent, waitFor, within } from "@testing-library/react";
import { AuctionHouse } from "./AuctionHouse";
import { renderWithClient } from "../test/utils";
import { mockBnet, mockResponse } from "../test/mocks";

const COMMODITIES_PATH = "/data/wow/auctions/commodities";
const REALM_AUCTIONS_PATH = "/data/wow/connected-realm/{connectedRealmId}/auctions";
const CR_SEARCH_PATH = "/data/wow/search/connected-realm";
const ITEM_PATH = "/data/wow/item/{itemId}";

const ITEMS: Record<string, { name: string; quality?: { type: string } }> = {
  "100": { name: "Copper Ore", quality: { type: "COMMON" } },
  "200": { name: "Linen Cloth", quality: { type: "COMMON" } },
  "300": { name: "Thunderfury", quality: { type: "LEGENDARY" } },
};

interface RouteOpts {
  commodities?: unknown;
  commoditiesStatus?: number;
  realmAuctions?: unknown;
}

/** Route `api.GET` by path across the commodities, realm-auctions, realm-search, and item endpoints. */
function route(get: ReturnType<typeof mockBnet>["get"], opts: RouteOpts = {}) {
  get.mockImplementation((path: string, req?: { params?: { path?: { itemId?: string } } }) => {
    if (path === COMMODITIES_PATH) {
      const status = opts.commoditiesStatus ?? 200;
      return Promise.resolve({
        data:
          status === 200
            ? (opts.commodities ?? {
                auctions: [
                  { id: 1, item: { id: 100 }, unit_price: 250, quantity: 40 },
                  { id: 2, item: { id: 200 }, unit_price: 5, quantity: 1000 },
                ],
              })
            : undefined,
        response: mockResponse(status),
      });
    }
    if (path === REALM_AUCTIONS_PATH) {
      return Promise.resolve({
        data: opts.realmAuctions ?? {
          auctions: [{ id: 1, item: { id: 300 }, buyout: 15000, quantity: 1 }],
        },
        response: mockResponse(200),
      });
    }
    if (path === CR_SEARCH_PATH) {
      return Promise.resolve({
        data: {
          pageCount: 1,
          results: [
            {
              data: { id: 1146, realms: [{ name: { en_US: "Tichondrius" }, slug: "tichondrius" }] },
            },
          ],
        },
        response: mockResponse(200),
      });
    }
    if (path === ITEM_PATH) {
      const id = req?.params?.path?.itemId ?? "";
      return Promise.resolve({
        data: ITEMS[id] ?? { name: `Unknown ${id}` },
        response: mockResponse(200),
      });
    }
    return Promise.resolve({ data: {}, response: mockResponse(200) });
  });
}

describe("AuctionHouse", () => {
  // jsdom does no layout, so offsetWidth/offsetHeight are 0 and @tanstack/react-virtual (which measures
  // the scroll element via those) would render no rows. Give every element a real box for these tests.
  const originalHeight = Object.getOwnPropertyDescriptor(HTMLElement.prototype, "offsetHeight");
  const originalWidth = Object.getOwnPropertyDescriptor(HTMLElement.prototype, "offsetWidth");

  beforeEach(() => {
    localStorage.clear();
    Object.defineProperty(HTMLElement.prototype, "offsetHeight", {
      configurable: true,
      value: 480,
    });
    Object.defineProperty(HTMLElement.prototype, "offsetWidth", { configurable: true, value: 400 });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    if (originalHeight)
      Object.defineProperty(HTMLElement.prototype, "offsetHeight", originalHeight);
    if (originalWidth) Object.defineProperty(HTMLElement.prototype, "offsetWidth", originalWidth);
  });

  /** Rendered item-cell text in DOM (== sorted) order. */
  function renderedItems(container: HTMLElement): string[] {
    return [...container.querySelectorAll(".ah-item")].map((el) => el.textContent ?? "");
  }

  it("loads region commodities by default and resolves visible item names", async () => {
    const { bnet, get } = mockBnet("us");
    route(get);
    renderWithClient(<AuctionHouse bnet={bnet} />);

    // Names resolve for the on-screen rows (viewport-only resolution).
    await screen.findByText("Copper Ore");
    expect(screen.getByText("Linen Cloth")).toBeInTheDocument();
    // Aggregated values: Linen Cloth qty 1,000 at 5c; Copper Ore at 2s 50c.
    expect(screen.getByText("1,000")).toBeInTheDocument();
    expect(screen.getByText("5c")).toBeInTheDocument();
    expect(screen.getByText("2s 50c")).toBeInTheDocument();
    // The commodities endpoint was hit; realm search was not (realm mode only).
    expect(get).toHaveBeenCalledWith(COMMODITIES_PATH, expect.anything());
    expect(get).not.toHaveBeenCalledWith(CR_SEARCH_PATH, expect.anything());
  });

  it("defaults to quantity-descending and re-sorts by price on demand", async () => {
    const { bnet, get } = mockBnet("us");
    route(get);
    const { container } = renderWithClient(<AuctionHouse bnet={bnet} />);

    await screen.findByText("Copper Ore");
    // Default: quantity desc → Linen Cloth (1000) before Copper Ore (40).
    expect(renderedItems(container)).toEqual(["Linen Cloth", "Copper Ore"]);

    // Sort by price (desc on a fresh key) → Copper Ore (250) before Linen Cloth (5).
    fireEvent.click(screen.getByRole("button", { name: /Min unit price/ }));
    await waitFor(() => expect(renderedItems(container)).toEqual(["Copper Ore", "Linen Cloth"]));
  });

  it("keeps focus on a sort header after activating it", async () => {
    // The header buttons were declared inside the component, making them a fresh component *type*
    // every render — so React remounted them on the very click that activated one, dropping focus to
    // <body> and stranding a keyboard user mid-table.
    const { bnet, get } = mockBnet("us");
    route(get);
    renderWithClient(<AuctionHouse bnet={bnet} />);
    await screen.findByText("Copper Ore");

    const priceSort = screen.getByRole("button", { name: /Min unit price/ });
    priceSort.focus();
    fireEvent.click(priceSort);

    await waitFor(() =>
      expect(screen.getByRole("button", { name: /Min unit price/ })).toHaveAttribute(
        "aria-pressed",
        "true",
      ),
    );
    expect(document.activeElement).toBe(screen.getByRole("button", { name: /Min unit price/ }));
  });

  it("exposes the virtualized list as a focusable, named scroll region", async () => {
    const { bnet, get } = mockBnet("us");
    route(get);
    renderWithClient(<AuctionHouse bnet={bnet} />);
    await screen.findByText("Copper Ore");

    // Nothing inside a virtualized list is focusable, so the scroller needs its own tab stop for the
    // rows to be reachable by keyboard at all.
    const list = screen.getByRole("group", { name: "Auction results" });
    expect(list).toHaveAttribute("tabindex", "0");
  });

  it("presents the two auction sources as a tablist over one panel", async () => {
    const { bnet, get } = mockBnet("us");
    route(get);
    renderWithClient(<AuctionHouse bnet={bnet} />);
    await screen.findByText("Copper Ore");

    const commodities = screen.getByRole("tab", { name: "Region commodities" });
    expect(commodities).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("tabpanel", { name: "Region commodities" })).toHaveAttribute(
      "id",
      commodities.getAttribute("aria-controls"),
    );
  });

  it("requires a realm selection in realm mode, then loads that realm's auctions", async () => {
    const { bnet, get } = mockBnet("us");
    route(get);
    renderWithClient(<AuctionHouse bnet={bnet} />);
    await screen.findByText("Copper Ore"); // commodities loaded first

    fireEvent.click(screen.getByRole("tab", { name: "Realm auctions" }));
    expect(screen.getByText("Choose a realm to view its auctions.")).toBeInTheDocument();

    // The picker populates from the connected-realm search.
    const select = (await screen.findByLabelText("Realm")) as HTMLSelectElement;
    await waitFor(() => expect(within(select).getByText("Tichondrius")).toBeInTheDocument());

    fireEvent.change(select, { target: { value: "1146" } });
    await screen.findByText("Thunderfury");
    expect(screen.getByText("1g 50s")).toBeInTheDocument(); // buyout 15000 copper
    expect(get).toHaveBeenCalledWith(
      REALM_AUCTIONS_PATH,
      expect.objectContaining({
        params: expect.objectContaining({ path: { connectedRealmId: 1146 } }),
      }),
    );
  });

  it("shows an error state when the snapshot fails", async () => {
    const { bnet, get } = mockBnet("us");
    route(get, { commoditiesStatus: 500 });
    renderWithClient(<AuctionHouse bnet={bnet} />);
    await screen.findByText("Failed (HTTP 500).");
  });

  it("shows an empty state when there are no auctions", async () => {
    const { bnet, get } = mockBnet("us");
    route(get, { commodities: { auctions: [] } });
    renderWithClient(<AuctionHouse bnet={bnet} />);
    await screen.findByText("No auctions found.");
  });

  it("shows a loading skeleton while the snapshot is pending", () => {
    const { bnet, get } = mockBnet("us");
    get.mockReturnValue(new Promise(() => {})); // never resolves
    renderWithClient(<AuctionHouse bnet={bnet} />);
    expect(screen.getByRole("status")).toHaveAttribute("aria-busy", "true");
  });

  it("retries the snapshot from the empty state", async () => {
    const { bnet, get } = mockBnet("us");
    route(get, { commodities: { auctions: [] } });
    renderWithClient(<AuctionHouse bnet={bnet} />);

    await screen.findByText("No auctions found.");
    const commodityCalls = () => get.mock.calls.filter((c) => c[0] === COMMODITIES_PATH).length;
    const before = commodityCalls();
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    await waitFor(() => expect(commodityCalls()).toBeGreaterThan(before));
  });
});
