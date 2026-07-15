// Lives in the jsdom project (`.test.tsx`) because localStorage is a DOM API — there is no JSX here.
import { describe, it, expect, beforeEach } from "vitest";
import {
  loadRegion,
  saveRegion,
  loadRecentCharacters,
  saveRecentCharacters,
  addRecentCharacter,
  RECENTS_CAP,
  type RecentCharacter,
  loadFavoriteCharacters,
  saveFavoriteCharacters,
  isFavoriteCharacter,
  toggleFavoriteCharacter,
  removeFavoriteCharacter,
  type FavoriteCharacter,
  loadFavoriteRealms,
  isRealmFavorited,
  toggleFavoriteRealmRow,
  ensureRealmFavorites,
  hasSeededWarband,
  markWarbandSeeded,
  loadTokenHistory,
  appendTokenPrice,
  TOKEN_HISTORY_CAP,
} from "./persist";

const char = (n: string, region: RecentCharacter["region"] = "us"): RecentCharacter => ({
  region,
  realmSlug: "tichondrius",
  characterName: n,
});

describe("region persistence", () => {
  beforeEach(() => localStorage.clear());

  it("defaults to us when nothing is stored", () => {
    expect(loadRegion()).toBe("us");
  });

  it("round-trips a valid region", () => {
    saveRegion("eu");
    expect(loadRegion()).toBe("eu");
  });

  it("ignores an invalid stored region", () => {
    localStorage.setItem("wow-companion:region", "zz");
    expect(loadRegion()).toBe("us");
  });
});

describe("recent characters MRU", () => {
  beforeEach(() => localStorage.clear());

  it("is empty by default", () => {
    expect(loadRecentCharacters()).toEqual([]);
  });

  it("adds to the front and persists across a reload", () => {
    addRecentCharacter(char("asmongold"));
    addRecentCharacter(char("sodapoppin"));
    expect(loadRecentCharacters().map((c) => c.characterName)).toEqual(["sodapoppin", "asmongold"]);
  });

  it("dedupes and moves an existing character to the front", () => {
    addRecentCharacter(char("asmongold"));
    addRecentCharacter(char("sodapoppin"));
    const list = addRecentCharacter(char("asmongold"));
    expect(list.map((c) => c.characterName)).toEqual(["asmongold", "sodapoppin"]);
  });

  it("caps the list, dropping the oldest", () => {
    for (let i = 0; i < RECENTS_CAP + 3; i++) addRecentCharacter(char(`char${i}`));
    const list = loadRecentCharacters();
    expect(list).toHaveLength(RECENTS_CAP);
    expect(list[0].characterName).toBe(`char${RECENTS_CAP + 2}`); // newest
    expect(list.some((c) => c.characterName === "char0")).toBe(false); // oldest evicted
  });

  it("filters out malformed entries on read", () => {
    saveRecentCharacters([
      char("valid"),
      { region: "xx", realmSlug: "r", characterName: "n" } as unknown as RecentCharacter,
      { region: "us", realmSlug: "", characterName: "n" } as unknown as RecentCharacter,
    ]);
    expect(loadRecentCharacters().map((c) => c.characterName)).toEqual(["valid"]);
  });

  it("returns an empty list for corrupt JSON", () => {
    localStorage.setItem("wow-companion:recent-characters", "{not json");
    expect(loadRecentCharacters()).toEqual([]);
  });
});

