import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { ThemeToggle } from "./ThemeToggle";
import { loadTheme } from "../lib/persist";

const root = () => document.documentElement;

describe("ThemeToggle", () => {
  beforeEach(() => {
    localStorage.clear();
    root().removeAttribute("data-theme");
  });
  afterEach(() => root().removeAttribute("data-theme"));

  it("defaults to System on first run", () => {
    render(<ThemeToggle />);
    const select = screen.getByLabelText(/Theme/) as HTMLSelectElement;
    expect(select.value).toBe("system");
    // System leaves the root attribute unset.
    expect(root().hasAttribute("data-theme")).toBe(false);
  });

  it("offers system / light / dark", () => {
    render(<ThemeToggle />);
    expect(
      Array.from(screen.getByLabelText(/Theme/).querySelectorAll("option")).map((o) => o.value),
    ).toEqual(["system", "light", "dark"]);
  });

  it("seeds from and applies the persisted choice on mount", () => {
    localStorage.setItem("wow-companion:theme", "dark");
    render(<ThemeToggle />);
    expect((screen.getByLabelText(/Theme/) as HTMLSelectElement).value).toBe("dark");
    expect(root().getAttribute("data-theme")).toBe("dark");
  });

  it("applies and persists a manual light choice", () => {
    render(<ThemeToggle />);
    fireEvent.change(screen.getByLabelText(/Theme/), { target: { value: "light" } });
    expect(root().getAttribute("data-theme")).toBe("light");
    expect(loadTheme()).toBe("light");
  });

  it("clears the root attribute when switching back to System", () => {
    localStorage.setItem("wow-companion:theme", "dark");
    render(<ThemeToggle />);
    fireEvent.change(screen.getByLabelText(/Theme/), { target: { value: "system" } });
    expect(root().hasAttribute("data-theme")).toBe(false);
    expect(loadTheme()).toBe("system");
  });
});
