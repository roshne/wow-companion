import { describe, it, expect } from "vitest";
import {
  CLASS_COLORS,
  CLASS_BY_ID,
  RACE_BY_ID,
  FACTION_COLORS,
  className,
  classColor,
  raceName,
  formatGold,
} from "./wow";

describe("className", () => {
  it("maps a known class id to its display name", () => {
    expect(className(6)).toBe("Death Knight");
    expect(className(13)).toBe("Evoker");
  });

  it("falls back to `Class #id` for an unknown id", () => {
    expect(className(999)).toBe("Class #999");
  });

  it("returns an em dash for a missing id", () => {
    expect(className(undefined)).toBe("—");
    expect(className(null)).toBe("—");
  });
});

describe("classColor", () => {
  it("resolves a known class id to its CLASS_COLORS entry", () => {
    expect(classColor(6)).toBe(CLASS_COLORS.DeathKnight);
    expect(classColor(1)).toBe(CLASS_COLORS.Warrior);
  });

  it("returns undefined for an unknown or missing id", () => {
    expect(classColor(999)).toBeUndefined();
    expect(classColor(undefined)).toBeUndefined();
  });

  it("has a colour for every mapped class key", () => {
    for (const { key } of Object.values(CLASS_BY_ID)) {
      expect(CLASS_COLORS[key]).toBeTruthy();
    }
  });
});

describe("raceName", () => {
  it("maps a known race id to its display name", () => {
    expect(raceName(1)).toBe("Human");
    expect(raceName(35)).toBe("Vulpera");
  });

  it("collapses faction variants that share a name", () => {
    expect(raceName(25)).toBe("Pandaren");
    expect(raceName(26)).toBe("Pandaren");
    expect(raceName(52)).toBe("Dracthyr");
    expect(raceName(70)).toBe("Dracthyr");
  });

  it("falls back to `Race #id` for an unknown id", () => {
    expect(raceName(999)).toBe("Race #999");
  });

  it("returns an em dash for a missing id", () => {
    expect(raceName(undefined)).toBe("—");
  });
});

describe("static maps", () => {
  it("covers all thirteen retail classes", () => {
    expect(Object.keys(CLASS_BY_ID)).toHaveLength(13);
  });

  it("has distinct faction colours for Alliance and Horde", () => {
    expect(FACTION_COLORS.ALLIANCE).toBeTruthy();
    expect(FACTION_COLORS.HORDE).toBeTruthy();
    expect(FACTION_COLORS.ALLIANCE).not.toBe(FACTION_COLORS.HORDE);
  });

  it("names the base Human/Orc races", () => {
    expect(RACE_BY_ID[1]).toBe("Human");
    expect(RACE_BY_ID[2]).toBe("Orc");
  });
});

describe("formatGold", () => {
  it("splits copper into gold/silver/copper", () => {
    // 1234g 56s 78c
    expect(formatGold(12_345_678)).toBe("1,234g 56s 78c");
  });

  it("drops zero higher denominations", () => {
    expect(formatGold(5678)).toBe("56s 78c");
    expect(formatGold(78)).toBe("78c");
    expect(formatGold(50000)).toBe("5g");
  });

  it("keeps a trailing copper only when non-zero", () => {
    expect(formatGold(10000)).toBe("1g");
    expect(formatGold(15000)).toBe("1g 50s"); // 10000 + 50*100
    expect(formatGold(10005)).toBe("1g 5c"); // 10000 + 5c, silver skipped
  });

  it("thousands-separates large gold amounts", () => {
    expect(formatGold(1_000_000_0000)).toBe("1,000,000g");
  });

  it("renders zero as 0c", () => {
    expect(formatGold(0)).toBe("0c");
  });

  it("floors fractional copper", () => {
    expect(formatGold(199.9)).toBe("1s 99c");
  });

  it("returns an em dash for missing, negative, or non-finite input", () => {
    expect(formatGold(undefined)).toBe("—");
    expect(formatGold(null)).toBe("—");
    expect(formatGold(-1)).toBe("—");
    expect(formatGold(Infinity)).toBe("—");
    expect(formatGold(NaN)).toBe("—");
  });
});
