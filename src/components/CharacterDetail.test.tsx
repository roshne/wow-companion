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
});
