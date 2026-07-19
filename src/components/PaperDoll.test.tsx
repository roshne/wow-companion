import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { screen, waitFor, within, fireEvent } from "@testing-library/react";
import { PaperDoll } from "./PaperDoll";
import { renderWithClient } from "../test/utils";
import { mockBnet, mockResponse } from "../test/mocks";
import { QUALITY_COLORS } from "../lib/wow";

/** Install a `window.matchMedia` reporting the given match state (drives the narrow-viewport switch). */
function installMatchMedia(matches: boolean) {
  window.matchMedia = vi.fn().mockImplementation((query: string) => ({
    matches,
    media: query,
    onchange: null,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
    dispatchEvent: () => false,
  })) as unknown as typeof window.matchMedia;
}

/** A two-item equipment doc: an epic head (ilvl 483) and a rare ring (ilvl 470). */
const equipment = {
  equipped_items: [
    {
      slot: { type: "HEAD", name: "Head" },
      name: "Crown of Testing",
      quality: { type: "EPIC" },
      level: { value: 483 },
      binding: { type: "ON_ACQUIRE", name: "Soulbound" },
      item: { id: 100 },
    },
    {
      slot: { type: "FINGER_1", name: "Ring 1" },
      name: "Band of Testing",
      quality: { type: "RARE" },
      level: { value: 470 },
      item: { id: 200 },
    },
  ],
};

/** Route the shared GET mock by path: the equipment doc, the media assets, and per-item icon media. */
function routeGet(
  get: ReturnType<typeof mockBnet>["get"],
  { media = { assets: [] as { key: string; value: string }[] } }: { media?: unknown } = {},
) {
  get.mockImplementation((path: string, opts?: { params?: { path?: { itemId?: number } } }) => {
    if (path.endsWith("/equipment"))
      return Promise.resolve({ data: equipment, response: mockResponse(200) });
    if (path.endsWith("/character-media"))
      return Promise.resolve({ data: media, response: mockResponse(200) });
    if (path === "/data/wow/media/item/{itemId}") {
      const id = opts?.params?.path?.itemId;
      return Promise.resolve({
        data: { assets: [{ key: "icon", value: `http://icon/${id}.jpg` }] },
        response: mockResponse(200),
      });
    }
    return Promise.resolve({ data: {}, response: mockResponse(200) });
  });
}

