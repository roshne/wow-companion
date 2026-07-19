import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, within } from "@testing-library/react";
import { ItemPopover, type EquippedItem } from "./ItemPopover";
import { QUALITY_COLORS } from "../lib/wow";

/** A DOMRect with the given edges (the rest zeroed) — for stubbing the popover's measured geometry. */
const rectAt = (overrides: Partial<DOMRect>): DOMRect =>
  ({
    x: 0,
    y: 0,
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    width: 0,
    height: 0,
    toJSON: () => ({}),
    ...overrides,
  }) as DOMRect;

afterEach(() => vi.restoreAllMocks());

/** An epic head item (ilvl 483, Soulbound) — the common fixture for the header assertions. */
const item: EquippedItem = {
  name: "Crown of Testing",
  quality: { type: "EPIC" },
  level: { value: 483 },
  binding: { type: "ON_ACQUIRE", name: "Soulbound" },
};

/** A fully-populated item exercising every body section: stats, sockets, enchant, set, transmog. */
const fullItem: EquippedItem = {
  name: "Crown of Testing",
  quality: { type: "EPIC" },
  level: { value: 483, display_string: "Item Level 483" },
  binding: { name: "Soulbound" },
  armor: { value: 1200, display: { display_string: "1,200 Armor" } },
  stats: [
    {
      type: { type: "STAMINA" },
      display: { display_string: "+800 Stamina" },
      is_equip_bonus: false,
    },
    {
      type: { type: "CRIT_RATING" },
      display: { display_string: "+176 Critical Strike" },
      is_equip_bonus: true,
    },
  ],
  sockets: [
    {
      socket_type: { type: "PRISMATIC", name: "Prismatic" },
      item: { name: "Quick Sapphire" },
      display_string: "+176 Haste",
    },
    { socket_type: { type: "PRISMATIC", name: "Prismatic" } },
  ],
  enchantments: [{ display_string: "Enchanted: +200 Haste" }],
  set: {
    item_set: { name: "Vestments of Testing" },
    items: [
      { item: { name: "Crown of Testing" }, is_equipped: true },
      { item: { name: "Robe of Testing" }, is_equipped: false },
    ],
    effects: [
      { display_string: "(2) Set: +1000 Stamina", required_count: 2, is_active: true },
      { display_string: "(4) Set: Something Big", required_count: 4, is_active: false },
    ],
  },
  transmog: { item: { name: "Hidden Helm" }, display_string: "Transmogrified to: Hidden Helm" },
};

