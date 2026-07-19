import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, within } from "@testing-library/react";

// Drive the board off a controlled useWarbandGear result — no fetching / QueryClient needed — while
// keeping the real pure derivations (weakestSlots) the board also calls.
vi.mock("../lib/useWarbandGear", async (importActual) => ({
  ...(await importActual<typeof import("../lib/useWarbandGear")>()),
  useWarbandGear: vi.fn(),
}));

import { WarbandGearBoard } from "./WarbandGearBoard";
import { useWarbandGear, type WarbandGear } from "../lib/useWarbandGear";
import type { WarbandCharacter } from "../lib/warband";

const mockUseWarbandGear = vi.mocked(useWarbandGear);

/** A gear row for one character; only the fields the board reads need to be real. */
function gearRow(
  name: string,
  itemLevels: Record<string, number>,
  over: Partial<WarbandGear> = {},
): WarbandGear {
  return {
    character: { name, realm: "Testrealm", classKey: null } as WarbandCharacter,
    region: "us",
    realmSlug: "testrealm",
    itemLevels,
    findings: [],
    tierSet: null,
    failed: false,
    ...over,
  };
}

/** Point the mocked hook at a fixed query result. */
function mockResult(result: Partial<ReturnType<typeof useWarbandGear>>) {
  mockUseWarbandGear.mockReturnValue(result as ReturnType<typeof useWarbandGear>);
}

describe("WarbandGearBoard", () => {
  beforeEach(() => mockUseWarbandGear.mockReset());

  it("renders a labeled matrix with a per-slot item-level cell for each character", () => {
    mockResult({
      isPending: false,
      isError: false,
      data: [gearRow("Tank", { HEAD: 480, MAIN_HAND: 470 }), gearRow("Healer", { HEAD: 460 })],
    });
    render(<WarbandGearBoard characters={[]} region="us" />);

    const table = screen.getByRole("table", { name: "Warband gear by slot" });
    expect(within(table).getByRole("columnheader", { name: "Head" })).toBeInTheDocument();

    const tankRow = within(table).getByText("Tank").closest("tr") as HTMLElement;
    expect(within(tankRow).getByText("480")).toBeInTheDocument();
    expect(within(tankRow).getByText("470")).toBeInTheDocument();
    // A slot this character doesn't have shows a dash.
    expect(within(tankRow).getAllByText("—").length).toBeGreaterThan(0);
  });

  it("tints a cell well below the character's own average", () => {
    mockResult({
      isPending: false,
      isError: false,
      // average 470 → LEGS (450) is 20 below → flagged low; the 480s are not.
      data: [gearRow("Tank", { HEAD: 480, CHEST: 480, LEGS: 450 })],
    });
    render(<WarbandGearBoard characters={[]} region="us" />);

    expect(screen.getByText("450")).toHaveClass("warband-board-cell-low");
    expect(
      screen.getAllByText("480").every((c) => !c.classList.contains("warband-board-cell-low")),
    ).toBe(true);
  });

  it("shows a failed notice for a character whose equipment couldn't load", () => {
    mockResult({
      isPending: false,
      isError: false,
      data: [gearRow("Broken", {}, { failed: true })],
    });
    render(<WarbandGearBoard characters={[]} region="us" />);

    expect(screen.getByText("Couldn't load gear")).toBeInTheDocument();
  });

  it("renders a loading placeholder (no matrix) while the fetch is pending", () => {
    mockResult({ isPending: true, isError: false });
    render(<WarbandGearBoard characters={[]} region="us" />);

    expect(screen.queryByRole("table")).toBeNull();
  });

  it("highlights the character's weakest slot", () => {
    mockResult({
      isPending: false,
      isError: false,
      // average 470 → LEGS (450) is the weakest (20 below); the 480s are not.
      data: [gearRow("Tank", { HEAD: 480, CHEST: 480, LEGS: 450 })],
    });
    render(<WarbandGearBoard characters={[]} region="us" />);

    expect(screen.getByText("450")).toHaveClass("warband-board-cell-weakest");
    expect(
      screen.getAllByText("480").every((c) => !c.classList.contains("warband-board-cell-weakest")),
    ).toBe(true);
  });

  it("shows the tier-set piece count for a tiered character and a dash for none", () => {
    mockResult({
      isPending: false,
      isError: false,
      data: [
        gearRow("Tiered", { HEAD: 480 }, { tierSet: { name: "Tier of Testing", pieces: 4 } }),
        gearRow("Plain", { HEAD: 470 }),
      ],
    });
    render(<WarbandGearBoard characters={[]} region="us" />);

    const table = screen.getByRole("table");
    expect(within(table).getByRole("columnheader", { name: "Set" })).toBeInTheDocument();
    // The tiered character's Set cell reads "4pc"; the plain one has none.
    const tieredRow = within(table).getByText("Tiered").closest("tr") as HTMLElement;
    expect(within(tieredRow).getByText("4pc")).toBeInTheDocument();
  });
});
