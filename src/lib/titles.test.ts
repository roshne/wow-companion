import { describe, it, expect } from "vitest";
import { buildTitleBoard, filterTitles, matchesQuery } from "./titles";
import type { CharacterTitles, TitleCatalog, WarbandCharacter, WarbandData } from "./warband";

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

describe("buildTitleBoard", () => {
  it("merges earned titles across the warband and records who has each", () => {
    const board = buildTitleBoard(
      data([
        character("Aria", known([[1, "Private"]])),
        character(
          "Bram",
          known([
            [1, "Private"],
            [2, "Corporal"],
          ]),
        ),
      ]),
    );
    const priv = board.rows.find((r) => r.id === 1)!;
    expect(priv.earnedBy).toEqual(["Aria", "Bram"]);
    expect(board.rows.find((r) => r.id === 2)!.earnedBy).toEqual(["Bram"]);
    expect(board.earnedCount).toBe(2);
  });

  it("derives unearned as catalog minus earned", () => {
    const board = buildTitleBoard(
      data(
        [character("Aria", known([[1, "Private"]]))],
        catalog([
          [1, "Private"],
          [2, "Corporal"],
          [3, "Sergeant"],
        ]),
      ),
    );
    expect(board.earnedCount).toBe(1);
    expect(board.unearnedCount).toBe(2);
    expect(board.rows.filter((r) => !r.earned).map((r) => r.name)).toEqual([
      "Corporal",
      "Sergeant",
    ]);
  });

  it("claims no unearned count without a catalog rather than reporting zero", () => {
    // "0 unearned" would be a claim the data can't support — the unearned set is unknowable here.
    const board = buildTitleBoard(data([character("Aria", known([[1, "Private"]]))], null));
    expect(board.hasCatalog).toBe(false);
    expect(board.unearnedCount).toBe(0);
    expect(board.rows).toHaveLength(1);
    expect(board.rows[0].earned).toBe(true);
  });

  it("keeps a title earned but missing from the catalog", () => {
    // The catalog is one character's scan, not a guaranteed superset.
    const board = buildTitleBoard(
      data([character("Aria", known([[99, "Rare Title"]]))], catalog([[1, "Private"]])),
    );
    expect(board.rows.map((r) => r.name)).toEqual(["Private", "Rare Title"]);
    expect(board.rows.find((r) => r.id === 99)!.earned).toBe(true);
  });

  it("sorts rows by name", () => {
    const board = buildTitleBoard(
      data(
        [],
        catalog([
          [3, "Sergeant"],
          [1, "Private"],
          [2, "Corporal"],
        ]),
      ),
    );
    expect(board.rows.map((r) => r.name)).toEqual(["Corporal", "Private", "Sergeant"]);
  });

  it("collects featured titles per character, sorted", () => {
    const board = buildTitleBoard(
      data([
        character("Bram", known([[2, "Corporal"]], [2, "Corporal"])),
        character("Aria", known([[1, "Private"]], [1, "Private"])),
        character("Cass", known([[1, "Private"]])),
      ]),
    );
    expect(board.featured).toEqual([
      ["Aria", "Private"],
      ["Bram", "Corporal"],
    ]);
  });

  it("carries the catalog's provenance so staleness and language are visible", () => {
    const board = buildTitleBoard(data([], catalog([[1, "Private"]])));
    expect(board.locale).toBe("enUS");
    expect(board.scannedBy).toBe("Risella");
    expect(board.scannedAt).toBe(1785200000);
  });

  it("ignores a character with no titles recorded", () => {
    const board = buildTitleBoard(data([character("Aria", null)]));
    expect(board.rows).toHaveLength(0);
    expect(board.featured).toHaveLength(0);
  });

  it("returns an empty board for no data", () => {
    expect(buildTitleBoard(null).rows).toHaveLength(0);
  });
});

describe("matchesQuery", () => {
  it("matches case-insensitively on a substring, and everything on an empty query", () => {
    expect(matchesQuery("the Explorer", "explor")).toBe(true);
    expect(matchesQuery("the Explorer", "  ")).toBe(true);
    expect(matchesQuery("the Explorer", "gladiator")).toBe(false);
  });
});

describe("filterTitles", () => {
  const rows = [
    { id: 1, name: "Private", earnedBy: ["Aria"], earned: true },
    { id: 2, name: "Corporal", earnedBy: [], earned: false },
    { id: 3, name: "the Explorer", earnedBy: ["Bram"], earned: true },
  ];

  it("filters by earned state", () => {
    expect(filterTitles(rows, "earned", "").map((r) => r.id)).toEqual([1, 3]);
    expect(filterTitles(rows, "unearned", "").map((r) => r.id)).toEqual([2]);
    expect(filterTitles(rows, "all", "")).toHaveLength(3);
  });

  it("combines the filter with the search", () => {
    expect(filterTitles(rows, "earned", "explor").map((r) => r.id)).toEqual([3]);
    expect(filterTitles(rows, "unearned", "explor")).toHaveLength(0);
  });
});