describe("favorite characters", () => {
  beforeEach(() => localStorage.clear());

  const fav = (n: string, region: FavoriteCharacter["region"] = "us"): FavoriteCharacter => ({
    region,
    realmSlug: "tichondrius",
    characterName: n,
  });

  it("toggles a character in and out of favorites", () => {
    expect(loadFavoriteCharacters()).toEqual([]);
    toggleFavoriteCharacter(fav("asmon"));
    expect(loadFavoriteCharacters().map((f) => f.characterName)).toEqual(["asmon"]);
    expect(isFavoriteCharacter(loadFavoriteCharacters(), fav("asmon"))).toBe(true);
    toggleFavoriteCharacter(fav("asmon"));
    expect(loadFavoriteCharacters()).toEqual([]);
  });

  it("removes a specific favorite", () => {
    toggleFavoriteCharacter(fav("a"));
    toggleFavoriteCharacter(fav("b"));
    removeFavoriteCharacter(fav("a"));
    expect(loadFavoriteCharacters().map((f) => f.characterName)).toEqual(["b"]);
  });

  it("filters malformed entries on read", () => {
    saveFavoriteCharacters([
      fav("valid"),
      { region: "us", realmSlug: "", characterName: "x" } as unknown as FavoriteCharacter,
    ]);
    expect(loadFavoriteCharacters().map((f) => f.characterName)).toEqual(["valid"]);
  });
});

describe("favorite realms", () => {
  beforeEach(() => localStorage.clear());

  it("toggles a connected-realm row (all its slugs together)", () => {
    toggleFavoriteRealmRow("us", ["tichondrius", "area-52"]);
    expect(isRealmFavorited(loadFavoriteRealms(), "us", "tichondrius")).toBe(true);
    expect(isRealmFavorited(loadFavoriteRealms(), "us", "area-52")).toBe(true);
    // Toggling again (any pinned → remove all) clears the row.
    toggleFavoriteRealmRow("us", ["tichondrius", "area-52"]);
    expect(loadFavoriteRealms()).toEqual([]);
  });

  it("ensureRealmFavorites adds only absent slugs and stays region-scoped", () => {
    ensureRealmFavorites("us", ["tichondrius"]);
    const list = ensureRealmFavorites("us", ["tichondrius", "area-52"]);
    expect(list.map((f) => f.realmSlug).sort()).toEqual(["area-52", "tichondrius"]);
    expect(isRealmFavorited(list, "eu", "tichondrius")).toBe(false);
  });
});

describe("warband seed guard", () => {
  beforeEach(() => localStorage.clear());

  it("marks a region seeded exactly once, independent of other regions", () => {
    expect(hasSeededWarband("us")).toBe(false);
    markWarbandSeeded("us");
    expect(hasSeededWarband("us")).toBe(true);
    expect(hasSeededWarband("eu")).toBe(false);
    markWarbandSeeded("us"); // idempotent
    expect(hasSeededWarband("us")).toBe(true);
  });
});

describe("token price history", () => {
  beforeEach(() => localStorage.clear());

  it("appends points and dedupes on the server timestamp", () => {
    appendTokenPrice("us", { t: 100, price: 2_500_000 });
    appendTokenPrice("us", { t: 100, price: 2_500_000 }); // same t → no-op
    appendTokenPrice("us", { t: 200, price: 2_600_000 });
    expect(loadTokenHistory("us").map((p) => p.t)).toEqual([100, 200]);
  });

  it("is region-scoped", () => {
    appendTokenPrice("us", { t: 1, price: 10 });
    expect(loadTokenHistory("eu")).toEqual([]);
  });

  it("caps the series as a ring buffer, dropping the oldest", () => {
    for (let i = 0; i < TOKEN_HISTORY_CAP + 5; i++) appendTokenPrice("us", { t: i, price: i });
    const hist = loadTokenHistory("us");
    expect(hist).toHaveLength(TOKEN_HISTORY_CAP);
    expect(hist[0].t).toBe(5);
    expect(hist[hist.length - 1].t).toBe(TOKEN_HISTORY_CAP + 4);
  });

  it("filters malformed points on read", () => {
    localStorage.setItem(
      "wow-companion:token-history:us",
      JSON.stringify([{ t: 1, price: 10 }, { t: "x", price: 5 }, { nope: true }]),
    );
    expect(loadTokenHistory("us")).toEqual([{ t: 1, price: 10 }]);
  });
});
