import { describe, it, expect } from "vitest";
import { render, screen, within, fireEvent } from "@testing-library/react";

import { WarbandCurrencies } from "./WarbandCurrencies";
import type { WarbandCharacter, WarbandCurrency, WarbandData } from "../lib/warband";

const WEEK_START = 1785164400;

const currency = (overrides: Partial<WarbandCurrency> & { key: string }): WarbandCurrency => ({
  quantity: 0,
  earned: null,
  max: null,
  weeklyMax: null,
  capped: null,
  ...overrides,
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
    weekly: null,
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

const renderBoard = (d: WarbandData | null) => render(<WarbandCurrencies data={d} region="us" />);

describe("WarbandCurrencies", () => {
  it("names a known currency from the bundle and shows the amount", () => {
    renderBoard(
      data([
        character({
          name: "Aria",
          currencies: [currency({ key: "HeroDawncrest", quantity: 40, earned: 12, max: 100 })],
        }),
      ]),
    );
    expect(screen.getByText("Hero Dawncrest")).toBeInTheDocument();
    const row = screen.getByText("Aria").closest("tr")!;
    expect(within(row).getByText("40")).toBeInTheDocument();
    expect(within(row).getByText(/100/)).toBeInTheDocument();
  });

  it("renders an unknown key by its addon name instead of dropping it", () => {
    // The live database really does hold `AdventurerCrest`, written by an older addon version.
    renderBoard(
      data([character({ currencies: [currency({ key: "AdventurerCrest", quantity: 7 })] })]),
    );
    expect(screen.getByText("Adventurer Crest")).toBeInTheDocument();
    expect(screen.getByText(/shown by addon key/)).toBeInTheDocument();
  });

  it("shows an icon for a known currency and none for an unknown one", () => {
    const { container } = renderBoard(
      data([
        character({
          currencies: [
            currency({ key: "MythDawncrest", quantity: 1 }),
            currency({ key: "AdventurerCrest", quantity: 1 }),
          ],
        }),
      ]),
    );
    const icons = container.querySelectorAll("img.currency-icon");
    expect(icons).toHaveLength(1);
    expect(icons[0].getAttribute("src")).toContain("render.worldofwarcraft.com/us/icons/56/");
  });

  it("hides an icon that fails to load rather than showing a broken image", () => {
    const { container } = renderBoard(
      data([character({ currencies: [currency({ key: "MythDawncrest", quantity: 1 })] })]),
    );
    const icon = container.querySelector("img.currency-icon") as HTMLImageElement;
    fireEvent.error(icon);
    expect(icon.style.display).toBe("none");
    // The name is what carries the meaning, so it must survive.
    expect(screen.getByText("Myth Dawncrest")).toBeInTheDocument();
  });

  it("hides a cap the amount held has passed, since it reads as a display bug", () => {
    renderBoard(
      data([
        character({
          name: "Over",
          currencies: [currency({ key: "HeroDawncrest", quantity: 120, max: 0 })],
        }),
      ]),
    );
    const row = screen.getByText("Over").closest("tr")!;
    expect(within(row).getByText("120")).toBeInTheDocument();
    // No "/ 100" beside it...
    expect(within(row).queryByText(/\/\s*100/)).not.toBeInTheDocument();
    // ...but the recorded figure is still reachable, with why it's hidden.
    expect(within(row).getByTitle(/below the 120 held/)).toBeInTheDocument();
  });

  it("still shows a cap the amount has only reached", () => {
    renderBoard(
      data([
        character({
          name: "AtCap",
          currencies: [currency({ key: "ShardOfDundun", quantity: 8, weeklyMax: 8, capped: true })],
        }),
      ]),
    );
    const row = screen.getByText("AtCap").closest("tr")!;
    expect(within(row).getByText(/\/\s*8/)).toBeInTheDocument();
  });

  it("marks a capped currency", () => {
    renderBoard(
      data([
        character({
          name: "Capped",
          currencies: [
            currency({ key: "ShardOfDundun", quantity: 8, weeklyMax: 8, max: 8, capped: true }),
          ],
        }),
      ]),
    );
    const row = screen.getByText("Capped").closest("tr")!;
    expect(within(row).getByText("8").closest("span")).toHaveClass("currency-capped");
  });

  it("leaves a cell empty for a currency that character doesn't hold", () => {
    renderBoard(
      data([
        character({ name: "A", currencies: [currency({ key: "Catalyst", quantity: 2 })] }),
        character({ name: "B", currencies: [currency({ key: "MythDawncrest", quantity: 3 })] }),
      ]),
    );
    const rowA = screen.getByText("A").closest("tr")!;
    // Two currency columns; A holds only one of them.
    expect(within(rowA).getByText("—")).toBeInTheDocument();
  });

  it("marks a stale character", () => {
    renderBoard(
      data([
        character({
          name: "Away",
          lastRefresh: WEEK_START - 500,
          currencies: [currency({ key: "Catalyst", quantity: 1 })],
        }),
      ]),
    );
    expect(screen.getByText(/· stale/)).toBeInTheDocument();
    expect(screen.getByText(/1 not seen since the reset/)).toBeInTheDocument();
  });

  it("says so when nothing is recorded", () => {
    renderBoard(data([character()]));
    expect(screen.getByText("No currencies recorded yet.")).toBeInTheDocument();
  });
});
