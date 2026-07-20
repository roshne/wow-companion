import { describe, it, expect } from "vitest";
import type { CharacterRaids } from "./queries";
import { latestRaidProgress } from "./raids";

const doc = (v: unknown): CharacterRaids => v as CharacterRaids;

describe("latestRaidProgress", () => {
  it("uses the last (most recent) expansion's instances with per-difficulty boss counts", () => {
    const data = doc({
      expansions: [
        {
          expansion: { name: "Dragonflight" },
          instances: [{ instance: { name: "Aberrus" }, modes: [] }],
        },
        {
          expansion: { name: "The War Within" },
          instances: [
            {
              instance: { name: "Nerub-ar Palace" },
              modes: [
                {
                  difficulty: { name: "Normal" },
                  progress: { completed_count: 8, total_count: 8 },
                },
                {
                  difficulty: { name: "Heroic" },
                  progress: { completed_count: 5, total_count: 8 },
                },
              ],
            },
          ],
        },
      ],
    });
    expect(latestRaidProgress(data)).toEqual({
      expansionName: "The War Within",
      instances: [
        {
          name: "Nerub-ar Palace",
          modes: [
            { difficulty: "Normal", completed: 8, total: 8 },
            { difficulty: "Heroic", completed: 5, total: 8 },
          ],
        },
      ],
    });
  });

  it("defaults missing boss counts to 0 and drops unnamed instances/modes", () => {
    const data = doc({
      expansions: [
        {
          expansion: { name: "The War Within" },
          instances: [
            { instance: {}, modes: [{ difficulty: { name: "Mythic" } }] }, // unnamed instance → dropped
            {
              instance: { name: "Liberation of Undermine" },
              modes: [
                { difficulty: {}, progress: { completed_count: 3, total_count: 8 } }, // unnamed mode → dropped
                { difficulty: { name: "Normal" } }, // no progress → 0 / 0
              ],
            },
          ],
        },
      ],
    });
    expect(latestRaidProgress(data)).toEqual({
      expansionName: "The War Within",
      instances: [
        {
          name: "Liberation of Undermine",
          modes: [{ difficulty: "Normal", completed: 0, total: 0 }],
        },
      ],
    });
  });

  it("returns null when there are no expansions", () => {
    expect(latestRaidProgress(doc({}))).toBeNull();
    expect(latestRaidProgress(doc({ expansions: [] }))).toBeNull();
  });
});
