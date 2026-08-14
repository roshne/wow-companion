import { useMemo } from "react";
import type { WarbandCharacter, WarbandData } from "../lib/warband";
import type { ExpiryEntry, ExpiryKind, StaleBlock } from "../lib/expiryBoard";
import { buildExpiryBoard, formatCountdown } from "../lib/expiryBoard";
import { CLASS_COLORS } from "../lib/wow";

const KIND_LABEL: Record<ExpiryKind, string> = { mail: "Mail", auction: "Auction" };

/** A countdown inside this window is rendered urgent — "what runs out first" is the actionable half. */
const URGENT_WITHIN = 86400;

const plural = (n: number, one: string, many: string) => (n === 1 ? one : many);

/** Format a server-time epoch as a local date-time, or an em dash when absent. */
function when(epoch: number | null): string {
  if (epoch == null) return "—";
  return new Date(epoch * 1000).toLocaleString();
}

/** How long ago a block was scanned — the freshness the whole board hinges on, in plain words. */
function scannedAgo(scannedAt: number | null, now: number): string {
  if (scannedAt == null) return "scan time unknown";
  return `scanned ${formatCountdown(now - scannedAt)} ago`;
}

/** A class-coloured character name, matching the other warband boards. */
function CharacterName({ character }: { character: WarbandCharacter }) {
  const color = (character.classKey && CLASS_COLORS[character.classKey]) || undefined;
  return <span style={{ color, fontWeight: 600 }}>{character.name}</span>;
}

/**
 * The warband-wide mail & auction expiry roll-up.
 *
 * Leads with `hasMail` — the one signal that stays trustworthy without a fresh mailbox scan — then the
 * soonest upcoming expiries, each dated by its *own block's* scan so an "in 2 days" off a month-old
 * read can't pass as fact. Anything already elapsed reads as "expired" rather than a negative
 * countdown, and a block whose every expiry has lapsed is shown by its scan date, not counted down.
 */
export function WarbandExpiryBoard({ data }: { data: WarbandData | null }) {
  const now = Math.floor(Date.now() / 1000);
  const board = useMemo(() => buildExpiryBoard(data, now), [data, now]);
  const { mailWaiting, upcoming, expired, stale, scannedAny, lastScan } = board;

  if (
    mailWaiting.length === 0 &&
    upcoming.length === 0 &&
    expired.length === 0 &&
    stale.length === 0
  ) {
    // The two empty states the issue insists must read differently: a scanned-but-clear warband, and
    // one where no mailbox or auction house has ever been opened (so there is simply nothing to know).
    return (
      <p className="muted">
        {scannedAny
          ? "Nothing expiring, and no mail waiting."
          : "No mailbox or auction house has been scanned yet — open one in-game to record what's waiting to expire."}
      </p>
    );
  }

  return (
    <>
      <p className="muted" style={{ marginTop: 0 }}>
        Soonest expiries first, each dated by its own scan
        {lastScan != null ? ` · newest scan ${when(lastScan)}` : ""}
      </p>

      {mailWaiting.length > 0 && (
        <section style={{ marginBottom: "0.85rem" }}>
          <h3 style={{ margin: "0 0 0.35rem" }}>
            Mail waiting{" "}
            <span className="muted" style={{ fontWeight: 400, fontSize: "0.85rem" }}>
              ({mailWaiting.length} {plural(mailWaiting.length, "character", "characters")})
            </span>
          </h3>
          {/* From `HasNewMail()`, so this holds even when no mailbox has been opened recently — the
              reason the issue calls it the most useful signal here. */}
          <div className="row" style={{ flexWrap: "wrap", gap: "0.4rem" }}>
            {mailWaiting.map((c) => (
              <span
                key={c.guid ?? `${c.name}-${c.realm}`}
                className="expiry-badge"
                title={`${c.name} has unread mail waiting`}
              >
                <CharacterName character={c} /> · has mail
              </span>
            ))}
          </div>
        </section>
      )}

      {upcoming.length > 0 && (
        <section style={{ marginBottom: "0.85rem" }}>
          <h3 style={{ margin: "0 0 0.35rem" }}>Expiring soon</h3>
          <div style={{ overflowX: "auto" }}>
            <table className="grid">
              <thead>
                <tr>
                  <th>Character</th>
                  <th>Type</th>
                  <th>Expires in</th>
                  <th>Freshness</th>
                </tr>
              </thead>
              <tbody>
                {upcoming.map((e, i) => (
                  <tr key={`${rowKey(e)}-${i}`}>
                    <td style={{ whiteSpace: "nowrap" }}>
                      <CharacterName character={e.character} />
                    </td>
                    <td>{KIND_LABEL[e.kind]}</td>
                    <td
                      className={e.remaining < URGENT_WITHIN ? "expiry-urgent" : undefined}
                      style={{ whiteSpace: "nowrap" }}
                      title={`Expires ${when(e.expiresAt)}`}
                    >
                      {formatCountdown(e.remaining)}
                    </td>
                    <td
                      className="muted"
                      style={{ whiteSpace: "nowrap" }}
                      title={when(e.scannedAt)}
                    >
                      {scannedAgo(e.scannedAt, now)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {(expired.length > 0 || stale.length > 0) && (
        <section>
          <h3 style={{ margin: "0 0 0.35rem" }}>Already expired</h3>
          <ul className="muted" style={{ margin: 0, paddingLeft: "1.2rem" }}>
            {expired.map((e, i) => (
              <li key={`${rowKey(e)}-${i}`}>
                <CharacterName character={e.character} /> · {KIND_LABEL[e.kind]} expired ·{" "}
                {scannedAgo(e.scannedAt, now)}
              </li>
            ))}
            {stale.map((b) => (
              <li
                key={staleKey(b)}
                title={`Every recorded expiry has elapsed — shown by scan date rather than a countdown (${when(b.scannedAt)}).`}
              >
                <CharacterName character={b.character} /> · {b.count}{" "}
                {KIND_LABEL[b.kind].toLowerCase()} {plural(b.count, "expiry", "expiries")} all
                elapsed · {scannedAgo(b.scannedAt, now)}
              </li>
            ))}
          </ul>
        </section>
      )}
    </>
  );
}

// Character + kind + epoch, disambiguated at the call site with the array index — two items in one
// block can genuinely share an expiry second (same-batch mail/auctions all carry the same duration),
// so the epoch alone is not unique.
function rowKey(e: ExpiryEntry): string {
  return `${e.character.guid ?? `${e.character.name}-${e.character.realm}`}-${e.kind}-${e.expiresAt}`;
}

function staleKey(b: StaleBlock): string {
  return `${b.character.guid ?? `${b.character.name}-${b.character.realm}`}-${b.kind}`;
}