describe("ItemPopover", () => {
  it("renders a dialog labelled by the item name, with a quality-colored name", () => {
    render(<ItemPopover item={item} onClose={() => {}} />);

    const dialog = screen.getByRole("dialog", { name: "Crown of Testing" });
    expect(within(dialog).getByText("Crown of Testing")).toHaveStyle({
      color: QUALITY_COLORS.EPIC,
    });
  });

  it("shows the item level composed from the raw value, and the binding", () => {
    render(<ItemPopover item={item} onClose={() => {}} />);

    const dialog = screen.getByRole("dialog");
    expect(within(dialog).getByText("Item Level 483")).toBeInTheDocument();
    expect(within(dialog).getByText("Soulbound")).toBeInTheDocument();
  });

  it("prefers the API's item-level display string when present", () => {
    const withDisplay: EquippedItem = {
      name: "Band of Testing",
      quality: { type: "RARE" },
      level: { value: 400, display_string: "Item Level 415" },
    };
    render(<ItemPopover item={withDisplay} onClose={() => {}} />);

    expect(screen.getByText("Item Level 415")).toBeInTheDocument();
    expect(screen.queryByText("Item Level 400")).not.toBeInTheDocument();
  });

  it("omits the binding line when the item has no binding", () => {
    const noBinding: EquippedItem = {
      name: "Plain",
      quality: { type: "COMMON" },
      level: { value: 1 },
    };
    render(<ItemPopover item={noBinding} onClose={() => {}} />);

    expect(screen.getByRole("dialog", { name: "Plain" })).toBeInTheDocument();
    expect(screen.queryByText("Soulbound")).not.toBeInTheDocument();
  });

  it("moves focus into the dialog on open", () => {
    render(<ItemPopover item={item} onClose={() => {}} />);
    expect(screen.getByRole("dialog")).toHaveFocus();
  });

  it("closes on Escape", () => {
    const onClose = vi.fn();
    render(<ItemPopover item={item} onClose={onClose} />);

    fireEvent.keyDown(document, { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("closes on a pointer press outside it, but not on one inside", () => {
    const onClose = vi.fn();
    render(<ItemPopover item={item} onClose={onClose} />);

    // A press inside the dialog is ignored.
    fireEvent.mouseDown(screen.getByRole("dialog"));
    expect(onClose).not.toHaveBeenCalled();

    // A press anywhere outside dismisses it.
    fireEvent.mouseDown(document.body);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("closes when the close button is activated", () => {
    const onClose = vi.fn();
    render(<ItemPopover item={item} onClose={onClose} />);

    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("surfaces stats, a socketed gem, an empty socket, an enchant, set bonuses, and transmog", () => {
    const { container } = render(<ItemPopover item={fullItem} onClose={() => {}} />);
    const dialog = screen.getByRole("dialog");

    // Stats — armor + a primary stat, with the secondary (equip-bonus) stat flagged distinctly.
    expect(within(dialog).getByText("1,200 Armor")).toBeInTheDocument();
    expect(within(dialog).getByText("+800 Stamina")).toBeInTheDocument();
    expect(within(dialog).getByText("+176 Critical Strike")).toHaveClass("stat-secondary");

    // Sockets — the gem name, plus the empty socket shown as such (not omitted).
    expect(within(dialog).getByText("Quick Sapphire")).toBeInTheDocument();
    expect(within(dialog).getByText("Empty Prismatic Socket")).toHaveClass("socket-empty");

    // Enchant.
    expect(within(dialog).getByText("Enchanted: +200 Haste")).toBeInTheDocument();

    // Set — name + equipped piece count, with active vs. inactive effects styled apart.
    expect(within(dialog).getByText("Vestments of Testing (1/2)")).toBeInTheDocument();
    expect(within(dialog).getByText("(2) Set: +1000 Stamina")).toHaveClass("set-effect-active");
    expect(within(dialog).getByText("(4) Set: Something Big")).toHaveClass("set-effect-inactive");

    // Transmog.
    expect(within(dialog).getByText("Transmogrified to: Hidden Helm")).toBeInTheDocument();

    expect(container.querySelector(".item-popover-body")).toBeInTheDocument();
  });

  it("renders weapon damage / attack speed / dps under stats", () => {
    const weapon: EquippedItem = {
      name: "Blade of Testing",
      quality: { type: "EPIC" },
      level: { value: 480 },
      weapon: {
        damage: { display_string: "234 - 351 Damage" },
        attack_speed: { display_string: "Speed 2.60" },
        dps: { display_string: "(112.5 damage per second)" },
      },
    };
    render(<ItemPopover item={weapon} onClose={() => {}} />);
    const dialog = screen.getByRole("dialog");

    expect(within(dialog).getByText("234 - 351 Damage")).toBeInTheDocument();
    expect(within(dialog).getByText("Speed 2.60")).toBeInTheDocument();
    expect(within(dialog).getByText("(112.5 damage per second)")).toBeInTheDocument();
  });

  it("omits every body section (no crash) for a bare item, leaving just the header", () => {
    const bare: EquippedItem = {
      name: "Plain Cloak",
      quality: { type: "UNCOMMON" },
      level: { value: 400 },
    };
    const { container } = render(<ItemPopover item={bare} onClose={() => {}} />);

    expect(screen.getByRole("dialog", { name: "Plain Cloak" })).toBeInTheDocument();
    // No body wrapper at all — the header stands alone.
    expect(container.querySelector(".item-popover-body")).toBeNull();
  });

  it("lists the slot's gear-check findings, styled by severity", () => {
    render(
      <ItemPopover
        item={item}
        findings={[
          {
            slot: "FINGER_1",
            kind: "missing-enchant",
            label: "Missing enchant",
            severity: "warning",
          },
          {
            slot: "FINGER_1",
            kind: "ilvl-outlier",
            label: "Item level 450 (below average)",
            severity: "info",
          },
        ]}
        onClose={() => {}}
      />,
    );
    const dialog = screen.getByRole("dialog");
    expect(within(dialog).getByText("Missing enchant")).toHaveClass("item-popover-finding-warning");
    expect(within(dialog).getByText("Item level 450 (below average)")).toHaveClass(
      "item-popover-finding-info",
    );
  });

  it("renders no gear-check section when the slot has no findings", () => {
    const { container } = render(<ItemPopover item={item} onClose={() => {}} />);
    expect(container.querySelector(".item-popover-findings")).toBeNull();
  });

  it("keeps the default placement when the popover fits in the viewport", () => {
    render(<ItemPopover item={item} onClose={() => {}} />);
    const dialog = screen.getByRole("dialog");
    expect(dialog).not.toHaveClass("item-popover-right");
    expect(dialog).not.toHaveClass("item-popover-above");
  });

  it("flips to right-aligned when it would overflow the right edge", () => {
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue(
      rectAt({ right: window.innerWidth + 100, bottom: 50 }),
    );
    render(<ItemPopover item={item} onClose={() => {}} />);
    const dialog = screen.getByRole("dialog");
    expect(dialog).toHaveClass("item-popover-right");
    expect(dialog).not.toHaveClass("item-popover-above");
  });

  it("flips above the trigger when it would overflow the bottom edge", () => {
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue(
      rectAt({ right: 50, bottom: window.innerHeight + 100 }),
    );
    render(<ItemPopover item={item} onClose={() => {}} />);
    const dialog = screen.getByRole("dialog");
    expect(dialog).toHaveClass("item-popover-above");
    expect(dialog).not.toHaveClass("item-popover-right");
  });
});
