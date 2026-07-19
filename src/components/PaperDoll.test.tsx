import { describe, it, expect, beforeEach } from "vitest";
import { screen, waitFor, within } from "@testing-library/react";
import { PaperDoll } from "./PaperDoll";
import { renderWithClient } from "../test/utils";
import { mockBnet, mockResponse } from "../test/mocks";
import { QUALITY_COLORS } from "../lib/wow";

/** A two-item equipment doc: an epic head (ilvl 483) and a rare ring (ilvl 470). */
const equipment = {
  equipped_items: [
    {
      slot: { type: "HEAD", name: "Head" },
      name: "Crown of Testing",
      quality: { type: "EPIC" },
      level: { value: 483 },
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
});
