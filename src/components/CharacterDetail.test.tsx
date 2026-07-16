import { describe, it, expect } from "vitest";
import { screen, fireEvent, waitFor } from "@testing-library/react";
import { CharacterDetail } from "./CharacterDetail";
import { renderWithClient } from "../test/utils";
import { mockBnet, mockResponse } from "../test/mocks";
import type { CharacterSummary } from "../lib/queries";

const summary = {
  faction: { name: "Horde" },
  equipped_item_level: 480,
  average_item_level: 478,
  achievement_points: 12345,
} as CharacterSummary;

describe("CharacterDetail", () => {
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

  it("lazily fetches gear only when the Gear tab is selected", async () => {
    const { bnet, get } = mockBnet();
    get.mockResolvedValue({
      data: {
        equipped_items: [
          {
            slot: { name: "Head", type: "HEAD" },
            name: "Crown of Testing",
            quality: { type: "EPIC" },
            level: { value: 483 },
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
    fireEvent.click(screen.getByRole("button", { name: "Gear" }));

    await waitFor(() => expect(screen.getByText("Crown of Testing")).toBeInTheDocument());
    expect(screen.getByText("Head")).toBeInTheDocument();
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
});
