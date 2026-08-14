// Warband-wide mail/auction expiry roll-up (#163): fold every character's `mail` and `auctions`
// blocks into one "what runs out first, and on whom" list, plus the `hasMail` signal. Pure and
// UI-free — the board component just renders what this returns.
//
// The freshness rule is the whole design problem. The countdown math on an absolute expiry epoch is
// always arithmetically correct; what's uncertain is whether the item still *exists*, which is only
// as fresh as the block's own `scannedAt`. So every entry carries its block's `scannedAt` (not the
// character's `lastRefresh`), a past expiry reads as "expired" rather than a negative countdown, and
// a block whose recorded expiries have *all* elapsed is set aside as {@link StaleBlock} — dated by
// its scan and never counted down.

import type { WarbandCharacter, WarbandData } from "./warband";

export type ExpiryKind = "mail" | "auction";

/** One expiring thing — a piece of mail or a posted auction — flattened out of a block's `expiries`. */
export interface ExpiryEntry {
  character: WarbandCharacter;
  kind: ExpiryKind;
  /** Absolute server-time epoch this thing expires at. */
  expiresAt: number;
  /** When the block this came from was scanned — the countdown's freshness anchor, not `lastRefresh`. */
  scannedAt: number | null;
  /** Seconds until expiry (`expiresAt - now`). Positive for {@link ExpiryBoard.upcoming}. */
  remaining: number;
}

/**
 * A character's `mail` or `auctions` block whose every recorded expiry has already elapsed.
 *
 * "A scan old enough that its expiries have all elapsed should say so instead of counting down." Such
 * a block has nothing future to count, so it's set aside here and rendered as its scan date rather
 * than a row of "expired" countdowns.
 */
export interface StaleBlock {
  character: WarbandCharacter;
  kind: ExpiryKind;
  scannedAt: number | null;
  /** How many expiries it recorded, all now in the past. */
  count: number;
}

export interface ExpiryBoard {
  /**
   * Characters with mail waiting, from `hasMail`. Built independently of `count`/`expiries`: it comes
   * from `HasNewMail()` and stays trustworthy even when the counts are stale, so it's the one signal
   * here that means something without a recent mailbox scan. Sorted by name.
   */
  mailWaiting: WarbandCharacter[];
  /** Future expiries across the warband, soonest-first — the actionable headline. */
  upcoming: ExpiryEntry[];
  /**
   * Expiries already elapsed, from blocks that still hold something upcoming (so the scan is recent
   * enough for the elapse to be real). "That mail has been returned or that auction has already
   * lapsed." Most-recently-expired first.
   */
  expired: ExpiryEntry[];
  /** Blocks whose every expiry has elapsed — marked by scan date rather than counted down. */
  stale: StaleBlock[];
  /**
   * Any character had a non-null `mail` or `auctions` block. Separates "scanned, nothing there" from
   * "no mailbox or auction house ever opened" — the two empty states the board must not conflate.
   */
  scannedAny: boolean;
  /** Newest `scannedAt` across every block — the board's overall "as of". */
  lastScan: number | null;
}

/** Sort two characters by name, for stable ordering of ties. */
function byName(a: WarbandCharacter, b: WarbandCharacter): number {
  return a.name.localeCompare(b.name);
}

/**
 * Fold one `mail`/`auctions` block into the accumulators.
 *
 * A block's future expiries become countdown entries; its past expiries become "expired" entries —
 * unless *every* expiry is past, in which case the whole block is set aside as stale (nothing to
 * count down, and dating a row of elapsed items by an old scan would only mislead). An absent or
 * expiry-less block contributes nothing.
 */
function foldBlock(
  character: WarbandCharacter,
  kind: ExpiryKind,
  block: { scannedAt: number | null; expiries: number[] } | null,
  now: number,
  upcoming: ExpiryEntry[],
  expired: ExpiryEntry[],
  stale: StaleBlock[],
): void {
  if (!block || block.expiries.length === 0) return;

  const anyFuture = block.expiries.some((e) => e > now);
  if (!anyFuture) {
    stale.push({ character, kind, scannedAt: block.scannedAt, count: block.expiries.length });
    return;
  }

  for (const expiresAt of block.expiries) {
    const entry: ExpiryEntry = {
      character,
      kind,
      expiresAt,
      scannedAt: block.scannedAt,
      remaining: expiresAt - now,
    };
    (expiresAt > now ? upcoming : expired).push(entry);
  }
}

/**
 * Build the warband's expiry roll-up as of `now` (a server-time epoch in seconds — injected rather
 * than read from the clock so the countdowns are deterministic under test, the same pattern the API
 * layer uses against `Date.now()`).
 */
export function buildExpiryBoard(data: WarbandData | null, now: number): ExpiryBoard {
  if (!data) {
    return {
      mailWaiting: [],
      upcoming: [],
      expired: [],
      stale: [],
      scannedAny: false,
      lastScan: null,
    };
  }

  const mailWaiting: WarbandCharacter[] = [];
  const upcoming: ExpiryEntry[] = [];
  const expired: ExpiryEntry[] = [];
  const stale: StaleBlock[] = [];
  let scannedAny = false;
  let lastScan: number | null = null;

  for (const character of data.characters) {
    if (character.mail?.hasMail === true) mailWaiting.push(character);

    for (const [kind, block] of [
      ["mail", character.mail],
      ["auction", character.auctions],
    ] as const) {
      if (!block) continue;
      scannedAny = true;
      if (block.scannedAt != null && (lastScan == null || block.scannedAt > lastScan)) {
        lastScan = block.scannedAt;
      }
      foldBlock(character, kind, block, now, upcoming, expired, stale);
    }
  }

  mailWaiting.sort(byName);
  // Soonest-first is the whole point — "what runs out first, and on whom" — with name as a stable
  // tie-break when two characters expire at the same instant.
  upcoming.sort((a, b) => a.expiresAt - b.expiresAt || byName(a.character, b.character));
  expired.sort((a, b) => b.expiresAt - a.expiresAt || byName(a.character, b.character));
  stale.sort((a, b) => byName(a.character, b.character) || a.kind.localeCompare(b.kind));

  return { mailWaiting, upcoming, expired, stale, scannedAny, lastScan };
}

/**
 * A coarse "time left" label: the two largest non-zero units, e.g. `2d 4h`, `3h 12m`, `5m`, `<1m`.
 *
 * For the {@link ExpiryBoard.upcoming} countdowns, so it expects a positive `seconds`; anything under
 * a minute (an imminent or just-elapsed expiry) collapses to `<1m` rather than a bare `0m`. Past
 * expiries never reach here — the board renders them as "expired".
 */
export function formatCountdown(seconds: number): string {
  if (seconds < 60) return "<1m";
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  if (days > 0) return hours > 0 ? `${days}d ${hours}h` : `${days}d`;
  if (hours > 0) return minutes > 0 ? `${hours}h ${minutes}m` : `${hours}h`;
  return `${minutes}m`;
}
