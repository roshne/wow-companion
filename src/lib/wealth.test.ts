import { describe, it, expect } from "vitest";
import {
  DAYS_PER_TOKEN,
  describeGameTime,
  goldFrom,
  recentWeeks,
  tokensFor,
  totalWealthCopper,
  weekChangeCopper,
} from "./wealth";
import type { WarbandCharacter, WarbandData, WarbandWeek } from "./warband";

const G = 10_000; // one gold, in copper

function character(overrides: Partial<WarbandCharacter> = {}): WarbandCharacter {
  return {
    name: "Nobody",
    realm: "Testrealm",
    guid: null,
    classId: null,
    classKey: null,
    className: null,
    level: 90,
    itemLevel: null,
    spec: null,
    role: null,
    professionPrimary: null,
    professionSecondary: null,
    guild: null,
    faction: null,
    lastRefresh: null,
    gold: null,
    currencies: [],
    weekly: null,
    locks: [],
    titles: null,
    ...overrides,
  };
}

function data(
  characters: WarbandCharacter[],
  wealth: WarbandData["wealth"] = { bankGold: null, week: null, history: [] },
): WarbandData {
  return {
    account: "TESTACCOUNT",
    source: "C:/wow/Warbandeer_Characters.lua",
    characters,
    titleCatalog: null,
    wealth,
  };
}

const week = (o: Partial<WarbandWeek> = {}): WarbandWeek => ({
  start: null,
  baseline: null,
  ending: null,
  made: null,
  ...o,
});

describe("totalWealthCopper", () => {
  it("adds the warband bank to every character's gold, as the addon defines it", () => {
    const board = totalWealthCopper(
      data([character({ gold: 100 * G }), character({ gold: 50 * G })], {
        bankGold: 25 * G,
        week: null,
        history: [],
      }),
    );
    expect(board).toBe(175 * G);
  });

  it("lets a character with no recorded gold contribute nothing", () => {
    // Gold is only captured once a character has been played, so this is the common case — it must
    // not drag the total down.
    const total = totalWealthCopper(
      data([character({ gold: 100 * G }), character({ gold: null })], {
        bankGold: null,
        week: null,
        history: [],
      }),
    );
    expect(total).toBe(100 * G);
  });

  it("distinguishes nothing-recorded from nothing-owned", () => {
    // No wealth block and no character gold: unknown, not zero.
    expect(totalWealthCopper(data([character({ gold: null })], null))).toBeNull();
    // A recorded zero balance is a real answer.
    expect(totalWealthCopper(data([character({ gold: 0 })], null))).toBe(0);
  });

  it("counts a bank with no characters, and returns null for no data", () => {
    expect(totalWealthCopper(data([], { bankGold: 7 * G, week: null, history: [] }))).toBe(7 * G);
    expect(totalWealthCopper(null)).toBeNull();
  });
});

describe("goldFrom", () => {
  it("converts copper to whole gold", () => {
    expect(goldFrom(12_345_678)).toBe(1234);
    expect(goldFrom(9_999)).toBe(0);
  });
});

describe("tokensFor", () => {
  it("divides wealth by the token price, keeping the fraction", () => {
    // Rounding here would hide being just short of one more token.
    expect(tokensFor(250 * G, 100 * G)).toBe(2.5);
  });

  it("returns null rather than Infinity for a missing or zero price", () => {
    // A divide-by-zero would render "Infinity tokens", which looks like a real answer.
    expect(tokensFor(100 * G, 0)).toBeNull();
    expect(tokensFor(100 * G, null)).toBeNull();
    expect(tokensFor(100 * G, undefined)).toBeNull();
    expect(tokensFor(100 * G, -5)).toBeNull();
  });

  it("returns null when wealth is unknown", () => {
    expect(tokensFor(null, 100 * G)).toBeNull();
  });
});

describe("describeGameTime", () => {
  it("scales the unit to the magnitude", () => {
    expect(describeGameTime(1)).toBe("30 days");
    expect(describeGameTime(11)).toBe("11 months");
    expect(describeGameTime(30)).toBe("2.5 years");
  });

  it("handles a fraction of a token", () => {
    expect(describeGameTime(0.5)).toBe("15 days");
    expect(describeGameTime(0.01)).toBe("less than a day");
  });

  it("is null when there are no tokens to describe", () => {
    expect(describeGameTime(null)).toBeNull();
  });

  it("keeps one token equal to one month, so the two never disagree", () => {
    // The reason this returns a phrase rather than a second number: a token count and a month count
    // are the same figure, and printing both would read as two independent facts.
    expect(DAYS_PER_TOKEN).toBe(30);
    expect(describeGameTime(6)).toBe("6 months");
  });
});

describe("weekChangeCopper", () => {
  it("measures the open week against its baseline", () => {
    expect(weekChangeCopper(150 * G, week({ baseline: 100 * G }))).toBe(50 * G);
  });

  it("keeps a losing week negative rather than clamping it", () => {
    // The live history has several negative weeks; clamping would misreport them as flat.
    expect(weekChangeCopper(80 * G, week({ baseline: 100 * G }))).toBe(-20 * G);
  });

  it("is null without a baseline or a total", () => {
    expect(weekChangeCopper(100 * G, week({ baseline: null }))).toBeNull();
    expect(weekChangeCopper(100 * G, null)).toBeNull();
    expect(weekChangeCopper(null, week({ baseline: 1 }))).toBeNull();
  });
});

describe("recentWeeks", () => {
  it("takes the most recent closed weeks, newest first", () => {
    // The addon appends oldest-first, so the tail is the recent end.
    const history = [week({ made: 1 }), week({ made: 2 }), week({ made: 3 })];
    expect(recentWeeks(history, 2).map((w) => w.made)).toEqual([3, 2]);
  });

  it("tolerates a short, empty, or absent history", () => {
    expect(recentWeeks([week({ made: 1 })], 5).map((w) => w.made)).toEqual([1]);
    expect(recentWeeks([], 3)).toEqual([]);
    expect(recentWeeks(null, 3)).toEqual([]);
    expect(recentWeeks([week()], 0)).toEqual([]);
  });
});
