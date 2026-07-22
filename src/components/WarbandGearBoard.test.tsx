import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, within, fireEvent } from "@testing-library/react";

// Drive the board off a controlled useWarbandGear result — no fetching / QueryClient needed — while
// keeping the real pure derivations (weakestSlots) the board also calls.
// `weakestSlots` is spied rather than stubbed: it's per-row work the board does at render time, so
// counting its calls is how the row memo is observed.
vi.mock("../lib/useWarbandGear", async (importActual) => {
  const actual = await importActual<typeof import("../lib/useWarbandGear")>();
  return { ...actual, useWarbandGear: vi.fn(), weakestSlots: vi.fn(actual.weakestSlots) };
});

import { WarbandGearBoard } from "./WarbandGearBoard";
import {
  useWarbandGear,
  weakestSlots,
  type WarbandGear,
  type WarbandRow,
} from "../lib/useWarbandGear";
import type { WarbandCharacter } from "../lib/warband";

const mockUseWarbandGear = vi.mocked(useWarbandGear);
const mockWeakestSlots = vi.mocked(weakestSlots);

const character = (name: string, over: Partial<WarbandCharacter> = {}): WarbandCharacter =>
  ({
    name,
    realm: "Testrealm",
    classKey: null,
    className: null,
    role: null,
    itemLevel: null,
    ...over,
  }) as WarbandCharacter;

/** A resolved row for one character; only the fields the board reads need to be real. */
function loadedRow(
  name: string,
  itemLevels: Record<string, number>,
  over: Partial<WarbandGear> = {},
  charOver: Partial<WarbandCharacter> = {},
): WarbandRow {
  const c = character(name, charOver);
  return {
    character: c,
    gear: {
      character: c,
      region: "us",
      realmSlug: "testrealm",
      itemLevels,
      findings: [],
      tierSet: null,
      failed: false,
      ...over,
    },
  };
}

/** A row whose fetch failed. */
function failedRow(name: string): WarbandRow {
  const c = character(name);
  return {
    character: c,
    gear: {
      character: c,
      region: "us",
      realmSlug: "testrealm",
      itemLevels: {},
      findings: [],
      tierSet: null,
      failed: true,
    },
  };
}

/** A row still in flight. */
const pendingRow = (name: string): WarbandRow => ({ character: character(name), gear: null });

/** Point the mocked hook at a fixed result. */
function mockResult(over: Partial<ReturnType<typeof useWarbandGear>>) {
  mockUseWarbandGear.mockReturnValue({
    rows: [],
    error: null,
    refetch: vi.fn(),
    ...over,
  } as ReturnType<typeof useWarbandGear>);
}

