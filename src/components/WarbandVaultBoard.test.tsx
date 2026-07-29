import { describe, it, expect } from "vitest";
import { render, screen, within } from "@testing-library/react";

import { WarbandVaultBoard } from "./WarbandVaultBoard";
import type { VaultSlot, WarbandCharacter, WarbandData } from "../lib/warband";

const WEEK_START = 1785164400;

const slot = (threshold: number, progress: number, ilvl: number | null = null): VaultSlot => ({
  threshold,
  progress,
  complete: progress >= threshold,
  ilvl,
});

function character(overrides: Partial<WarbandCharacter> = {}): WarbandCharacter {
  return {
    name: "Nobody",
    realm: "Testrealm",
    guid: null,
    classId: null,
    classKey: null,
    className: null,
    level: 90,
    itemLevel: null,
    spec: null,
    role: null,
    professionPrimary: null,
    professionSecondary: null,
    guild: null,
    faction: null,
    lastRefresh: WEEK_START + 100,
    gold: null,
    currencies: [],
    weekly: {
      vault: {
        raid: [slot(2, 2, 723), slot(4, 2), slot(6, 2)],
        dungeons: [],
        world: [],
      },
      hasUnclaimedVault: false,
      keystoneLevel: null,
      keystoneMap: null,
      dungeonsDone: null,
      dungeonsMax: null,
    },
    locks: [],
    titles: null,
    ...overrides,
  };
}

function data(characters: WarbandCharacter[]): WarbandData {
  return {
    account: "TESTACCOUNT",
    source: "C:/wow/Warbandeer_Characters.lua",
    characters,
    titleCatalog: null,
    wealth: {
      bankGold: null,
      week: { start: WEEK_START, baseline: null, ending: null, made: null },
      history: [],
    },
  };
}

describe("WarbandVaultBoard", () => {
  it("renders a row per max-level character with its tracks", () => {
    render(<WarbandVaultBoard data={data([character({ name: "Aria" })])} />);
    expect(screen.getByText("Aria")).toBeInTheDocument();
    // One of three raid slots unlocked, exposed as text for assistive tech rather than colour alone.
    expect(screen.getByLabelText("Raid: 1 of 3 unlocked")).toBeInTheDocument();
  });

  it("omits characters below the level cap and says so when nothing is left", () => {
    render(
      <WarbandVaultBoard data={data([character({ name: "Low", level: 20, weekly: null })])} />,
    );
    expect(screen.getByText(/No Great Vault data recorded yet/)).toBeInTheDocument();
  });

  it("flags a character with a reward waiting, and headlines the count", () => {
    render(
      <WarbandVaultBoard
        data={data([
          character({
            name: "Ready",
            weekly: {
              vault: { raid: [slot(2, 6, 730)], dungeons: [], world: [] },
              hasUnclaimedVault: true,
              keystoneLevel: null,
              keystoneMap: null,
              dungeonsDone: null,
              dungeonsMax: null,
            },
          }),
        ])}
      />,
    );
    expect(screen.getByText("1 character has a reward waiting")).toBeInTheDocument();
    expect(screen.getByText("reward waiting")).toBeInTheDocument();
  });

  it("marks a character not seen since the reset instead of showing an empty vault", () => {
    // The distinction the whole board turns on: stale data describes last week and can't be acted on.
    render(
      <WarbandVaultBoard
        data={data([character({ name: "Away", lastRefresh: WEEK_START - 5000 })])}
      />,
    );
    expect(screen.getByText(/not seen this week/)).toBeInTheDocument();
    expect(screen.getByText(/1 not seen since the reset/)).toBeInTheDocument();
  });

  it("does not mark a character scanned since the reset", () => {
    render(<WarbandVaultBoard data={data([character({ name: "Here" })])} />);
    expect(screen.queryByText(/not seen this week/)).not.toBeInTheDocument();
  });

  it("shows raid lockouts with difficulty and progress", () => {
    render(
      <WarbandVaultBoard
        data={data([
          character({
            name: "Raider",
            locks: [
              {
                instanceId: 2810,
                difficultyId: 16,
                name: "Venomous Abyss",
                progress: 3,
                total: 8,
                reset: null,
                extended: null,
                isRaid: true,
              },
            ],
          }),
        ])}
      />,
    );
    const row = screen.getByText("Raider").closest("tr")!;
    expect(within(row).getByText(/Venomous Abyss/)).toBeInTheDocument();
    expect(within(row).getByText(/M 3\/8/)).toBeInTheDocument();
  });

  it("renders an empty track as a dash rather than as zero unlocked", () => {
    render(<WarbandVaultBoard data={data([character({ name: "Solo" })])} />);
    const row = screen.getByText("Solo").closest("tr")!;
    // Raid has slots; Dungeons and World have none at all.
    expect(within(row).getAllByText("—")).toHaveLength(3);
  });

  it("renders nothing but a note when there is no data at all", () => {
    render(<WarbandVaultBoard data={null} />);
    expect(screen.getByText(/No Great Vault data recorded yet/)).toBeInTheDocument();
  });
});
