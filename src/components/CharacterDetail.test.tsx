import { describe, it, expect, beforeEach } from "vitest";
import { screen, fireEvent, waitFor } from "@testing-library/react";
import { CharacterDetail } from "./CharacterDetail";
import { renderWithClient } from "../test/utils";
import { mockBnet, mockResponse } from "../test/mocks";
import type { CharacterSummary } from "../lib/queries";
import { FACTION_COLORS } from "../lib/wow";

const summary = {
  faction: { name: "Horde" },
  equipped_item_level: 480,
  average_item_level: 478,
  achievement_points: 12345,
} as CharacterSummary;

describe("CharacterDetail", () => {
  // The Gear tab's paper doll writes the persisted item-icon cache; keep tests isolated.
  beforeEach(() => localStorage.clear());

  it("shows Overview from the summary without fetching", () => {
    const { bnet, get } = mockBnet();
    renderWithClient(
      <CharacterDetail
        bnet={bnet}
        realmSlug="tichondrius"
        characterName="asmon"
        summary={summary}
      />,
    );
    expect(screen.getByText("Horde")).toBeInTheDocument();
    expect(screen.getByText("480")).toBeInTheDocument();
    expect(screen.getByText("12,345")).toBeInTheDocument();
    expect(get).not.toHaveBeenCalled();
  });

  it("tints the Overview faction by its type", () => {
    const { bnet } = mockBnet();
    renderWithClient(
      <CharacterDetail
        bnet={bnet}
        realmSlug="tichondrius"
        characterName="asmon"
        summary={{ faction: { type: "HORDE", name: "Horde" } } as CharacterSummary}
      />,
    );
    expect(screen.getByText("Horde")).toHaveStyle({ color: FACTION_COLORS.HORDE });
  });

  it("lazily fetches specializations only when the Spec tab is selected, rendering the active build", async () => {
    const { bnet, get } = mockBnet();
    get.mockResolvedValue({
      data: {
        active_specialization: { id: 65, name: "Holy" },
        active_hero_talent_tree: { id: 1, name: "Herald of the Sun" },
        specializations: [
          {
            specialization: { id: 65, name: "Holy" },
            loadouts: [
              {
                is_active: true,
                talent_loadout_code: "CODE-XYZ",
                selected_class_talents: [{ id: 1 }, { id: 2 }],
                selected_hero_talents: [{ id: 9 }],
              },
            ],
          },
        ],
      },
      response: mockResponse(200),
    });
    renderWithClient(
      <CharacterDetail
        bnet={bnet}
        realmSlug="tichondrius"
        characterName="asmon"
        summary={summary}
      />,
    );

    expect(get).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Spec" }));

    await waitFor(() => expect(screen.getByText("Holy")).toBeInTheDocument());
    expect(screen.getByText("Herald of the Sun")).toBeInTheDocument();
    expect(screen.getByText(/2 class .+ 1 hero/)).toBeInTheDocument();
    expect(screen.getByText("CODE-XYZ")).toBeInTheDocument();
  });

  it("shows an error when specializations fail to load", async () => {
    const { bnet, get } = mockBnet();
    get.mockResolvedValue({ data: undefined, response: mockResponse(500) });
    renderWithClient(
      <CharacterDetail bnet={bnet} realmSlug="r" characterName="n" summary={summary} />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Spec" }));
    await waitFor(() => expect(screen.getByText("Failed (HTTP 500).")).toBeInTheDocument());
  });

  it("shows the empty state when there is no active specialization", async () => {
    const { bnet, get } = mockBnet();
    get.mockResolvedValue({ data: { specializations: [] }, response: mockResponse(200) });
    renderWithClient(
      <CharacterDetail bnet={bnet} realmSlug="r" characterName="n" summary={summary} />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Spec" }));
    await waitFor(() => expect(screen.getByText("No specialization data.")).toBeInTheDocument());
  });

  it("lazily fetches gear only when the Gear tab is selected, rendering the paper doll", async () => {
    const { bnet, get } = mockBnet();
    // The doll fetches equipment + character media + per-item icons; route by path.
    get.mockImplementation((path: string) => {
      if (path.endsWith("/equipment"))
        return Promise.resolve({
          data: {
            equipped_items: [
              {
                slot: { name: "Head", type: "HEAD" },
                name: "Crown of Testing",
                quality: { type: "EPIC" },
                level: { value: 483 },
                item: { id: 100 },
              },
            ],
          },
          response: mockResponse(200),
        });
      return Promise.resolve({ data: { assets: [] }, response: mockResponse(200) });
    });
    renderWithClient(
      <CharacterDetail
        bnet={bnet}
        realmSlug="tichondrius"
        characterName="asmon"
        summary={summary}
      />,
    );

    expect(get).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Gear" }));

    // The head item lands in its slot (item name via the slot's aria-label) with a visible ilvl badge.
    await waitFor(() =>
      expect(screen.getByLabelText(/^Head: Crown of Testing/)).toBeInTheDocument(),
    );
    expect(screen.getByText("483")).toBeInTheDocument();
  });

  it("shows an error when gear fails to load", async () => {
    const { bnet, get } = mockBnet();
    get.mockResolvedValue({ data: undefined, response: mockResponse(500) });
    renderWithClient(
      <CharacterDetail bnet={bnet} realmSlug="r" characterName="n" summary={summary} />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Gear" }));
    await waitFor(() => expect(screen.getByText("Failed (HTTP 500).")).toBeInTheDocument());
  });

  it("lazily fetches Mythic+ only when the M+ tab is selected, rendering the rounded rating", async () => {
    const { bnet, get } = mockBnet();
    get.mockResolvedValue({
      data: {
        current_mythic_rating: { rating: 2456.7, color: { r: 255, g: 128, b: 0 } },
        current_period: { period: { id: 987 } },
      },
      response: mockResponse(200),
    });
    renderWithClient(
      <CharacterDetail
        bnet={bnet}
        realmSlug="tichondrius"
        characterName="asmon"
        summary={summary}
      />,
    );

    expect(get).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "M+" }));

    await waitFor(() => expect(screen.getByText("2,457")).toBeInTheDocument());
    expect(screen.getByText("#987")).toBeInTheDocument();
  });

  it("shows an error when Mythic+ fails to load", async () => {
    const { bnet, get } = mockBnet();
    get.mockResolvedValue({ data: undefined, response: mockResponse(500) });
    renderWithClient(
      <CharacterDetail bnet={bnet} realmSlug="r" characterName="n" summary={summary} />,
    );

    fireEvent.click(screen.getByRole("button", { name: "M+" }));
    await waitFor(() => expect(screen.getByText("Failed (HTTP 500).")).toBeInTheDocument());
  });

  it("lazily fetches PvP only when the PvP tab is selected, rendering summary + a battleground row", async () => {
    const { bnet, get } = mockBnet();
    get.mockResolvedValue({
      data: {
        honor_level: 500,
        honorable_kills: 12000,
        pvp_map_statistics: [
          {
            world_map: { name: "Warsong Gulch", id: 1 },
            match_statistics: { played: 10, won: 6, lost: 4 },
          },
        ],
      },
      response: mockResponse(200),
    });
    renderWithClient(
      <CharacterDetail
        bnet={bnet}
        realmSlug="tichondrius"
        characterName="asmon"
        summary={summary}
      />,
    );

    expect(get).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "PvP" }));

    await waitFor(() => expect(screen.getByText("Warsong Gulch")).toBeInTheDocument());
    expect(screen.getByText("500")).toBeInTheDocument();
    expect(screen.getByText("12,000")).toBeInTheDocument();
  });

  it("shows an error when PvP fails to load", async () => {
    const { bnet, get } = mockBnet();
    get.mockResolvedValue({ data: undefined, response: mockResponse(503) });
    renderWithClient(
      <CharacterDetail bnet={bnet} realmSlug="r" characterName="n" summary={summary} />,
    );

    fireEvent.click(screen.getByRole("button", { name: "PvP" }));
    await waitFor(() => expect(screen.getByText("Failed (HTTP 503).")).toBeInTheDocument());
  });

  it("lazily fetches professions only when the Professions tab is selected", async () => {
    const { bnet, get } = mockBnet();
    get.mockResolvedValue({
      data: {
        primaries: [
          {
            profession: { name: "Blacksmithing", id: 164 },
            tiers: [
              {
                tier: { name: "Khaz Algar Blacksmithing" },
                skill_points: 45,
                max_skill_points: 100,
              },
            ],
          },
        ],
        secondaries: [{ profession: { name: "Cooking", id: 185 }, tiers: [] }],
      },
      response: mockResponse(200),
    });
    renderWithClient(
      <CharacterDetail
        bnet={bnet}
        realmSlug="tichondrius"
        characterName="asmon"
        summary={summary}
      />,
    );

    expect(get).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Professions" }));

    await waitFor(() =>
      expect(screen.getByRole("heading", { name: "Blacksmithing" })).toBeInTheDocument(),
    );
    expect(screen.getByText(/Khaz Algar Blacksmithing/)).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Cooking" })).toBeInTheDocument();
  });

  it("shows an error when professions fail to load", async () => {
    const { bnet, get } = mockBnet();
    get.mockResolvedValue({ data: undefined, response: mockResponse(500) });
    renderWithClient(
      <CharacterDetail bnet={bnet} realmSlug="r" characterName="n" summary={summary} />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Professions" }));
    await waitFor(() => expect(screen.getByText("Failed (HTTP 500).")).toBeInTheDocument());
  });

  it("lazily fetches reputations only when the Reputations tab is selected, rendering a faction row", async () => {
    const { bnet, get } = mockBnet();
    get.mockResolvedValue({
      data: {
        reputations: [
          {
            faction: { id: 2510, name: "Valdrakken Accord" },
            standing: { name: "Exalted", value: 2400, max: 3000 },
          },
        ],
      },
      response: mockResponse(200),
    });
    renderWithClient(
      <CharacterDetail
        bnet={bnet}
        realmSlug="tichondrius"
        characterName="asmon"
        summary={summary}
      />,
    );

    expect(get).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Reputations" }));

    await waitFor(() => expect(screen.getByText("Valdrakken Accord")).toBeInTheDocument());
    expect(screen.getByText("Exalted")).toBeInTheDocument();
    expect(screen.getByText("2,400 / 3,000")).toBeInTheDocument();
  });

  it("shows an error when reputations fail to load", async () => {
    const { bnet, get } = mockBnet();
    get.mockResolvedValue({ data: undefined, response: mockResponse(500) });
    renderWithClient(
      <CharacterDetail bnet={bnet} realmSlug="r" characterName="n" summary={summary} />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Reputations" }));
    await waitFor(() => expect(screen.getByText("Failed (HTTP 500).")).toBeInTheDocument());
  });

  it("shows the empty state when there are no reputations", async () => {
    const { bnet, get } = mockBnet();
    get.mockResolvedValue({ data: { reputations: [] }, response: mockResponse(200) });
    renderWithClient(
      <CharacterDetail bnet={bnet} realmSlug="r" characterName="n" summary={summary} />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Reputations" }));
    await waitFor(() => expect(screen.getByText("No reputations.")).toBeInTheDocument());
  });

  it("lazily fetches the collections only when the Collections tab is selected, rendering counts", async () => {
    const { bnet, get } = mockBnet();
    get.mockImplementation((path: string) => {
      if (path.endsWith("/collections/mounts"))
        return Promise.resolve({ data: { mounts: [{}, {}, {}] }, response: mockResponse(200) });
      if (path.endsWith("/collections/pets"))
        return Promise.resolve({ data: { pets: [{}, {}] }, response: mockResponse(200) });
      if (path.endsWith("/collections/toys"))
        return Promise.resolve({ data: { toys: [{}] }, response: mockResponse(200) });
      return Promise.resolve({ data: {}, response: mockResponse(200) });
    });
    renderWithClient(
      <CharacterDetail
        bnet={bnet}
        realmSlug="tichondrius"
        characterName="asmon"
        summary={summary}
      />,
    );

    expect(get).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Collections" }));

    await waitFor(() => {
      expect(screen.getByText("3")).toBeInTheDocument();
      expect(screen.getByText("2")).toBeInTheDocument();
      expect(screen.getByText("1")).toBeInTheDocument();
    });
  });

  it("shows an empty collection as 0 and a failed one as a dash, independently", async () => {
    const { bnet, get } = mockBnet();
    get.mockImplementation((path: string) => {
      if (path.endsWith("/collections/mounts"))
        return Promise.resolve({ data: { mounts: [{}, {}] }, response: mockResponse(200) });
      if (path.endsWith("/collections/pets"))
        return Promise.resolve({ data: { pets: [] }, response: mockResponse(200) });
      if (path.endsWith("/collections/toys"))
        return Promise.resolve({ data: undefined, response: mockResponse(500) });
      return Promise.resolve({ data: {}, response: mockResponse(200) });
    });
    renderWithClient(
      <CharacterDetail bnet={bnet} realmSlug="r" characterName="n" summary={summary} />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Collections" }));

    await waitFor(() => {
      expect(screen.getByText("2")).toBeInTheDocument(); // mounts
      expect(screen.getByText("0")).toBeInTheDocument(); // pets (empty)
      expect(screen.getByText("—")).toBeInTheDocument(); // toys (errored)
    });
  });

  it("lazily fetches raids only when the Raids tab is selected, rendering per-difficulty progress", async () => {
    const { bnet, get } = mockBnet();
    get.mockResolvedValue({
      data: {
        expansions: [
          {
            expansion: { name: "The War Within" },
            instances: [
              {
                instance: { name: "Nerub-ar Palace" },
                modes: [
                  {
                    difficulty: { name: "Heroic" },
                    progress: { completed_count: 5, total_count: 8 },
                  },
                ],
              },
            ],
          },
        ],
      },
      response: mockResponse(200),
    });
    renderWithClient(
      <CharacterDetail
        bnet={bnet}
        realmSlug="tichondrius"
        characterName="asmon"
        summary={summary}
      />,
    );

    expect(get).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Raids" }));

    await waitFor(() => expect(screen.getByText("Nerub-ar Palace")).toBeInTheDocument());
    expect(screen.getByText("Heroic")).toBeInTheDocument();
    expect(screen.getByText("5 / 8")).toBeInTheDocument();
  });

  it("shows an error when raids fail to load", async () => {
    const { bnet, get } = mockBnet();
    get.mockResolvedValue({ data: undefined, response: mockResponse(500) });
    renderWithClient(
      <CharacterDetail bnet={bnet} realmSlug="r" characterName="n" summary={summary} />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Raids" }));
    await waitFor(() => expect(screen.getByText("Failed (HTTP 500).")).toBeInTheDocument());
  });

  it("shows the empty state when there is no raid progression", async () => {
    const { bnet, get } = mockBnet();
    get.mockResolvedValue({ data: { expansions: [] }, response: mockResponse(200) });
    renderWithClient(
      <CharacterDetail bnet={bnet} realmSlug="r" characterName="n" summary={summary} />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Raids" }));
    await waitFor(() => expect(screen.getByText("No raid progression.")).toBeInTheDocument());
  });
});
