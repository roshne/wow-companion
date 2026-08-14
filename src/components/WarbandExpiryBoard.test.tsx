import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen } from "@testing-library/react";

import { WarbandExpiryBoard } from "./WarbandExpiryBoard";
import type { WarbandAuctions, WarbandCharacter, WarbandData, WarbandMail } from "../lib/warband";

const NOW = 1785164400;
const HOUR = 3600;
const DAY = 86400;

// The component reads the wall clock via Date.now(); pin it so every countdown is deterministic.
beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date(NOW * 1000));
});
afterEach(() => {
  vi.useRealTimers();
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

describe("WarbandExpiryBoard", () => {
  it("shows the never-scanned empty state when no block has ever been written", () => {
    render(<WarbandExpiryBoard data={data([character({ mail: null, auctions: null })])} />);
    expect(
      screen.getByText(/No mailbox or auction house has been scanned yet/),
    ).toBeInTheDocument();
  });

  it("shows a distinct nothing-expiring empty state when scanned but clear", () => {
    render(
      <WarbandExpiryBoard data={data([character({ mail: mail({ count: 0, expiries: [] }) })])} />,
    );
    expect(screen.getByText("Nothing expiring, and no mail waiting.")).toBeInTheDocument();
    // The other branch's copy must be genuinely absent — the two empty states are mutually exclusive.
    expect(screen.queryByText(/No mailbox or auction house has been scanned yet/)).toBeNull();
  });

  it("surfaces characters with mail waiting", () => {
    render(
      <WarbandExpiryBoard
        data={data([character({ name: "Postie", mail: mail({ hasMail: true }) })])}
      />,
    );
    expect(screen.getByText("Postie")).toBeInTheDocument();
    expect(screen.getByText(/has mail/)).toBeInTheDocument();
  });

  it("renders a countdown qualified by its block's scan freshness", () => {
    render(
      <WarbandExpiryBoard
        data={data([
          character({
            name: "Trailing",
            mail: mail({ scannedAt: NOW - 2 * HOUR, count: 1, expiries: [NOW + 2 * DAY] }),
          }),
        ])}
      />,
    );
    // Countdown from the absolute expiry, and the freshness anchor is the block's own scan.
    expect(screen.getByText("2d")).toBeInTheDocument();
    expect(screen.getByText(/scanned 2h ago/)).toBeInTheDocument();
    expect(screen.getByText("2d")).not.toHaveClass("expiry-urgent");
  });

  it("marks an expiry inside a day as urgent", () => {
    render(
      <WarbandExpiryBoard
        data={data([
          character({ name: "Soon", mail: mail({ count: 1, expiries: [NOW + 3 * HOUR] }) }),
        ])}
      />,
    );
    expect(screen.getByText("3h")).toHaveClass("expiry-urgent");
  });

  it("renders a past expiry as expired rather than a negative countdown", () => {
    render(
      <WarbandExpiryBoard
        data={data([
          character({
            name: "Mixed",
            // One elapsed, one live: recent enough that the elapse is real, so it reads "expired".
            mail: mail({ count: 2, expiries: [NOW - HOUR, NOW + DAY] }),
          }),
        ])}
      />,
    );
    expect(screen.getByText("Already expired")).toBeInTheDocument();
    expect(screen.getByText(/Mail expired/)).toBeInTheDocument();
    // The live sibling still counts down; nothing renders a negative duration.
    expect(screen.getByText("1d")).toBeInTheDocument();
    expect(screen.queryByText(/-1h|-3600/)).toBeNull();
  });

  it("marks a block whose every expiry has elapsed as stale rather than counting it down", () => {
    render(
      <WarbandExpiryBoard
        data={data([
          character({
            name: "Ancient",
            auctions: auctions({
              scannedAt: NOW - 40 * DAY,
              count: 2,
              expiries: [NOW - 2 * DAY, NOW - DAY],
            }),
          }),
        ])}
      />,
    );
    expect(screen.getByText("Already expired")).toBeInTheDocument();
    expect(screen.getByText(/auction expiries all elapsed/)).toBeInTheDocument();
    // Marked by its scan date, not counted down.
    expect(screen.getByText(/scanned 40d ago/)).toBeInTheDocument();
    // No "Expiring soon" table — there is nothing future to count.
    expect(screen.queryByText("Expiring soon")).toBeNull();
  });

  it("reads grammatically when an all-elapsed block has no scan time", () => {
    render(
      <WarbandExpiryBoard
        data={data([
          character({
            name: "Timeless",
            mail: mail({ scannedAt: null, count: 1, expiries: [NOW - DAY] }),
          }),
        ])}
      />,
    );
    expect(screen.getByText(/all elapsed · scan time unknown/)).toBeInTheDocument();
  });

  it("gives distinct keys to two expiries sharing an epoch second (no duplicate-key warning)", () => {
    // Same-batch mail/auctions carry the same duration, so their absolute expiry epochs can collide;
    // the row key must still be unique. A React duplicate-key clash surfaces as a console.error.
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    render(
      <WarbandExpiryBoard
        data={data([
          character({
            name: "Batch",
            guid: null,
            mail: mail({ count: 2, expiries: [NOW + DAY, NOW + DAY] }),
          }),
        ])}
      />,
    );
    // Both rows render...
    expect(screen.getAllByText("1d")).toHaveLength(2);
    // ...with no "same key" warning.
    expect(errorSpy.mock.calls.some((args) => String(args[0]).includes("same key"))).toBe(false);
    errorSpy.mockRestore();
  });
});
