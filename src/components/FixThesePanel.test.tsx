import { describe, it, expect } from "vitest";
import { render, screen, within } from "@testing-library/react";
import { FixThesePanel } from "./FixThesePanel";
import type { GearFinding, GearFindingKind } from "../lib/gearCheck";
import type { CharacterEquipment } from "../lib/queries";

type EquippedItem = NonNullable<CharacterEquipment["equipped_items"]>[number];

/** A finding at a slot; severity mirrors gearCheck (only the ilvl outlier is informational). */
const finding = (slot: string, kind: GearFindingKind): GearFinding => ({
  slot,
  kind,
  label: `${kind} @ ${slot}`,
  severity: kind === "ilvl-outlier" ? "info" : "warning",
});

/** Wrap a list of equipped items in an equipment doc (the only field slotItemLevels reads). */
const equip = (items: EquippedItem[]): CharacterEquipment =>
  ({ equipped_items: items }) as CharacterEquipment;

const item = (slot: string, level: number): EquippedItem =>
  ({ slot: { type: slot }, level: { value: level } }) as EquippedItem;

describe("FixThesePanel", () => {
  it("renders the prioritized fixes as an ordered list, most-impactful first", () => {
    const findings = [
      finding("HEAD", "ilvl-outlier"), // info → sorts last
      finding("WRIST", "missing-enchant"), // warning, ordinary slot
      finding("MAIN_HAND", "empty-socket"), // warning, weapon slot → sorts first
    ];
    const equipment = equip([item("HEAD", 460), item("WRIST", 480), item("MAIN_HAND", 480)]);
    render(<FixThesePanel findings={findings} equipment={equipment} />);

    const list = screen.getByRole("list");
    const rows = within(list)
      .getAllByRole("listitem")
      .map((li) => li.textContent?.trim());
    expect(rows).toEqual(["Socket your weapon", "Enchant your bracers", "Upgrade your helm"]);
  });

  it("names the region by its visible title", () => {
    render(<FixThesePanel findings={[finding("BACK", "missing-enchant")]} equipment={equip([])} />);
    expect(screen.getByRole("region", { name: "Fix these" })).toBeInTheDocument();
  });

  it("shows the human recommendation string for each finding kind", () => {
    const findings = [
      finding("BACK", "missing-enchant"),
      finding("FINGER_1", "empty-socket"),
      finding("OFF_HAND", "missing-off-hand"),
    ];
    render(<FixThesePanel findings={findings} equipment={equip([])} />);
    expect(screen.getByText("Enchant your cloak")).toBeInTheDocument();
    expect(screen.getByText("Socket your ring")).toBeInTheDocument();
    expect(screen.getByText("Equip an off-hand")).toBeInTheDocument();
  });

  it("marks each row by finding severity (warnings sort ahead of infos)", () => {
    const findings = [finding("MAIN_HAND", "empty-socket"), finding("HEAD", "ilvl-outlier")];
    const { container } = render(<FixThesePanel findings={findings} equipment={equip([])} />);
    const dots = container.querySelectorAll(".fix-these-dot");
    expect(dots).toHaveLength(2);
    expect(dots[0]).toHaveClass("fix-these-dot-warning");
    expect(dots[1]).toHaveClass("fix-these-dot-info");
  });

  it("renders nothing when the character has no findings", () => {
    const { container } = render(<FixThesePanel findings={[]} equipment={equip([])} />);
    expect(container.querySelector(".fix-these")).toBeNull();
    expect(screen.queryByRole("list")).toBeNull();
  });
});
