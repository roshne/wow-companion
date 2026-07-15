import { describe, it, expect } from "vitest";
import { loc } from "./types";

describe("loc", () => {
  it("returns an empty string for undefined", () => {
    expect(loc(undefined)).toBe("");
  });

  it("returns a plain (flattened) string as-is", () => {
    expect(loc("Tichondrius")).toBe("Tichondrius");
  });

  it("prefers en_US from a localized object", () => {
    expect(loc({ en_US: "Argent Dawn", de_DE: "Silberne Hand" })).toBe("Argent Dawn");
  });

  it("falls back to the first truthy locale when en_US is absent", () => {
    expect(loc({ de_DE: "Silberne Hand" })).toBe("Silberne Hand");
  });

  it("returns an empty string for an empty object", () => {
    expect(loc({})).toBe("");
  });
});
