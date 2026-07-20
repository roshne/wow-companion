import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { WarbandNeedsAttention } from "./WarbandNeedsAttention";
import type { GearFinding, GearFindingKind } from "../lib/gearCheck";
import type { WarbandCharacter } from "../lib/warband";
import type { WarbandGear, WarbandRow } from "../lib/useWarbandGear";

const finding = (kind: GearFindingKind): GearFinding => ({
  slot: "HEAD",
  kind,
  label: kind,
  severity: kind === "ilvl-outlier" ? "info" : "warning",
});

const char = (name: string): WarbandCharacter => ({ name, realm: "Testrealm" }) as WarbandCharacter;

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

const pendingRow = (name: string): WarbandRow => ({ character: char(name), gear: null });

describe("WarbandNeedsAttention", () => {
  it("summarizes the fix count, affected characters, and a by-kind breakdown", () => {
    render(
      <WarbandNeedsAttention
        rows={[
          row("Alpha", [finding("missing-enchant"), finding("empty-socket")]),
          row("Bravo", [finding("missing-enchant")]),
          row("Clean", []),
        ]}
      />,
    );

    // "3 fixes across 2 characters — 2 missing enchants · 1 empty socket"
    expect(screen.getByText(/across 2 characters/)).toBeInTheDocument();
    expect(screen.getByText("3")).toBeInTheDocument();
    expect(screen.getByText(/2 missing enchants/)).toBeInTheDocument();
    expect(screen.getByText(/1 empty socket/)).toBeInTheDocument();
  });

  it("reads 'all set' when every resolved character is clean", () => {
    render(<WarbandNeedsAttention rows={[row("A", []), row("B", [])]} />);
    expect(screen.getByText(/All set/)).toBeInTheDocument();
  });

  it("renders nothing until at least one character has resolved", () => {
    const { container } = render(
      <WarbandNeedsAttention rows={[pendingRow("A"), pendingRow("B")]} />,
    );
    expect(container).toBeEmptyDOMElement();
  });
});
