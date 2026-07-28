import { describe, it, expect } from "vitest";
import type { CharacterRaids } from "./queries";
import { latestRaidProgress } from "./raids";

const doc = (v: unknown): CharacterRaids => v as CharacterRaids;

describe("season rollover", () => {
  it("picks the highest expansion id even when the payload isn't oldest-first", () => {
    // Relying on array position fails silently: the wrong tier still renders as a plausible one.
    const data = doc({
      expansions: [
        {
          expansion: { name: "Midnight", id: 500 },
          instances: [{ instance: { name: "Venomous Abyss" }, modes: [] }],
        },
        {
          expansion: { name: "The War Within", id: 499 },
          instances: [{ instance: { name: "Nerub-ar Palace" }, modes: [] }],
        },
      ],
    });
    expect(latestRaidProgress(data)?.expansionName).toBe("Midnight");
  });

  it("still falls back to the last entry when no expansion carries an id", () => {
    const data = doc({
      expansions: [
        { expansion: { name: "The War Within" }, instances: [] },
        { expansion: { name: "Midnight" }, instances: [] },
      ],
    });
    expect(latestRaidProgress(data)?.expansionName).toBe("Midnight");
  });

  it("shows a new patch tier without any change, since it joins the current expansion", () => {
    // 12.1's raid is a Midnight instance, not a new expansion — the shape this already handles.
    const data = doc({
      expansions: [
        {
          expansion: { name: "Midnight", id: 500 },
          instances: [
            { instance: { name: "The Voidforge" }, modes: [] },
            {
              instance: { name: "Venomous Abyss" },
              modes: [
                {
                  difficulty: { name: "Mythic" },
                  progress: { completed_count: 2, total_count: 8 },
                },
              ],
            },
          ],
        },
      ],
    });
    const progress = latestRaidProgress(data);
    expect(progress?.instances.map((i) => i.name)).toEqual(["The Voidforge", "Venomous Abyss"]);
    expect(progress?.instances[1].modes[0]).toEqual({
      difficulty: "Mythic",
      completed: 2,
      total: 8,
    });
  });
});

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
