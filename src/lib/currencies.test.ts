import { describe, it, expect } from "vitest";
import {
  BUNDLE_BUILD,
  CURRENCY_IDS,
  buildCurrencyBoard,
  humanizeKey,
  iconUrl,
  resolveCurrency,
} from "./currencies";
import type { WarbandCharacter, WarbandCurrency, WarbandData } from "./warband";

const WEEK_START = 1785164400;

const currency = (overrides: Partial<WarbandCurrency> & { key: string }): WarbandCurrency => ({
  quantity: 0,
  earned: null,
  max: null,
  weeklyMax: null,
  capped: null,
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
    weekly: null,
    locks: [],
    ...overrides,
  };
}

function data(characters: WarbandCharacter[]): WarbandData {
  return {
    account: "TESTACCOUNT",
    source: "C:/wow/Warbandeer_Characters.lua",
    characters,
    wealth: {
      bankGold: null,
      week: { start: WEEK_START, baseline: null, ending: null, made: null },
      history: [],
    },
  };
}

describe("the key → id bridge", () => {
  it("resolves every key the addon currently writes against the vendored bundle", () => {
    // The bridge and the bundle are maintained independently — the addon's Lua defines the ids, the
    // bundle is vendored from a release feed — so this asserts they still agree.
    for (const key of Object.keys(CURRENCY_IDS)) {
      const r = resolveCurrency(key);
      expect(r.known, `${key} (id ${CURRENCY_IDS[key]}) missing from the bundle`).toBe(true);
      expect(r.name, `${key} resolved to an empty name`).toMatch(/\S/);
      expect(r.icon, `${key} resolved without an icon`).toMatch(/\S/);
    }
  });

  it("names a few known currencies from the bundle rather than from the key", () => {
    expect(resolveCurrency("HeroDawncrest").name).toBe("Hero Dawncrest");
    expect(resolveCurrency("ShardOfDundun").name).toBe("Shard of Dundun");
  });

  it("carries the bundle build so a stale bundle is visible", () => {
    expect(BUNDLE_BUILD).toMatch(/\S/);
  });
});

describe("resolveCurrency degradation", () => {
  it("falls back to a readable name for a key the bridge doesn't know", () => {
    // Real case: the live database holds `AdventurerCrest` and `Manaflux` from older addon versions.
    const r = resolveCurrency("AdventurerCrest");
    expect(r.known).toBe(false);
    expect(r.id).toBeNull();
    expect(r.name).toBe("Adventurer Crest");
    expect(r.icon).toBeNull();
  });

  it("normalises a zero bundle cap to no cap", () => {
    // maxQty 0 in the bundle means "uncapped", not "cap of zero".
    expect(resolveCurrency("RestoredCofferKey").bundleMaxQty).toBeNull();
    expect(resolveCurrency("MythDawncrest").bundleMaxQty).toBe(100);
  });
});

describe("humanizeKey", () => {
  it("splits camel case into words", () => {
    expect(humanizeKey("UntaintedManaCrystal")).toBe("Untainted Mana Crystal");
    expect(humanizeKey("Catalyst")).toBe("Catalyst");
  });
});

describe("iconUrl", () => {
  it("encodes a slug so one containing a space still forms a valid URL", () => {
    // The bundle really does carry `jewelcrafting_uncut epic gem_color1`.
    expect(iconUrl("jewelcrafting_uncut epic gem_color1", "us")).toBe(
      "https://render.worldofwarcraft.com/us/icons/56/jewelcrafting_uncut%20epic%20gem_color1.jpg",
    );
  });
});

describe("buildCurrencyBoard", () => {
  it("builds columns from the data rather than a fixed list", () => {
    const board = buildCurrencyBoard(
      data([
        character({ name: "A", currencies: [currency({ key: "HeroDawncrest", quantity: 40 })] }),
        character({ name: "B", currencies: [currency({ key: "MythDawncrest", quantity: 5 })] }),
      ]),
    );
    expect(board.columns.map((c) => c.name)).toEqual(["Hero Dawncrest", "Myth Dawncrest"]);
  });

  it("sorts unknown currencies after known ones", () => {
    const board = buildCurrencyBoard(
      data([
        character({
          currencies: [
            currency({ key: "AdventurerCrest", quantity: 1 }),
            currency({ key: "MythDawncrest", quantity: 2 }),
          ],
        }),
      ]),
    );
    expect(board.columns.map((c) => c.key)).toEqual(["MythDawncrest", "AdventurerCrest"]);
  });

  it("prefers the addon's weekly earn cap over its hold cap and the bundle's", () => {
    // The bundle has one `maxQty` and can't distinguish the two; the addon can.
    const board = buildCurrencyBoard(
      data([
        character({
          currencies: [
            currency({ key: "ShardOfDundun", quantity: 8, weeklyMax: 8, max: 8, capped: true }),
          ],
        }),
      ]),
    );
    const cell = board.rows[0].cells.ShardOfDundun;
    expect(cell.cap).toBe(8);
    expect(cell.capKind).toBe("weekly");
    expect(cell.capped).toBe(true);
  });

  it("falls back to the addon's hold cap, then to the bundle's", () => {
    const board = buildCurrencyBoard(
      data([
        character({
          currencies: [
            currency({ key: "Catalyst", quantity: 3, max: 8 }),
            // No addon cap at all: MythDawncrest's bundle maxQty (100) stands in.
            currency({ key: "MythDawncrest", quantity: 10 }),
          ],
        }),
      ]),
    );
    expect(board.rows[0].cells.Catalyst.capKind).toBe("hold");
    expect(board.rows[0].cells.MythDawncrest.cap).toBe(100);
    expect(board.rows[0].cells.MythDawncrest.capKind).toBe("hold");
  });

  it("leaves an uncapped currency without a cap", () => {
    const board = buildCurrencyBoard(
      data([character({ currencies: [currency({ key: "FieldAccolade", quantity: 4 })] })]),
    );
    expect(board.rows[0].cells.FieldAccolade.cap).toBeNull();
    expect(board.rows[0].cells.FieldAccolade.capKind).toBeNull();
  });

  it("omits characters with no currencies at all", () => {
    const board = buildCurrencyBoard(
      data([
        character({ name: "Empty" }),
        character({ name: "Has", currencies: [currency({ key: "Catalyst", quantity: 1 })] }),
      ]),
    );
    expect(board.rows.map((r) => r.character.name)).toEqual(["Has"]);
  });

  it("marks and sorts stale characters last", () => {
    const board = buildCurrencyBoard(
      data([
        character({
          name: "Stale",
          lastRefresh: WEEK_START - 10,
          currencies: [currency({ key: "Catalyst", quantity: 1 })],
        }),
        character({
          name: "Fresh",
          lastRefresh: WEEK_START + 10,
          currencies: [currency({ key: "Catalyst", quantity: 1 })],
        }),
      ]),
    );
    expect(board.rows.map((r) => r.character.name)).toEqual(["Fresh", "Stale"]);
    expect(board.rows[1].stale).toBe(true);
  });

  it("returns an empty board for no data", () => {
    expect(buildCurrencyBoard(null).columns).toHaveLength(0);
  });
});
