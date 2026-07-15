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
