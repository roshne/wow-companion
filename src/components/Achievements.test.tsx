import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { screen, fireEvent, waitFor } from "@testing-library/react";
import { Achievements } from "./Achievements";
import { renderWithClient } from "../test/utils";
import { mockBnet, mockResponse } from "../test/mocks";

const achievementsDoc = {
  total_quantity: 1234,
  total_points: 20500,
  achievements: [
    { achievement: { id: 1, name: "The Loremaster" }, completed_timestamp: 3000 },
    { achievement: { id: 2, name: "Glory of the Raider" }, completed_timestamp: 2000 },
    { achievement: { id: 3, name: "Loremaster of Legion" }, completed_timestamp: 1000 },
  ],
};

describe("Achievements", () => {
  const originalHeight = Object.getOwnPropertyDescriptor(HTMLElement.prototype, "offsetHeight");

  // Give the virtualizer a measurable scroll viewport so its rows mount in jsdom.
  beforeEach(() => {
    Object.defineProperty(HTMLElement.prototype, "offsetHeight", {
      configurable: true,
      value: 480,
    });
  });
  afterEach(() => {
    vi.restoreAllMocks();
    if (originalHeight)
      Object.defineProperty(HTMLElement.prototype, "offsetHeight", originalHeight);
  });

  it("renders the totals and the earned-achievement rows, most-recent first", async () => {
    const { bnet, get } = mockBnet();
    get.mockResolvedValue({ data: achievementsDoc, response: mockResponse(200) });
    renderWithClient(<Achievements bnet={bnet} realmSlug="r" characterName="n" />);

    await waitFor(() => expect(screen.getByText("The Loremaster")).toBeInTheDocument());
    expect(screen.getByText("1,234")).toBeInTheDocument(); // total earned
    expect(screen.getByText("20,500")).toBeInTheDocument(); // total points
    expect(screen.getByText("Glory of the Raider")).toBeInTheDocument();
    expect(screen.getByText("Loremaster of Legion")).toBeInTheDocument();
  });

  it("filters the list by a case-insensitive name substring", async () => {
    const { bnet, get } = mockBnet();
    get.mockResolvedValue({ data: achievementsDoc, response: mockResponse(200) });
    renderWithClient(<Achievements bnet={bnet} realmSlug="r" characterName="n" />);

    await waitFor(() => expect(screen.getByText("Glory of the Raider")).toBeInTheDocument());

    fireEvent.change(screen.getByLabelText("Filter achievements"), {
      target: { value: "loremaster" },
    });

    await waitFor(() => expect(screen.queryByText("Glory of the Raider")).not.toBeInTheDocument());
    expect(screen.getByText("The Loremaster")).toBeInTheDocument();
    expect(screen.getByText("Loremaster of Legion")).toBeInTheDocument();
  });

  it("shows a no-matches note when the filter excludes everything", async () => {
    const { bnet, get } = mockBnet();
    get.mockResolvedValue({ data: achievementsDoc, response: mockResponse(200) });
    renderWithClient(<Achievements bnet={bnet} realmSlug="r" characterName="n" />);

    await waitFor(() => expect(screen.getByText("The Loremaster")).toBeInTheDocument());
    fireEvent.change(screen.getByLabelText("Filter achievements"), { target: { value: "zzzz" } });
    await waitFor(() => expect(screen.getByText("No matches.")).toBeInTheDocument());
  });

  it("shows an empty state when the character has no achievements", async () => {
    const { bnet, get } = mockBnet();
    get.mockResolvedValue({ data: { achievements: [] }, response: mockResponse(200) });
    renderWithClient(<Achievements bnet={bnet} realmSlug="r" characterName="n" />);
    await waitFor(() => expect(screen.getByText("No achievements.")).toBeInTheDocument());
  });

  it("shows an error when achievements fail to load", async () => {
    const { bnet, get } = mockBnet();
    get.mockResolvedValue({ data: undefined, response: mockResponse(500) });
    renderWithClient(<Achievements bnet={bnet} realmSlug="r" characterName="n" />);
    await waitFor(() => expect(screen.getByText("Failed (HTTP 500).")).toBeInTheDocument());
  });
});
