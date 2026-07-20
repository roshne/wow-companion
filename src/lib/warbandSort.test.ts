import { describe, it, expect } from "vitest";
import type { WarbandCharacter } from "./warband";
import type { WarbandGear, WarbandRow } from "./useWarbandGear";
import type { GearFinding } from "./gearCheck";
import { sortWarbandRows, filterWarbandRows } from "./warbandSort";

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

/** A resolved row with the given item levels + issue count. */
function row(
  name: string,
  itemLevels: Record<string, number>,
  charOver: Partial<WarbandCharacter> = {},
  issues = 0,
): WarbandRow {
  const c = character(name, charOver);
  const findings = Array.from({ length: issues }, (): GearFinding => ({
    slot: "HEAD",
    kind: "empty-socket",
    label: "Empty gem socket",
    severity: "warning",
  }));
  const gear: WarbandGear = {
    character: c,
    region: "us",
    realmSlug: "testrealm",
    itemLevels,
    findings,
    tierSet: null,
    failed: false,
  };
  return { character: c, gear };
}

const pending = (name: string, charOver: Partial<WarbandCharacter> = {}): WarbandRow => ({
  character: character(name, charOver),
  gear: null,
});

const names = (rows: WarbandRow[]) => rows.map((r) => r.character.name);

describe("sortWarbandRows", () => {
  it("sorts by average item level, descending and ascending", () => {
    const rows = [row("Low", { HEAD: 450 }), row("High", { HEAD: 490 }), row("Mid", { HEAD: 470 })];
    expect(names(sortWarbandRows(rows, { key: "itemLevel", dir: -1 }))).toEqual([
      "High",
      "Mid",
      "Low",
    ]);
    expect(names(sortWarbandRows(rows, { key: "itemLevel", dir: 1 }))).toEqual([
      "Low",
      "Mid",
      "High",
    ]);
  });

  it("sorts by issue count", () => {
    const rows = [row("Clean", { HEAD: 480 }, {}, 0), row("Messy", { HEAD: 480 }, {}, 3)];
    expect(names(sortWarbandRows(rows, { key: "issues", dir: -1 }))).toEqual(["Messy", "Clean"]);
  });

  it("sorts by class name and by character name", () => {
    const rows = [
      row("B", { HEAD: 480 }, { className: "Warrior" }),
      row("A", { HEAD: 480 }, { className: "Druid" }),
    ];
    expect(names(sortWarbandRows(rows, { key: "class", dir: 1 }))).toEqual(["A", "B"]); // Druid < Warrior
    expect(names(sortWarbandRows(rows, { key: "name", dir: 1 }))).toEqual(["A", "B"]);
  });

  it("keeps still-loading / no-metric rows last regardless of direction", () => {
    const rows = [pending("Loading"), row("Ready", { HEAD: 480 })];
    expect(names(sortWarbandRows(rows, { key: "issues", dir: -1 }))).toEqual(["Ready", "Loading"]);
    expect(names(sortWarbandRows(rows, { key: "issues", dir: 1 }))).toEqual(["Ready", "Loading"]);
  });

  it("falls back to the roster item level for a still-loading row when sorting by item level", () => {
    const rows = [
      pending("PendingHigh", { itemLevel: 500 }),
      row("LoadedLow", { HEAD: 460 }),
      pending("PendingUnknown"), // no roster ilvl → sorts last
    ];
    expect(names(sortWarbandRows(rows, { key: "itemLevel", dir: -1 }))).toEqual([
      "PendingHigh",
      "LoadedLow",
      "PendingUnknown",
    ]);
  });

  it("does not mutate the input array", () => {
    const rows = [row("B", { HEAD: 490 }), row("A", { HEAD: 450 })];
    const snapshot = names(rows);
    sortWarbandRows(rows, { key: "itemLevel", dir: -1 });
    expect(names(rows)).toEqual(snapshot);
  });
});

describe("filterWarbandRows", () => {
  const rows = [
    row("Warr", { HEAD: 480 }, { classKey: "WARRIOR", role: "TANK" }),
    row("Dudu", { HEAD: 480 }, { classKey: "DRUID", role: "HEALER" }),
    row("Warr2", { HEAD: 480 }, { classKey: "WARRIOR", role: "DAMAGER" }),
  ];

  it("filters by class", () => {
    expect(names(filterWarbandRows(rows, { classKey: "WARRIOR" }))).toEqual(["Warr", "Warr2"]);
  });

  it("filters by role", () => {
    expect(names(filterWarbandRows(rows, { role: "HEALER" }))).toEqual(["Dudu"]);
  });

  it("combines class and role filters", () => {
    expect(names(filterWarbandRows(rows, { classKey: "WARRIOR", role: "TANK" }))).toEqual(["Warr"]);
  });

  it("returns every row when no filter is set", () => {
    expect(names(filterWarbandRows(rows, {}))).toEqual(["Warr", "Dudu", "Warr2"]);
  });
});
