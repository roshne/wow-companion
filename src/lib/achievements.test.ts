import { describe, it, expect } from "vitest";
import type { CharacterAchievements } from "./queries";
import { summarizeAchievements, filterAchievements } from "./achievements";

const doc = (v: unknown): CharacterAchievements => v as CharacterAchievements;

describe("summarizeAchievements", () => {
  it("returns the totals and the earned list, most-recent first, dropping unnamed entries", () => {
    const summary = summarizeAchievements(
      doc({
        total_quantity: 1234,
        total_points: 20500,
        achievements: [
          { achievement: { id: 1, name: "Older Win" }, completed_timestamp: 1000 },
          { achievement: { id: 2, name: "Newest Win" }, completed_timestamp: 3000 },
          { achievement: { id: 3 } }, // no name → dropped
          { achievement: { id: 4, name: "Middle Win" }, completed_timestamp: 2000 },
        ],
      }),
    );
    expect(summary.totalQuantity).toBe(1234);
    expect(summary.totalPoints).toBe(20500);
    expect(summary.earned.map((a) => a.name)).toEqual(["Newest Win", "Middle Win", "Older Win"]);
  });

  it("sorts entries without a completed_timestamp last, and defaults totals to 0", () => {
    const summary = summarizeAchievements(
      doc({
        achievements: [
          { achievement: { id: 1, name: "Undated" } },
          { achievement: { id: 2, name: "Dated" }, completed_timestamp: 5000 },
        ],
      }),
    );
    expect(summary.totalQuantity).toBe(0);
    expect(summary.totalPoints).toBe(0);
    expect(summary.earned.map((a) => a.name)).toEqual(["Dated", "Undated"]);
  });
});

describe("filterAchievements", () => {
  const list = [
    { id: 1, name: "The Loremaster" },
    { id: 2, name: "Glory of the Raider" },
    { id: 3, name: "Loremaster of Legion" },
  ];

  it("matches a case-insensitive name substring", () => {
    expect(filterAchievements(list, "loremaster").map((a) => a.id)).toEqual([1, 3]);
  });

  it("returns the list unchanged for a blank query", () => {
    expect(filterAchievements(list, "   ")).toBe(list);
  });

  it("returns an empty list when nothing matches", () => {
    expect(filterAchievements(list, "zzz")).toEqual([]);
  });
});
