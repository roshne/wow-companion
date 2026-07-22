import { useState } from "react";
import { describe, it, expect } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { Tabs, tabId, panelId, type TabSpec } from "./Tabs";

type Key = "one" | "two" | "three";

const TABS: TabSpec<Key>[] = [
  { key: "one", label: "One" },
  { key: "two", label: "Two" },
  { key: "three", label: "Three" },
];

const BASE = "test-";

/** A minimal tablist + panel wired the way the real callers wire them. */
function Harness({ initial = "one" }: { initial?: Key }) {
  const [active, setActive] = useState<Key>(initial);
  return (
    <>
      <Tabs base={BASE} label="Views" tabs={TABS} active={active} onSelect={setActive} />
      <div role="tabpanel" id={panelId(BASE)} aria-labelledby={tabId(BASE, active)}>
        Panel: {active}
      </div>
    </>
  );
}

/** The tab buttons, in DOM order. */
function tabs(): HTMLElement[] {
  return screen.getAllByRole("tab");
}

describe("Tabs", () => {
  it("renders a labelled tablist with one tab per spec, marking only the active one selected", () => {
    render(<Harness />);

    expect(screen.getByRole("tablist", { name: "Views" })).toBeInTheDocument();
    expect(tabs().map((t) => t.textContent)).toEqual(["One", "Two", "Three"]);
    expect(tabs().map((t) => t.getAttribute("aria-selected"))).toEqual(["true", "false", "false"]);
  });

  it("keeps only the selected tab in the tab order (roving tabindex)", () => {
    render(<Harness initial="two" />);
    expect(tabs().map((t) => t.getAttribute("tabindex"))).toEqual(["-1", "0", "-1"]);
  });

  it("points every tab at the panel, and labels the panel with the active tab", () => {
    render(<Harness initial="two" />);

    const panel = screen.getByRole("tabpanel");
    expect(tabs().every((t) => t.getAttribute("aria-controls") === panel.id)).toBe(true);
    expect(panel.getAttribute("aria-labelledby")).toBe(tabs()[1].id);
    // The panel is reachable by its active tab's accessible name.
    expect(screen.getByRole("tabpanel", { name: "Two" })).toBe(panel);
  });

  it("selects a tab on click", () => {
    render(<Harness />);

    fireEvent.click(screen.getByRole("tab", { name: "Three" }));

    expect(tabs().map((t) => t.getAttribute("aria-selected"))).toEqual(["false", "false", "true"]);
    expect(screen.getByRole("tabpanel")).toHaveTextContent("Panel: three");
  });

  it("moves focus with the arrow keys without selecting (manual activation)", () => {
    render(<Harness />);
    const list = screen.getByRole("tablist");
    tabs()[0].focus();

    fireEvent.keyDown(list, { key: "ArrowRight" });
    expect(document.activeElement).toBe(tabs()[1]);
    // Focus moved, selection did not — the panel still shows the first tab's content.
    expect(tabs()[0]).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("tabpanel")).toHaveTextContent("Panel: one");

    fireEvent.keyDown(list, { key: "ArrowLeft" });
    expect(document.activeElement).toBe(tabs()[0]);
  });

  it("wraps the arrow keys at both ends", () => {
    render(<Harness />);
    const list = screen.getByRole("tablist");

    tabs()[0].focus();
    fireEvent.keyDown(list, { key: "ArrowLeft" });
    expect(document.activeElement).toBe(tabs()[2]);

    fireEvent.keyDown(list, { key: "ArrowRight" });
    expect(document.activeElement).toBe(tabs()[0]);
  });

  it("jumps to the first / last tab on Home / End", () => {
    render(<Harness />);
    const list = screen.getByRole("tablist");
    tabs()[1].focus();

    fireEvent.keyDown(list, { key: "End" });
    expect(document.activeElement).toBe(tabs()[2]);

    fireEvent.keyDown(list, { key: "Home" });
    expect(document.activeElement).toBe(tabs()[0]);
  });

  it("leaves the tabs as real buttons, so the platform activates them on Enter / Space", () => {
    render(<Harness />);
    // jsdom doesn't synthesize the click a browser fires for Enter/Space on a button, so assert the
    // element type that earns that behaviour rather than simulating the browser's own mapping.
    for (const tab of tabs()) {
      expect(tab.tagName).toBe("BUTTON");
      expect(tab).toHaveAttribute("type", "button");
    }
  });

  it("ignores keys it doesn't own, leaving focus where it was", () => {
    render(<Harness />);
    const list = screen.getByRole("tablist");
    tabs()[1].focus();

    fireEvent.keyDown(list, { key: "ArrowDown" });
    expect(document.activeElement).toBe(tabs()[1]);
  });
});
