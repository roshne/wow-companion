import { describe, it, expect } from "vitest";
import { buildExpiryBoard, formatCountdown } from "./expiryBoard";
import type { WarbandAuctions, WarbandCharacter, WarbandData, WarbandMail } from "./warband";

// A fixed "now" (server-time epoch, seconds) so every countdown is deterministic.
const NOW = 1785164400;
const HOUR = 3600;
const DAY = 86400;

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
    lastRefresh: NOW,
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

function mail(overrides: Partial<WarbandMail> = {}): WarbandMail {
  return { scannedAt: NOW, count: 0, expiries: [], money: null, hasMail: null, ...overrides };
}

function auctions(overrides: Partial<WarbandAuctions> = {}): WarbandAuctions {
  return { scannedAt: NOW, count: 0, expiries: [], value: null, ...overrides };
}

function data(characters: WarbandCharacter[]): WarbandData {
  return {
    account: "TESTACCOUNT",
    source: "C:/wow/Warbandeer_Characters.lua",
    characters,
    wealth: null,
    titleCatalog: null,
  };
}

describe("buildExpiryBoard", () => {
  it("returns an empty board for no data", () => {
    const board = buildExpiryBoard(null, NOW);
    expect(board).toEqual({
      mailWaiting: [],
      upcoming: [],
      expired: [],
      stale: [],
      scannedAny: false,
      lastScan: null,
    });
  });

  it("sorts upcoming expiries soonest-first across characters and kinds", () => {
    const board = buildExpiryBoard(
      data([
        character({ name: "Aria", mail: mail({ count: 1, expiries: [NOW + 5 * DAY] }) }),
        character({ name: "Borin", auctions: auctions({ count: 1, expiries: [NOW + 1 * DAY] }) }),
        character({ name: "Cael", mail: mail({ count: 1, expiries: [NOW + 2 * DAY] }) }),
      ]),
      NOW,
    );
    expect(
      board.upcoming.map((e) => `${e.character.name}:${e.kind}:${(e.expiresAt - NOW) / DAY}d`),
    ).toEqual(["Borin:auction:1d", "Cael:mail:2d", "Aria:mail:5d"]);
  });

  it("classifies a past expiry as expired with a negative remaining, never in upcoming", () => {
    // A block with one elapsed and one live expiry: the scan is recent enough that the elapse is real,
    // so the past one is "expired" (not a negative countdown) and the future one still counts down.
    const board = buildExpiryBoard(
      data([
        character({ name: "Mixed", mail: mail({ count: 2, expiries: [NOW - HOUR, NOW + DAY] }) }),
      ]),
      NOW,
    );
    expect(board.upcoming.map((e) => e.expiresAt)).toEqual([NOW + DAY]);
    expect(board.expired).toHaveLength(1);
    expect(board.expired[0].remaining).toBe(-HOUR);
    expect(board.stale).toHaveLength(0);
  });

  it("qualifies each countdown by its own block's scannedAt, not the character's lastRefresh", () => {
    const scannedAt = NOW - 3 * DAY;
    const board = buildExpiryBoard(
      data([
        character({
          name: "Trailing",
          lastRefresh: NOW,
          mail: mail({ scannedAt, count: 1, expiries: [NOW + DAY] }),
        }),
      ]),
      NOW,
    );
    expect(board.upcoming[0].scannedAt).toBe(scannedAt);
    expect(board.upcoming[0].scannedAt).not.toBe(board.upcoming[0].character.lastRefresh);
  });

  it("sets aside a block whose every expiry has elapsed as stale, not counted down", () => {
    const scannedAt = NOW - 40 * DAY;
    const board = buildExpiryBoard(
      data([
        character({
          name: "Ancient",
          auctions: auctions({
            scannedAt,
            count: 3,
            expiries: [NOW - 2 * DAY, NOW - DAY, NOW - HOUR],
          }),
        }),
      ]),
      NOW,
    );
    expect(board.upcoming).toHaveLength(0);
    expect(board.expired).toHaveLength(0);
    expect(board.stale).toEqual([
      {
        character: expect.objectContaining({ name: "Ancient" }),
        kind: "auction",
        scannedAt,
        count: 3,
      },
    ]);
  });

  it("surfaces hasMail independently of count and expiries", () => {
    const board = buildExpiryBoard(
      data([
        character({ name: "Waiting", mail: mail({ count: 0, expiries: [], hasMail: true }) }),
        character({
          name: "Quiet",
          mail: mail({ count: 5, expiries: [NOW + DAY], hasMail: false }),
        }),
        character({ name: "Unknown", mail: mail({ hasMail: null }) }),
      ]),
      NOW,
    );
    // Present with no messages and no expiries, but hasMail — still surfaced; false/null are not.
    expect(board.mailWaiting.map((c) => c.name)).toEqual(["Waiting"]);
  });

  it("distinguishes never-scanned from scanned-but-empty via scannedAny", () => {
    const neverScanned = buildExpiryBoard(data([character({ mail: null, auctions: null })]), NOW);
    expect(neverScanned.scannedAny).toBe(false);

    const scannedEmpty = buildExpiryBoard(
      data([character({ mail: mail({ count: 0, expiries: [] }) })]),
      NOW,
    );
    expect(scannedEmpty.scannedAny).toBe(true);
    expect(scannedEmpty.upcoming).toHaveLength(0);
  });

  it("reports the newest scannedAt across blocks as the board's as-of", () => {
    const board = buildExpiryBoard(
      data([
        character({ name: "Old", mail: mail({ scannedAt: NOW - 10 * DAY, hasMail: true }) }),
        character({ name: "Recent", auctions: auctions({ scannedAt: NOW - HOUR }) }),
      ]),
      NOW,
    );
    expect(board.lastScan).toBe(NOW - HOUR);
  });
});

describe("formatCountdown", () => {
  it("shows the two largest non-zero units", () => {
    expect(formatCountdown(2 * DAY + 4 * HOUR)).toBe("2d 4h");
    expect(formatCountdown(3 * HOUR + 12 * 60)).toBe("3h 12m");
    expect(formatCountdown(5 * 60)).toBe("5m");
  });

  it("drops a zero lower unit", () => {
    expect(formatCountdown(2 * DAY)).toBe("2d");
    expect(formatCountdown(3 * HOUR)).toBe("3h");
    expect(formatCountdown(DAY + HOUR)).toBe("1d 1h");
  });

  it("collapses anything under a minute to <1m", () => {
    expect(formatCountdown(59)).toBe("<1m");
    expect(formatCountdown(1)).toBe("<1m");
  });

  it("treats exact unit boundaries as that unit", () => {
    expect(formatCountdown(60)).toBe("1m");
    expect(formatCountdown(HOUR)).toBe("1h");
    expect(formatCountdown(DAY)).toBe("1d");
  });
});