describe("WarbandGearBoard", () => {
  beforeEach(() => {
    mockUseWarbandGear.mockReset();
    mockWeakestSlots.mockClear();
  });

  it("re-renders only the row that changed as rows stream in", () => {
    // Each arriving row re-renders the board, so an unmemoized row meant every *other* character
    // recomputed its average and weakest slots on every arrival — quadratic in roster size.
    const settled = loadedRow("Settled", { HEAD: 480, LEGS: 440 });
    mockResult({ rows: [settled, pendingRow("Arriving")] });
    const { rerender } = render(<WarbandGearBoard characters={[]} region="us" />);
    const afterFirstPaint = mockWeakestSlots.mock.calls.length;

    // "Arriving" resolves; "Settled" hands down the very same character + gear objects.
    mockResult({ rows: [settled, loadedRow("Arriving", { HEAD: 470 })] });
    rerender(<WarbandGearBoard characters={[]} region="us" />);

    // Exactly one more row computed — the one that changed.
    expect(mockWeakestSlots.mock.calls.length).toBe(afterFirstPaint + 1);
    expect(screen.getByText("470")).toBeInTheDocument();
  });

  it("renders a labeled matrix with a per-slot item-level cell for each character", () => {
    mockResult({
      rows: [loadedRow("Tank", { HEAD: 480, MAIN_HAND: 470 }), loadedRow("Healer", { HEAD: 460 })],
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
    // average 470 → LEGS (450) is 20 below → flagged low; the 480s are not.
    mockResult({ rows: [loadedRow("Tank", { HEAD: 480, CHEST: 480, LEGS: 450 })] });
    render(<WarbandGearBoard characters={[]} region="us" />);

    expect(screen.getByText("450")).toHaveClass("warband-board-cell-low");
    expect(
      screen.getAllByText("480").every((c) => !c.classList.contains("warband-board-cell-low")),
    ).toBe(true);
  });

  it("streams: a still-loading row shows a loading notice while a resolved row shows its cells", () => {
    mockResult({ rows: [loadedRow("Ready", { HEAD: 480 }), pendingRow("Pending")] });
    render(<WarbandGearBoard characters={[]} region="us" />);

    const table = screen.getByRole("table");
    const readyRow = within(table).getByText("Ready").closest("tr") as HTMLElement;
    expect(within(readyRow).getByText("480")).toBeInTheDocument();

    const pendingTr = within(table).getByText("Pending").closest("tr") as HTMLElement;
    expect(within(pendingTr).getByText("Loading…")).toBeInTheDocument();
  });

  it("shows a failed notice for a character whose equipment couldn't load, without blocking others", () => {
    mockResult({ rows: [loadedRow("Ok", { HEAD: 470 }), failedRow("Broken")] });
    render(<WarbandGearBoard characters={[]} region="us" />);

    expect(screen.getByText("Couldn't load gear")).toBeInTheDocument();
    // The other row still renders its data.
    expect(screen.getByText("470")).toBeInTheDocument();
  });

  it("highlights the character's weakest slot", () => {
    // average 470 → LEGS (450) is the weakest (20 below); the 480s are not.
    mockResult({ rows: [loadedRow("Tank", { HEAD: 480, CHEST: 480, LEGS: 450 })] });
    render(<WarbandGearBoard characters={[]} region="us" />);

    expect(screen.getByText("450")).toHaveClass("warband-board-cell-weakest");
    expect(
      screen.getAllByText("480").every((c) => !c.classList.contains("warband-board-cell-weakest")),
    ).toBe(true);
  });

  it("shows the tier-set piece count for a tiered character and a dash for none", () => {
    mockResult({
      rows: [
        loadedRow("Tiered", { HEAD: 480 }, { tierSet: { name: "Tier of Testing", pieces: 4 } }),
        loadedRow("Plain", { HEAD: 470 }),
      ],
    });
    render(<WarbandGearBoard characters={[]} region="us" />);

    const table = screen.getByRole("table");
    expect(within(table).getByRole("columnheader", { name: "Set" })).toBeInTheDocument();
    const tieredRow = within(table).getByText("Tiered").closest("tr") as HTMLElement;
    expect(within(tieredRow).getByText("4pc")).toBeInTheDocument();
  });

  it("shows a whole-board error with retry when the shared prerequisite fails", () => {
    const refetch = vi.fn();
    mockResult({ rows: [], error: new Error("indexes down"), refetch });
    render(<WarbandGearBoard characters={[]} region="us" />);

    // No matrix — an error state with a working Retry instead.
    expect(screen.queryByRole("table")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(refetch).toHaveBeenCalledTimes(1);
  });

  it("filters the rows by class", () => {
    mockResult({
      rows: [
        loadedRow("Warr", { HEAD: 480 }, {}, { classKey: "WARRIOR", className: "Warrior" }),
        loadedRow("Dudu", { HEAD: 470 }, {}, { classKey: "DRUID", className: "Druid" }),
      ],
    });
    render(<WarbandGearBoard characters={[]} region="us" />);

    expect(screen.getByText("Warr")).toBeInTheDocument();
    expect(screen.getByText("Dudu")).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText("Filter by class"), { target: { value: "DRUID" } });

    expect(screen.queryByText("Warr")).not.toBeInTheDocument();
    expect(screen.getByText("Dudu")).toBeInTheDocument();
  });

  it("reorders the rows when a sort control is toggled", () => {
    mockResult({ rows: [loadedRow("Low", { HEAD: 450 }), loadedRow("High", { HEAD: 490 })] });
    render(<WarbandGearBoard characters={[]} region="us" />);

    // Default sort is item level descending → the higher-ilvl character first.
    expect(screen.getAllByRole("rowheader").map((th) => th.textContent)).toEqual(["High", "Low"]);

    // Toggle item level to ascending.
    fireEvent.click(screen.getByRole("button", { name: /Item level/ }));
    expect(screen.getAllByRole("rowheader").map((th) => th.textContent)).toEqual(["Low", "High"]);
  });

  it("shows the warband needs-attention roll-up above the board", () => {
    mockResult({ rows: [loadedRow("Tank", { HEAD: 480 })] });
    render(<WarbandGearBoard characters={[]} region="us" />);

    // A clean roster reads "All set"; the summary is wired to the board's rows.
    expect(screen.getByText(/All set/)).toBeInTheDocument();
  });
});
