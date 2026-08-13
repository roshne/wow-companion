import { describe, it, expect } from "vitest";
import { render, screen, fireEvent, within } from "@testing-library/react";

import { WarbandTitles } from "./WarbandTitles";
import type { CharacterTitles, TitleCatalog, WarbandCharacter, WarbandData } from "../lib/warband";

function character(name: string, titles: CharacterTitles | null): WarbandCharacter {
  return {
    name,
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
    lastRefresh: null,
    gold: null,
    currencies: [],
    weekly: null,
    locks: [],
    titles,
    mail: null,
    auctions: null,
  };
}

const known = (
  entries: [number, string][],
  current: [number, string] | null = null,
): CharacterTitles => ({
  known: entries.map(([id, name]) => ({ id, name })),
  current: current?.[0] ?? null,
  currentName: current?.[1] ?? null,
});

const catalog = (entries: [number, string][]): TitleCatalog => ({
  titles: entries.map(([id, name]) => ({ id, name })),
  locale: "enUS",
  count: entries.length,
  scannedAt: 1785200000,
  scannedBy: "Risella",
});

function data(
  characters: WarbandCharacter[],
  titleCatalog: TitleCatalog | null = null,
): WarbandData {
  return {
    account: "TESTACCOUNT",
    source: "C:/wow/Warbandeer_Characters.lua",
    characters,
    wealth: null,
    titleCatalog,
  };
}

describe("WarbandTitles", () => {
  it("lists earned titles with who has each", () => {
    render(
      <WarbandTitles
        data={data([
          character("Aria", known([[1, "Private"]])),
          character("Bram", known([[1, "Private"]])),
        ])}
      />,
    );
    const row = screen.getByText("Private").closest("tr")!;
    expect(within(row).getByText("Aria, Bram")).toBeInTheDocument();
  });

  it("counts earned against the catalog and shows what's left", () => {
    render(
      <WarbandTitles
        data={data(
          [character("Aria", known([[1, "Private"]]))],
          catalog([
            [1, "Private"],
            [2, "Corporal"],
          ]),
        )}
      />,
    );
    expect(screen.getByText("1 earned")).toBeInTheDocument();
    expect(screen.getByText(/1 still to earn/)).toBeInTheDocument();
  });

  it("says the unearned set is unknown without a catalog, rather than showing zero", () => {
    render(<WarbandTitles data={data([character("Aria", known([[1, "Private"]]))], null)} />);
    expect(
      screen.getByText(/no catalog recorded, so unearned titles are unknown/),
    ).toBeInTheDocument();
    expect(screen.queryByText(/still to earn/)).not.toBeInTheDocument();
  });

  it("filters to unearned titles", () => {
    render(
      <WarbandTitles
        data={data(
          [character("Aria", known([[1, "Private"]]))],
          catalog([
            [1, "Private"],
            [2, "Corporal"],
          ]),
        )}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Unearned" }));
    expect(screen.getByText("Corporal")).toBeInTheDocument();
    expect(screen.queryByText("Private")).not.toBeInTheDocument();
  });

  it("searches by name, and says so when nothing matches", () => {
    render(
      <WarbandTitles
        data={data(
          [],
          catalog([
            [1, "Private"],
            [3, "the Explorer"],
          ]),
        )}
      />,
    );
    const search = screen.getByLabelText("Search");
    fireEvent.change(search, { target: { value: "explor" } });
    expect(screen.getByText("the Explorer")).toBeInTheDocument();
    expect(screen.queryByText("Private")).not.toBeInTheDocument();

    fireEvent.change(search, { target: { value: "zzz" } });
    expect(screen.getByText("No titles match.")).toBeInTheDocument();
  });

  it("shows each character's currently-displayed title", () => {
    render(
      <WarbandTitles data={data([character("Aria", known([[1, "Private"]], [1, "Private"]))])} />,
    );
    // Collapsed by default so it can't push the table off-screen, but the content is still present.
    const disclosure = screen.getByText(/Currently displayed titles \(1\)/).closest("details")!;
    expect(disclosure).not.toHaveAttribute("open");
    expect(disclosure).toHaveTextContent("Aria — Private");
  });

  it("names the character whose scan produced the catalog", () => {
    // Titles are account-wide, so one character's scan serves the warband — worth surfacing.
    render(<WarbandTitles data={data([], catalog([[1, "Private"]]))} />);
    expect(screen.getByText(/catalog from Risella/)).toBeInTheDocument();
  });

  it("caps the rendered rows and says how many are hidden", () => {
    const many: [number, string][] = Array.from({ length: 260 }, (_, i) => [
      i + 1,
      `Title ${String(i + 1).padStart(3, "0")}`,
    ]);
    render(<WarbandTitles data={data([], catalog(many))} />);
    expect(screen.getByText(/Showing 200 of 260/)).toBeInTheDocument();
  });

  it("says so when nothing is recorded", () => {
    render(<WarbandTitles data={data([character("Aria", null)])} />);
    expect(screen.getByText("No titles recorded yet.")).toBeInTheDocument();
  });
});