describe("PaperDoll", () => {
  beforeEach(() => localStorage.clear());
  // Most tests want the wide (doll) layout, which is the default when matchMedia is absent; the
  // narrow-viewport tests install it, so clear it back to undefined afterwards.
  afterEach(() => {
    delete (window as Partial<Window & typeof globalThis>).matchMedia;
  });

  it("places each equipped item in its slot by slot.type, with its resolved icon", async () => {
    const { bnet, get } = mockBnet();
    routeGet(get);
    renderWithClient(<PaperDoll bnet={bnet} realmSlug="r" characterName="Asmon" />);

    const head = await screen.findByLabelText(/^Head: Crown of Testing/);
    const ring = screen.getByLabelText(/^Ring 1: Band of Testing/);

    // Icons resolve lazily into their own slots (routed by item id).
    await waitFor(() =>
      expect(head.querySelector("img")).toHaveAttribute("src", "http://icon/100.jpg"),
    );
    expect(ring.querySelector("img")).toHaveAttribute("src", "http://icon/200.jpg");
  });

  it("renders a slot absent from the doc as a muted empty slot", async () => {
    const { bnet, get } = mockBnet();
    routeGet(get);
    renderWithClient(<PaperDoll bnet={bnet} realmSlug="r" characterName="Asmon" />);

    const offHand = await screen.findByLabelText("Off Hand: empty");
    expect(offHand).toHaveClass("empty");
    expect(offHand.querySelector("img")).toBeNull();
  });

  it("colors each slot border by quality and shows the item-level badge", async () => {
    const { bnet, get } = mockBnet();
    routeGet(get);
    renderWithClient(<PaperDoll bnet={bnet} realmSlug="r" characterName="Asmon" />);

    const head = await screen.findByLabelText(/^Head:/);
    expect(head).toHaveStyle({ borderColor: QUALITY_COLORS.EPIC });
    expect(within(head).getByText("483")).toBeInTheDocument();

    const ring = screen.getByLabelText(/^Ring 1:/);
    expect(ring).toHaveStyle({ borderColor: QUALITY_COLORS.RARE });
    expect(within(ring).getByText("470")).toBeInTheDocument();
  });

  it("uses the full-body render when the media doc has one", async () => {
    const { bnet, get } = mockBnet();
    routeGet(get, {
      media: {
        assets: [
          { key: "main-raw", value: "http://img/raw.png" },
          { key: "avatar", value: "http://img/a.jpg" },
        ],
      },
    });
    const { container } = renderWithClient(
      <PaperDoll bnet={bnet} realmSlug="r" characterName="Asmon" />,
    );

    await waitFor(() =>
      expect(container.querySelector(".doll-render")).toHaveAttribute("src", "http://img/raw.png"),
    );
    expect(container.querySelector(".doll-render")).not.toHaveClass("avatar-fallback");
  });

  it("falls back to the avatar when there is no full-body render", async () => {
    const { bnet, get } = mockBnet();
    routeGet(get, { media: { assets: [{ key: "avatar", value: "http://img/a.jpg" }] } });
    const { container } = renderWithClient(
      <PaperDoll bnet={bnet} realmSlug="r" characterName="Asmon" />,
    );

    await waitFor(() =>
      expect(container.querySelector(".doll-render")).toHaveAttribute("src", "http://img/a.jpg"),
    );
    expect(container.querySelector(".doll-render")).toHaveClass("avatar-fallback");
  });

  it("falls back to a name-initial placeholder when neither render nor avatar exists", async () => {
    const { bnet, get } = mockBnet();
    routeGet(get, { media: { assets: [] } });
    const { container } = renderWithClient(
      <PaperDoll bnet={bnet} realmSlug="r" characterName="Asmon" />,
    );

    // Wait for the doll (equipment) to render, then assert the placeholder — no render image.
    await screen.findByLabelText(/^Head:/);
    const placeholder = container.querySelector(".doll-render-placeholder");
    expect(placeholder).toBeInTheDocument();
    expect(placeholder).toHaveTextContent("A");
    expect(container.querySelector(".doll-render")).toBeNull();
  });

  it("shows an error when equipment fails to load", async () => {
    const { bnet, get } = mockBnet();
    get.mockResolvedValue({ data: undefined, response: mockResponse(500) });
    renderWithClient(<PaperDoll bnet={bnet} realmSlug="r" characterName="Asmon" />);

    await waitFor(() => expect(screen.getByText("Failed (HTTP 500).")).toBeInTheDocument());
  });

  it("renders the compact list — not the doll — on a narrow viewport", async () => {
    installMatchMedia(true);
    const { bnet, get } = mockBnet();
    routeGet(get);
    const { container } = renderWithClient(
      <PaperDoll bnet={bnet} realmSlug="r" characterName="Asmon" />,
    );

    const table = await screen.findByRole("table", { name: "Equipment" });
    expect(table).toBeInTheDocument();
    // The 2D doll is not in the DOM — this is a real swap, not a CSS hide.
    expect(container.querySelector(".paper-doll")).toBeNull();
    expect(within(table).getByText("Crown of Testing")).toBeInTheDocument();
    expect(within(table).getByText("Head")).toBeInTheDocument();
    expect(within(table).getByText("483")).toBeInTheDocument();
  });

  it("the list carries the same slot / item / ilvl data as the doll", async () => {
    installMatchMedia(true);
    const { bnet, get } = mockBnet();
    routeGet(get);
    renderWithClient(<PaperDoll bnet={bnet} realmSlug="r" characterName="Asmon" />);

    const table = await screen.findByRole("table", { name: "Equipment" });
    // Both equipped items appear, each with its slot label, quality-colored name, and item level.
    expect(within(table).getByText("Head")).toBeInTheDocument();
    expect(within(table).getByText("Ring 1")).toBeInTheDocument();
    expect(within(table).getByText("Crown of Testing")).toHaveStyle({ color: QUALITY_COLORS.EPIC });
    expect(within(table).getByText("483")).toBeInTheDocument();
    expect(within(table).getByText("Band of Testing")).toHaveStyle({ color: QUALITY_COLORS.RARE });
    expect(within(table).getByText("470")).toBeInTheDocument();
  });

  it("exposes the list as a labeled table with column headers", async () => {
    installMatchMedia(true);
    const { bnet, get } = mockBnet();
    routeGet(get);
    renderWithClient(<PaperDoll bnet={bnet} realmSlug="r" characterName="Asmon" />);

    await screen.findByRole("table", { name: "Equipment" });
    expect(screen.getByRole("columnheader", { name: "Slot" })).toBeInTheDocument();
    expect(screen.getByRole("columnheader", { name: "Item" })).toBeInTheDocument();
    expect(screen.getByRole("columnheader", { name: "iLvl" })).toBeInTheDocument();
  });

  it("the slot triggers are buttons carrying the per-slot aria-label (keyboard-operable)", async () => {
    const { bnet, get } = mockBnet();
    routeGet(get);
    renderWithClient(<PaperDoll bnet={bnet} realmSlug="r" characterName="Asmon" />);

    // Real <button> elements → the platform maps Enter/Space to activation; the aria-label is per-slot.
    expect(
      await screen.findByRole("button", { name: /^Head: Crown of Testing/ }),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^Ring 1: Band of Testing/ })).toBeInTheDocument();
  });

  it("opens the detail popover with the item's name / ilvl / binding when a slot is activated", async () => {
    const { bnet, get } = mockBnet();
    routeGet(get);
    renderWithClient(<PaperDoll bnet={bnet} realmSlug="r" characterName="Asmon" />);

    const head = await screen.findByRole("button", { name: /^Head: Crown of Testing/ });
    expect(screen.queryByRole("dialog")).toBeNull();

    fireEvent.click(head);

    const dialog = screen.getByRole("dialog", { name: "Crown of Testing" });
    expect(within(dialog).getByText("Item Level 483")).toBeInTheDocument();
    expect(within(dialog).getByText("Soulbound")).toBeInTheDocument();
  });

  it("opens the detail popover from a compact list row too", async () => {
    installMatchMedia(true);
    const { bnet, get } = mockBnet();
    routeGet(get);
    renderWithClient(<PaperDoll bnet={bnet} realmSlug="r" characterName="Asmon" />);

    const row = await screen.findByRole("button", { name: "Head: Crown of Testing" });
    fireEvent.click(row);

    expect(screen.getByRole("dialog", { name: "Crown of Testing" })).toBeInTheDocument();
  });

  it("closes the popover on Escape and returns focus to the trigger", async () => {
    const { bnet, get } = mockBnet();
    routeGet(get);
    renderWithClient(<PaperDoll bnet={bnet} realmSlug="r" characterName="Asmon" />);

    const head = await screen.findByRole("button", { name: /^Head: Crown of Testing/ });
    head.focus();
    fireEvent.click(head);
    expect(screen.getByRole("dialog")).toBeInTheDocument();

    fireEvent.keyDown(document, { key: "Escape" });

    expect(screen.queryByRole("dialog")).toBeNull();
    expect(head).toHaveFocus();
  });

  it("closes the popover on click-outside and returns focus to the trigger", async () => {
    const { bnet, get } = mockBnet();
    routeGet(get);
    renderWithClient(<PaperDoll bnet={bnet} realmSlug="r" characterName="Asmon" />);

    const head = await screen.findByRole("button", { name: /^Head: Crown of Testing/ });
    head.focus();
    fireEvent.click(head);
    expect(screen.getByRole("dialog")).toBeInTheDocument();

    fireEvent.mouseDown(document.body);

    expect(screen.queryByRole("dialog")).toBeNull();
    expect(head).toHaveFocus();
  });

  it("swaps the popover to another slot's item — only one open at a time", async () => {
    const { bnet, get } = mockBnet();
    routeGet(get);
    renderWithClient(<PaperDoll bnet={bnet} realmSlug="r" characterName="Asmon" />);

    const head = await screen.findByRole("button", { name: /^Head: Crown of Testing/ });
    fireEvent.click(head);
    expect(screen.getByRole("dialog", { name: "Crown of Testing" })).toBeInTheDocument();

    const ring = screen.getByRole("button", { name: /^Ring 1: Band of Testing/ });
    fireEvent.click(ring);

    expect(screen.getAllByRole("dialog")).toHaveLength(1);
    expect(screen.getByRole("dialog", { name: "Band of Testing" })).toBeInTheDocument();
    expect(screen.queryByRole("dialog", { name: "Crown of Testing" })).toBeNull();
  });
});
