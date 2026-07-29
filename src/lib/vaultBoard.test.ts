import { describe, it, expect } from "vitest";
import { buildVaultBoard, isStale, levelCap } from "./vaultBoard";
import type { InstanceLock, VaultSlot, WarbandCharacter, WarbandData } from "./warband";

const WEEK_START = 1785164400;

function slot(threshold: number, progress: number, ilvl: number | null = null): VaultSlot {
  return { threshold, progress, complete: progress >= threshold, ilvl };
}

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
    lastRefresh: WEEK_START + 1000,
    gold: null,
    currencies: [],
    weekly: {
      vault: { raid: [], dungeons: [], world: [] },
      hasUnclaimedVault: false,
      keystoneLevel: null,
      keystoneMap: null,
      dungeonsDone: null,
      dungeonsMax: null,
    },
    locks: [],
    titles: null,
    ...overrides,
  };
}

function data(characters: WarbandCharacter[], weekStart: number | null = WEEK_START): WarbandData {
  return {
    account: "TESTACCOUNT",
    source: "C:/wow/Warbandeer_Characters.lua",
    characters,
    titleCatalog: null,
    wealth:
      weekStart == null
        ? null
        : {
            bankGold: null,
            week: { start: weekStart, baseline: null, ending: null, made: null },
            history: [],
          },
  };
}

describe("levelCap", () => {
  it("derives the cap from the warband's own highest character", () => {
    expect(levelCap([character({ level: 80 }), character({ level: 90 })])).toBe(90);
  });

  it("is null when no character has a level", () => {
    expect(levelCap([character({ level: null })])).toBeNull();
  });
});

describe("isStale", () => {
  it("is true when the character was last scanned before the current reset", () => {
    expect(isStale(character({ lastRefresh: WEEK_START - 1 }), WEEK_START)).toBe(true);
  });

  it("is false when scanned since the reset", () => {
    expect(isStale(character({ lastRefresh: WEEK_START + 1 }), WEEK_START)).toBe(false);
  });

  it("is false when it can't be known, rather than guessing", () => {
    // Claiming staleness we can't demonstrate is worse than staying quiet.
    expect(isStale(character({ lastRefresh: null }), WEEK_START)).toBe(false);
    expect(isStale(character({ lastRefresh: WEEK_START - 1 }), null)).toBe(false);
  });
});

describe("buildVaultBoard", () => {
  it("omits characters below the warband's level cap and counts them", () => {
    const board = buildVaultBoard(
      data([character({ name: "Capped", level: 90 }), character({ name: "Levelling", level: 70 })]),
    );
    expect(board.rows.map((r) => r.character.name)).toEqual(["Capped"]);
    expect(board.levellingExcluded).toBe(1);
  });

  it("omits a capped character with no vault data rather than showing an empty row", () => {
    // An empty row would read as "nothing earned" when the truth is "nothing recorded".
    const board = buildVaultBoard(data([character({ name: "NoVault", weekly: null })]));
    expect(board.rows).toHaveLength(0);
  });

  it("counts unlocked slots per track", () => {
    const board = buildVaultBoard(
      data([
        character({
          weekly: {
            vault: {
              raid: [slot(2, 6, 723), slot(4, 6, 726), slot(6, 6, 730)],
              dungeons: [slot(1, 2, 720), slot(4, 2), slot(8, 2)],
              world: [],
            },
            hasUnclaimedVault: false,
            keystoneLevel: null,
            keystoneMap: null,
            dungeonsDone: null,
            dungeonsMax: null,
          },
        }),
      ]),
    );
    const row = board.rows[0];
    expect(row.raid.unlocked).toBe(3);
    expect(row.raid.total).toBe(3);
    expect(row.dungeons.unlocked).toBe(1);
    expect(row.world.total).toBe(0);
  });

  it("flags a character whose data predates the reset as stale", () => {
    const board = buildVaultBoard(
      data([
        character({ name: "Fresh", lastRefresh: WEEK_START + 10 }),
        character({ name: "Stale", lastRefresh: WEEK_START - 10 }),
      ]),
    );
    expect(board.rows.find((r) => r.character.name === "Stale")!.stale).toBe(true);
    expect(board.rows.find((r) => r.character.name === "Fresh")!.stale).toBe(false);
  });

  it("puts unclaimed rewards first, then fresh rows, then the least progressed", () => {
    const withUnclaimed = (name: string, unclaimed: boolean, unlocked: number, stale = false) =>
      character({
        name,
        lastRefresh: stale ? WEEK_START - 10 : WEEK_START + 10,
        weekly: {
          vault: {
            raid: [slot(2, unlocked >= 1 ? 2 : 0), slot(4, unlocked >= 2 ? 4 : 0)],
            dungeons: [],
            world: [],
          },
          hasUnclaimedVault: unclaimed,
          keystoneLevel: null,
          keystoneMap: null,
          dungeonsDone: null,
          dungeonsMax: null,
        },
      });

    const board = buildVaultBoard(
      data([
        withUnclaimed("MostProgress", false, 2),
        withUnclaimed("StaleRow", false, 0, true),
        withUnclaimed("LeastProgress", false, 1),
        withUnclaimed("Unclaimed", true, 2),
      ]),
    );
    // Unclaimed first (it costs you something to ignore); stale last (can't be acted on).
    expect(board.rows.map((r) => r.character.name)).toEqual([
      "Unclaimed",
      "LeastProgress",
      "MostProgress",
      "StaleRow",
    ]);
  });

  it("keeps only raid lockouts with progress, most prestigious difficulty first", () => {
    const lock = (difficultyId: number, progress: number, isRaid: boolean): InstanceLock => ({
      instanceId: 2810,
      difficultyId,
      name: "Venomous Abyss",
      progress,
      total: 8,
      reset: null,
      extended: null,
      isRaid,
    });
    const board = buildVaultBoard(
      data([
        character({
          locks: [lock(14, 3, true), lock(16, 1, true), lock(23, 4, false), lock(15, 0, true)],
        }),
      ]),
    );
    const locks = board.rows[0].raidLocks;
    // Mythic (16) before Normal (14); the dungeon and the zero-progress lock are both dropped.
    expect(locks.map((l) => l.difficultyId)).toEqual([16, 14]);
  });

  it("reports the newest scan across shown characters as the board's as-of", () => {
    const board = buildVaultBoard(
      data([
        character({ name: "Older", lastRefresh: WEEK_START + 10 }),
        character({ name: "Newer", lastRefresh: WEEK_START + 99 }),
      ]),
    );
    expect(board.lastRefresh).toBe(WEEK_START + 99);
  });

  it("returns an empty board for no data", () => {
    expect(buildVaultBoard(null).rows).toHaveLength(0);
  });
});
