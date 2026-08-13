import { describe, it, expect } from "vitest";
import { mergeRoster, rosterCounts } from "./accountRoster";
import type { AccountCharacter } from "./accountProfile";
import type { WarbandCharacter } from "./warband";

function apiCharacter(overrides: Partial<AccountCharacter> = {}): AccountCharacter {
  return {
    name: "Nobody",
    id: 1,
    wowAccountId: 111,
    realmName: "Area 52",
    realmSlug: "area-52",
    class: "Mage",
    race: "Troll",
    faction: "Horde",
    gender: "Female",
    level: 80,
    protected: false,
    ...overrides,
  };
}

function addonCharacter(overrides: Partial<WarbandCharacter> = {}): WarbandCharacter {
  return {
    name: "Nobody",
    realm: "Area 52",
    guid: null,
    classId: null,
    classKey: null,
    className: null,
    level: null,
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
    mail: null,
    auctions: null,
    ...overrides,
  };
}

describe("mergeRoster", () => {
  it("keeps the addon's depth where both sources describe a character", () => {
    // The whole point of the merge: the API knows this character exists, the addon knows what
    // they've been doing. Neither alone is the full row.
    const rows = mergeRoster(
      [apiCharacter({ name: "Nazu", level: 80 })],
      [addonCharacter({ name: "Nazu", itemLevel: 684, spec: "Frost", guild: "Nazu Mods" })],
    );

    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      name: "Nazu",
      source: "both",
      itemLevel: 684,
      spec: "Frost",
      guild: "Nazu Mods",
      level: 80,
    });
  });

  it("marks a character the addon has never seen, rather than letting it read as unplayed", () => {
    // These rows are the reason the endpoint is worth calling — ~10 of 68 on the real account. With
    // no marker, a blank item level looks like neglect instead of "not seen yet".
    const rows = mergeRoster([apiCharacter({ name: "Forgotten", level: 12 })], []);

    expect(rows[0].source).toBe("api-only");
    expect(rows[0].itemLevel).toBeNull();
    expect(rows[0].level).toBe(12);
  });

  it("keeps a character only the addon remembers rather than dropping it", () => {
    // Another region, another Battle.net account, or a deleted character. Vanishing without a word
    // is worse than an odd row.
    const rows = mergeRoster([], [addonCharacter({ name: "Ghost", realm: "Stormrage" })]);

    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ name: "Ghost", source: "addon-only", wowAccountId: null });
  });

  it("matches the two sources case-insensitively and ignores surrounding whitespace", () => {
    const rows = mergeRoster(
      [apiCharacter({ name: "Nazu", realmName: "Area 52" })],
      [addonCharacter({ name: "nazu", realm: " AREA 52 ", itemLevel: 600 })],
    );

    expect(rows).toHaveLength(1);
    expect(rows[0].source).toBe("both");
    expect(rows[0].itemLevel).toBe(600);
  });

  it("still matches when the addon stored a realm slug instead of a display name", () => {
    const rows = mergeRoster(
      [apiCharacter({ name: "Nazu", realmName: "Area 52", realmSlug: "area-52" })],
      [addonCharacter({ name: "Nazu", realm: "area-52", itemLevel: 600 })],
    );

    expect(rows).toHaveLength(1);
    expect(rows[0].source).toBe("both");
  });

  it("does not merge same-named characters on different realms", () => {
    const rows = mergeRoster(
      [apiCharacter({ name: "Nazu", realmName: "Area 52" })],
      [addonCharacter({ name: "Nazu", realm: "Stormrage", itemLevel: 600 })],
    );

    expect(rows).toHaveLength(2);
    expect(rows.map((r) => r.source).sort()).toEqual(["addon-only", "api-only"]);
  });

  it("carries the WoW account through, so several accounts stay distinguishable", () => {
    const rows = mergeRoster(
      [
        apiCharacter({ name: "First", wowAccountId: 111 }),
        apiCharacter({ name: "Second", wowAccountId: 222 }),
      ],
      [],
    );

    expect(rows.map((r) => r.wowAccountId)).toEqual([111, 222]);
  });

  it("prefers the API's level, which is current, over the addon's last-logout value", () => {
    const rows = mergeRoster(
      [apiCharacter({ name: "Nazu", level: 80 })],
      [addonCharacter({ name: "Nazu", level: 71 })],
    );

    expect(rows[0].level).toBe(80);
  });

  it("falls back to the addon's level when the API entry carries none", () => {
    const rows = mergeRoster(
      [apiCharacter({ name: "Nazu", level: null })],
      [addonCharacter({ name: "Nazu", level: 71 })],
    );

    expect(rows[0].level).toBe(71);
  });

  it("keeps the addon's class key so rows can still be class-coloured", () => {
    const rows = mergeRoster(
      [apiCharacter({ name: "Nazu", class: "Mage" })],
      [addonCharacter({ name: "Nazu", classKey: "MAGE", className: "Mage" })],
    );

    expect(rows[0].classKey).toBe("MAGE");
    // An api-only row has no class key at all — colouring degrades, the name doesn't.
    const apiOnly = mergeRoster([apiCharacter({ name: "Other", class: "Priest" })], []);
    expect(apiOnly[0].classKey).toBeNull();
    expect(apiOnly[0].className).toBe("Priest");
  });

  it("orders by realm then name so rows don't shuffle as sources come and go", () => {
    const rows = mergeRoster(
      [
        apiCharacter({ name: "Zeta", realmName: "Area 52" }),
        apiCharacter({ name: "Alpha", realmName: "Stormrage" }),
        apiCharacter({ name: "Alpha", realmName: "Area 52" }),
      ],
      [],
    );

    expect(rows.map((r) => `${r.realmName}/${r.name}`)).toEqual([
      "Area 52/Alpha",
      "Area 52/Zeta",
      "Stormrage/Alpha",
    ]);
  });

  it("carries the protected marker through from the API entry", () => {
    const rows = mergeRoster([apiCharacter({ protected: true })], []);
    expect(rows[0].protected).toBe(true);
  });

  it("renders nothing at all when neither source has anything", () => {
    expect(mergeRoster([], [])).toEqual([]);
  });
});

describe("rosterCounts", () => {
  it("counts what each source contributed", () => {
    // The shape of the real account: most characters deep, a handful the addon has never seen.
    const rows = mergeRoster(
      [
        apiCharacter({ name: "Deep1" }),
        apiCharacter({ name: "Deep2" }),
        apiCharacter({ name: "Unseen" }),
      ],
      [
        addonCharacter({ name: "Deep1", itemLevel: 600 }),
        addonCharacter({ name: "Deep2", itemLevel: 610 }),
        addonCharacter({ name: "Elsewhere", realm: "Stormrage" }),
      ],
    );

    expect(rosterCounts(rows)).toEqual({ total: 4, deep: 2, apiOnly: 1, addonOnly: 1 });
  });
});
