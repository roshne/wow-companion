import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, within } from "@testing-library/react";
import { ItemPopover, type EquippedItem } from "./ItemPopover";
import { QUALITY_COLORS } from "../lib/wow";

/** An epic head item (ilvl 483, Soulbound) — the common fixture for the header assertions. */
const item: EquippedItem = {
  name: "Crown of Testing",
  quality: { type: "EPIC" },
  level: { value: 483 },
  binding: { type: "ON_ACQUIRE", name: "Soulbound" },
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
});
