// Lives in the jsdom project (`.test.tsx`) because applyTheme touches `document.documentElement`.
import { describe, it, expect, afterEach } from "vitest";
import { applyTheme } from "./theme";

afterEach(() => document.documentElement.removeAttribute("data-theme"));

describe("applyTheme", () => {
  it("sets data-theme for an explicit light or dark choice", () => {
    applyTheme("dark");
    expect(document.documentElement.getAttribute("data-theme")).toBe("dark");
    applyTheme("light");
    expect(document.documentElement.getAttribute("data-theme")).toBe("light");
  });

  it("removes data-theme for the system choice (defer to the OS)", () => {
    applyTheme("dark");
    applyTheme("system");
    expect(document.documentElement.hasAttribute("data-theme")).toBe(false);
  });
});
