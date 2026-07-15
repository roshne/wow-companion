import { describe, it, expect } from "vitest";
import { toRealmSlug, toCharacterName } from "./slug";

describe("toRealmSlug", () => {
  it("trims and lowercases", () => {
    expect(toRealmSlug("  Tichondrius ")).toBe("tichondrius");
  });

  it("replaces spaces with hyphens", () => {
    expect(toRealmSlug("Argent Dawn")).toBe("argent-dawn");
  });

  it("collapses a run of whitespace into a single hyphen", () => {
    expect(toRealmSlug("Alterac  Mountains")).toBe("alterac-mountains");
  });

  it("returns an empty string for blank input", () => {
    expect(toRealmSlug("   ")).toBe("");
  });
});

describe("toCharacterName", () => {
  it("trims and lowercases", () => {
    expect(toCharacterName("  Kobrick ")).toBe("kobrick");
  });
});
