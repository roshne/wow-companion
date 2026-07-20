import { describe, it, expect } from "vitest";
import type { GearFinding, GearFindingKind } from "./gearCheck";
import type { WarbandCharacter } from "./warband";
import type { WarbandGear, WarbandRow } from "./useWarbandGear";
import { rollUpAttention } from "./warbandAttention";

const finding = (kind: GearFindingKind): GearFinding => ({
  slot: "HEAD",
  kind,
  label: kind,
  severity: kind === "ilvl-outlier" ? "info" : "warning",
});

const char = (name: string): WarbandCharacter => ({ name, realm: "Testrealm" }) as WarbandCharacter;

/** A resolved row carrying the given findings. */
function row(name: string, findings: GearFinding[]): WarbandRow {
  const c = char(name);
  const gear: WarbandGear = {
    character: c,
    region: "us",
    realmSlug: "testrealm",
    itemLevels: { HEAD: 480 },
    findings,
    tierSet: null,
    failed: false,
  };
  return { character: c, gear };
}

const failedRow = (name: string): WarbandRow => ({
  character: char(name),
  gear: {
    character: char(name),
    region: "us",
    realmSlug: "testrealm",
    itemLevels: {},
    findings: [],
    tierSet: null,
    failed: true,
  },
});

const pendingRow = (name: string): WarbandRow => ({ character: char(name), gear: null });

describe("rollUpAttention", () => {
  it("aggregates fixes across a mixed roster, excluding failed and pending rows", () => {
    const attention = rollUpAttention([
      row("Clean", []),
      row("Alpha", [finding("missing-enchant"), finding("empty-socket")]),
      row("Bravo", [finding("missing-enchant")]),
      failedRow("Broken"),
      pendingRow("Loading"),
    ]);

    expect(attention.totalFixes).toBe(3);
    expect(attention.charactersNeedingAttention).toBe(2); // Alpha + Bravo
    expect(attention.resolvedCount).toBe(3); // Clean + Alpha + Bravo (failed + pending excluded)
    // Most common kind first.
    expect(attention.byKind).toEqual([
      { kind: "missing-enchant", count: 2 },
      { kind: "empty-socket", count: 1 },
    ]);
  });

  it("reads 'all set' (no fixes) when every resolved character is clean", () => {
    const attention = rollUpAttention([row("A", []), row("B", []), pendingRow("Later")]);
    expect(attention.totalFixes).toBe(0);
    expect(attention.charactersNeedingAttention).toBe(0);
    expect(attention.resolvedCount).toBe(2);
    expect(attention.byKind).toEqual([]);
  });

  it("counts nothing resolved when the whole roster is still loading or failed", () => {
    const attention = rollUpAttention([pendingRow("A"), failedRow("B")]);
    expect(attention.resolvedCount).toBe(0);
    expect(attention.totalFixes).toBe(0);
  });
});
