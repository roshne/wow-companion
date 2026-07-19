import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

// Warband loads the local Warbandeer export via the `get_warband` Tauri command; mock it.
vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
// Stub the gear board so these tests exercise the toggle without its data-fetching internals.
vi.mock("./WarbandGearBoard", () => ({
  WarbandGearBoard: () => <div data-testid="gear-board">board</div>,
}));

import { Warband } from "./Warband";
import { invoke } from "@tauri-apps/api/core";
import type { WarbandCharacter, WarbandData } from "../lib/warband";

const mockInvoke = vi.mocked(invoke);
const onOpen = vi.fn();

/** A character with sensible defaults; override just the fields a test cares about. */
function character(overrides: Partial<WarbandCharacter> = {}): WarbandCharacter {
  return {
    name: "Nobody",
    realm: "Testrealm",
    guid: null,
    classId: null,
    classKey: null,
    className: null,
    level: null,
    itemLevel: null,
    spec: null,
    role: null,
    professionPrimary: null,
    professionSecondary: null,
    guild: null,
    faction: null,
    ...overrides,
  };
}

function warband(characters: WarbandCharacter[], account = "TESTACCOUNT"): WarbandData {
  return { account, source: "C:/wow/SavedVariables/Warbandeer_Characters.lua", characters };
}

describe("Warband", () => {
  beforeEach(() => {
    mockInvoke.mockReset();
    onOpen.mockReset();
  });

  it("auto-loads on mount and renders a roster with the account summary", async () => {
    mockInvoke.mockResolvedValue(
      warband([
        character({ name: "Testchar", realm: "Testrealm", level: 90, itemLevel: 278 }),
        character({ name: "Altchar", realm: "Altrealm", level: 60, itemLevel: 150 }),
      ]),
    );
    render(<Warband onOpenCharacter={onOpen} region="us" />);

    await screen.findByText("Testchar");
    expect(screen.getByText("Altchar")).toBeInTheDocument();
    expect(mockInvoke).toHaveBeenCalledWith("get_warband");
    // "N characters · account" summary.
    expect(screen.getByText(/2 characters ·\s*TESTACCOUNT/)).toBeInTheDocument();
  });

  it("shows a busy Refresh button while the load is pending", () => {
    mockInvoke.mockReturnValue(new Promise(() => {})); // never resolves
    render(<Warband onOpenCharacter={onOpen} region="us" />);

    const button = screen.getByRole("button");
    expect(button).toHaveTextContent("…");
    expect(button).toBeDisabled();
  });

  it("surfaces an error and renders no table when the command fails", async () => {
    mockInvoke.mockRejectedValue("Could not find Warbandeer_Characters.lua.");
    render(<Warband onOpenCharacter={onOpen} region="us" />);

    await screen.findByText("Could not find Warbandeer_Characters.lua.");
    expect(screen.queryByRole("table")).toBeNull();
  });

  it("shows an empty state when the export has no characters", async () => {
    mockInvoke.mockResolvedValue(warband([]));
    render(<Warband onOpenCharacter={onOpen} region="us" />);

    await screen.findByText("No characters recorded yet.");
    expect(screen.getByText(/0 characters/)).toBeInTheDocument();
  });

  it("reorders rows when a column header is clicked", async () => {
    mockInvoke.mockResolvedValue(
      warband([
        character({ name: "Aaa", itemLevel: 100 }),
        character({ name: "Zzz", itemLevel: 500 }),
      ]),
    );
    render(<Warband onOpenCharacter={onOpen} region="us" />);

    await screen.findByText("Aaa");
    const bodyNames = () =>
      screen
        .getAllByRole("row")
        .slice(1)
        .map((r) => r.querySelector("td")!.textContent);

    // Default sort is itemLevel descending: Zzz (500) before Aaa (100).
    expect(bodyNames()).toEqual(["Zzz", "Aaa"]);

    // Sorting by Name ascends: Aaa before Zzz.
    fireEvent.click(screen.getByText("Name"));
    expect(bodyNames()).toEqual(["Aaa", "Zzz"]);
  });

  it("re-invokes the command when Refresh is clicked", async () => {
    mockInvoke.mockResolvedValue(warband([character({ name: "Testchar" })]));
    render(<Warband onOpenCharacter={onOpen} region="us" />);

    await screen.findByText("Testchar");
    expect(mockInvoke).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole("button", { name: "Refresh" }));
    await waitFor(() => expect(mockInvoke).toHaveBeenCalledTimes(2));
  });

  it("opens a character when its roster name is clicked", async () => {
    mockInvoke.mockResolvedValue(warband([character({ name: "Testchar", realm: "Testrealm" })]));
    render(<Warband onOpenCharacter={onOpen} region="us" />);

    fireEvent.click(await screen.findByRole("button", { name: "Testchar" }));
    expect(onOpen).toHaveBeenCalledWith({ realm: "Testrealm", characterName: "Testchar" });
  });

  it("does not make a row clickable when it has no realm", async () => {
    mockInvoke.mockResolvedValue(warband([character({ name: "Ghost", realm: "" })]));
    render(<Warband onOpenCharacter={onOpen} region="us" />);

    await screen.findByText("Ghost");
    expect(screen.queryByRole("button", { name: "Ghost" })).toBeNull();
  });

  it("toggles between the roster and the gear board", async () => {
    mockInvoke.mockResolvedValue(warband([character({ name: "Testchar", realm: "Testrealm" })]));
    render(<Warband onOpenCharacter={onOpen} region="us" />);

    await screen.findByText("Testchar"); // roster is the default view
    expect(screen.queryByTestId("gear-board")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Gear board" }));
    expect(screen.getByTestId("gear-board")).toBeInTheDocument();
    expect(screen.queryByText("Testchar")).toBeNull(); // roster table gone

    fireEvent.click(screen.getByRole("button", { name: "Roster" }));
    expect(screen.getByText("Testchar")).toBeInTheDocument();
    expect(screen.queryByTestId("gear-board")).toBeNull();
  });
});
