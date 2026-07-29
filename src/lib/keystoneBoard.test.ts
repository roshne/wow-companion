import { describe, it, expect } from "vitest";
import { buildKeystoneBoard, indexDungeons } from "./keystoneBoard";
import type { InstanceLock, WarbandCharacter, WarbandData } from "./warband";

const WEEK_START = 1785164400;

const DUNGEONS = [
  { id: 507, name: "Altar of Fangs" },
  { id: 503, name: "Ara-Kara, City of Echoes" },
];

const lock = (overrides: Partial<InstanceLock> = {}): InstanceLock => ({
  instanceId: 2810,
  difficultyId: 16,
  name: "Venomous Abyss",
  progress: 3,
  total: 8,
  reset: null,
  extended: null,
  isRaid: true,
  ...overrides,
});

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
    lastRefresh: WEEK_START + 100,
    gold: null,
    currencies: [],
    weekly: {
      vault: null,
      hasUnclaimedVault: null,
      keystoneLevel: 12,
      keystoneMap: 507,
      dungeonsDone: 5,
      dungeonsMax: 8,
    },
    locks: [],
    titles: null,
    ...overrides,
  };
}

function data(characters: WarbandCharacter[]): WarbandData {
  return {
    account: "TESTACCOUNT",
    source: "C:/wow/Warbandeer_Characters.lua",
    characters,
    titleCatalog: null,
    wealth: {
      bankGold: null,
      week: { start: WEEK_START, baseline: null, ending: null, made: null },
      history: [],
    },
  };
}

describe("indexDungeons", () => {
  it("indexes by challenge-map id", () => {
    expect(indexDungeons(DUNGEONS).get(507)).toBe("Altar of Fangs");
  });

  it("tolerates an absent catalogue", () => {
    expect(indexDungeons(undefined).size).toBe(0);
  });
});

describe("buildKeystoneBoard", () => {
  it("resolves the held keystone's dungeon name from the catalogue", () => {
    const board = buildKeystoneBoard(data([character({ name: "Keyholder" })]), DUNGEONS);
    expect(board.rows[0].dungeonName).toBe("Altar of Fangs");
    expect(board.rows[0].keystoneLevel).toBe(12);
    expect(board.withKeystone).toBe(1);
  });

  it("keeps the raw map id when the catalogue doesn't know it", () => {
    // The 12.1-day path: a new season's dungeon appears in the addon before the cached index has it.
    const board = buildKeystoneBoard(
      data([
        character({
          weekly: {
            vault: null,
            hasUnclaimedVault: null,
            keystoneLevel: 12,
            keystoneMap: 999,
            dungeonsDone: null,
            dungeonsMax: null,
          },
        }),
      ]),
      DUNGEONS,
    );
    expect(board.rows[0].dungeonName).toBeNull();
    expect(board.rows[0].keystoneMap).toBe(999);
  });

  it("still lists a keystone when the catalogue failed to load entirely", () => {
    const board = buildKeystoneBoard(data([character({ name: "Keyholder" })]), undefined);
    expect(board.rows).toHaveLength(1);
    expect(board.rows[0].keystoneLevel).toBe(12);
    expect(board.rows[0].dungeonName).toBeNull();
  });

  it("omits characters with neither a key nor a lockout", () => {
    const board = buildKeystoneBoard(
      data([character({ name: "Idle", weekly: null }), character({ name: "Keyed" })]),
      DUNGEONS,
    );
    expect(board.rows.map((r) => r.character.name)).toEqual(["Keyed"]);
  });

  it("includes a character with a lockout but no key", () => {
    const board = buildKeystoneBoard(
      data([character({ name: "Raider", weekly: null, locks: [lock()] })]),
      DUNGEONS,
    );
    expect(board.rows).toHaveLength(1);
    expect(board.rows[0].keystoneLevel).toBeNull();
    expect(board.rows[0].locks).toHaveLength(1);
  });

  it("drops lockouts with no progress and sorts the rest by difficulty", () => {
    const board = buildKeystoneBoard(
      data([
        character({
          locks: [
            lock({ difficultyId: 14 }),
            lock({ difficultyId: 16 }),
            lock({ difficultyId: 15, progress: 0 }),
          ],
        }),
      ]),
      DUNGEONS,
    );
    expect(board.rows[0].locks.map((l) => l.difficultyId)).toEqual([16, 14]);
  });

  it("orders by highest key, then most lockouts, with stale rows last", () => {
    const withKey = (name: string, level: number | null, stale = false) =>
      character({
        name,
        lastRefresh: stale ? WEEK_START - 10 : WEEK_START + 10,
        weekly: {
          vault: null,
          hasUnclaimedVault: null,
          keystoneLevel: level,
          keystoneMap: 507,
          dungeonsDone: null,
          dungeonsMax: null,
        },
        locks: level == null ? [lock()] : [],
      });

    const board = buildKeystoneBoard(
      data([
        withKey("Low", 8),
        withKey("StaleHigh", 20, true),
        withKey("High", 14),
        withKey("NoKey", null),
      ]),
      DUNGEONS,
    );
    // A stale key is last week's and has already been replaced, so it ranks below live rows.
    expect(board.rows.map((r) => r.character.name)).toEqual(["High", "Low", "NoKey", "StaleHigh"]);
  });

  it("marks a row whose data predates the reset", () => {
    const board = buildKeystoneBoard(
      data([character({ name: "Away", lastRefresh: WEEK_START - 500 })]),
      DUNGEONS,
    );
    expect(board.rows[0].stale).toBe(true);
  });

  it("returns an empty board for no data", () => {
    expect(buildKeystoneBoard(null, DUNGEONS).rows).toHaveLength(0);
  });
});
