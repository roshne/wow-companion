import { describe, it, expect } from "vitest";
import { toRealmSlug, toCharacterName, toGuildNameSlug, resolveRealmSlug } from "./slug";

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
    expect(toCharacterName("  Testchar ")).toBe("testchar");
  });
});

describe("resolveRealmSlug", () => {
  const REALMS = [
    { name: "Argent Dawn", slug: "argent-dawn" },
    { name: "Aggra (Português)", slug: "aggra-portugues" },
  ];

  it("uses the index slug when the typed display name matches (accents/punctuation)", () => {
    // Derivation would give "aggra-(português)"; the index's real slug is correct.
    expect(resolveRealmSlug("Aggra (Português)", REALMS)).toBe("aggra-portugues");
  });

  it("matches case-insensitively on the display name", () => {
    expect(resolveRealmSlug("argent dawn", REALMS)).toBe("argent-dawn");
  });

  it("matches an already-slugged input against the index slug", () => {
    expect(resolveRealmSlug("aggra-portugues", REALMS)).toBe("aggra-portugues");
  });

  it("falls back to the derived slug for input not in the index", () => {
    expect(resolveRealmSlug("Tichondrius", REALMS)).toBe("tichondrius");
  });

  it("falls back to the derived slug when the index is empty", () => {
    expect(resolveRealmSlug("Argent Dawn", [])).toBe("argent-dawn");
  });
});

describe("toGuildNameSlug", () => {
  it("lowercases and hyphenates a multi-word guild name", () => {
    expect(toGuildNameSlug("Complexity Limit")).toBe("complexity-limit");
  });

  it("collapses whitespace runs and trims", () => {
    expect(toGuildNameSlug("  Echo   Gaming ")).toBe("echo-gaming");
  });

  it("returns an empty string for blank input", () => {
    expect(toGuildNameSlug("   ")).toBe("");
  });
});
