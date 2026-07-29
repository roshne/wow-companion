import { useEffect, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import type { Region } from "../vendor/battlenet-wow-client";
import type { WarbandData } from "../lib/warband";
import { accountProfileQuery, needsReconnect } from "../lib/accountProfile";
import { mergeRoster, rosterCounts, type RosterRow } from "../lib/accountRoster";
import { useAccountGrant, GRANT_LIFETIME_HOURS } from "../lib/account";
import { CLASS_COLORS } from "../lib/wow";
import { EmptyState } from "./EmptyState";

const plural = (n: number, one: string, many: string) => (n === 1 ? one : many);

/**
 * Prompt to connect an account — the state this view spends most of its life in, since connecting is
 * a deliberate act and the grant lapses daily.
 */
function ConnectPrompt({
  headline,
  detail,
  busy,
  onConnect,
  error,
}: {
  headline: string;
  detail: string;
  busy: boolean;
  onConnect: () => void;
  error: string;
}) {
  return (
    <div className="empty-state">
      <p style={{ margin: 0, fontWeight: 600 }}>{headline}</p>
      <p className="muted" style={{ margin: "0.25rem 0 0", maxWidth: "40rem" }}>
        {detail}
      </p>
      <button type="button" onClick={onConnect} disabled={busy}>
        {busy ? "Waiting for Battle.net…" : "Connect Battle.net account"}
      </button>
      {error && (
        <p className="muted" role="status">
          {error}
        </p>
      )}
    </div>
  );
}

/** The account each row belongs to, as a short stable label ("Account 1"). */
function accountLabels(rows: RosterRow[]): Map<number, string> {
  const ids = [...new Set(rows.flatMap((r) => (r.wowAccountId == null ? [] : [r.wowAccountId])))];
  ids.sort((a, b) => a - b);
  return new Map(ids.map((id, i) => [id, `Account ${i + 1}`]));
}

/**
 * Every character on the Battle.net account, merged with what the addon knows about them.
 *
 * This is the only view in the app whose row *list* comes from Battle.net rather than the addon, and
 * that is the whole point: the addon only knows characters logged into since it was installed, so
 * characters that exist but haven't been played recently are invisible everywhere else. Those rows
 * are marked — without a marker a missing item level reads as a neglected character rather than as
 * one the addon has simply never met.
 */
export function WarbandAllCharacters({
  data,
  region,
}: {
  data: WarbandData | null;
  region: Region;
}) {
  const grant = useAccountGrant();
  const connected = grant.state === "connected";

  const profile = useQuery({ ...accountProfileQuery(region), enabled: connected });

  // Battle.net rejecting the grant is the one thing `has_account_grant` cannot see: it is present and
  // unexpired locally. Only a read like this one discovers it, so the read is what reports it.
  const rejectedByBattleNet = needsReconnect(profile.error);
  const { reportRejected } = grant;
  useEffect(() => {
    if (rejectedByBattleNet) reportRejected();
  }, [rejectedByBattleNet, reportRejected]);

  const rows = useMemo(
    () => mergeRoster(profile.data?.characters ?? [], data?.characters ?? []),
    [profile.data, data],
  );
  const counts = useMemo(() => rosterCounts(rows), [rows]);
  const labels = useMemo(() => accountLabels(rows), [rows]);

  if (grant.state === "unknown") return <p className="muted">Checking your Battle.net account…</p>;

  if (grant.state === "rejected") {
    return (
      <ConnectPrompt
        headline="Battle.net ended this connection"
        detail={`The connection is no longer accepted — it was revoked, or it lapsed. Connecting again takes one browser round trip. A connection lasts ${GRANT_LIFETIME_HOURS} hours; Blizzard issues no way to renew one without asking you again.`}
        busy={grant.connecting}
        onConnect={() => void grant.connect()}
        error={grant.error}
      />
    );
  }

  if (!connected) {
    return (
      <ConnectPrompt
        headline="Connect your Battle.net account to see every character"
        detail="The other views here come from the Warbandeer addon, which only knows characters you've logged into since installing it. Battle.net knows every character on your account — including the ones you haven't played in a while. Connecting asks for your consent in a browser window and lasts a day."
        busy={grant.connecting}
        onConnect={() => void grant.connect()}
        error={grant.error}
      />
    );
  }

  if (profile.isPending) return <p className="muted">Loading your characters…</p>;

  // A rejected grant is already handled above once `reportRejected` lands; anything else is a genuine
  // failure worth retrying.
  if (profile.isError && !rejectedByBattleNet) {
    return (
      <EmptyState
        message={`Couldn't load your characters. ${profile.error.message}`}
        onRetry={() => void profile.refetch()}
      />
    );
  }

  if (rows.length === 0) {
    return (
      <EmptyState message="Battle.net returned no characters for this account on this region. If your characters are in another region, switch it in Settings." />
    );
  }

  const accounts = profile.data?.wowAccountCount ?? 0;

  return (
    <>
      <p className="muted" style={{ marginTop: 0 }}>
        <strong>
          {counts.total} {plural(counts.total, "character", "characters")}
        </strong>
        {accounts > 0 ? ` across ${accounts} WoW ${plural(accounts, "account", "accounts")}` : ""}
        {` · ${counts.deep} with addon detail`}
        {counts.apiOnly > 0 ? ` · ${counts.apiOnly} the addon hasn't seen` : ""}
        {counts.addonOnly > 0 ? ` · ${counts.addonOnly} only the addon remembers` : ""}
      </p>

      <div style={{ overflowX: "auto" }}>
        <table className="grid">
          <thead>
            <tr>
              <th>Character</th>
              <th>Realm</th>
              <th>Account</th>
              <th>Lvl</th>
              <th>iLvl</th>
              <th>Spec</th>
              <th>Race</th>
              <th>Faction</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => {
              const color = (row.classKey && CLASS_COLORS[row.classKey]) || undefined;
              return (
                <tr key={row.key}>
                  <td style={{ whiteSpace: "nowrap" }}>
                    <span style={{ color, fontWeight: 600 }}>{row.name}</span>
                    {row.source === "api-only" && (
                      <span
                        className="muted"
                        title="Battle.net lists this character, but the Warbandeer addon has never recorded it — so there's no item level, spec or weekly progress for it here."
                      >
                        {" "}
                        · not seen by the addon
                      </span>
                    )}
                    {row.source === "addon-only" && (
                      <span
                        className="muted"
                        title="The addon remembers this character, but Battle.net didn't return it for this region — it may be on another region, or no longer exist."
                      >
                        {" "}
                        · not in the Battle.net index
                      </span>
                    )}
                  </td>
                  <td>{row.realmName}</td>
                  <td className="muted">
                    {row.wowAccountId == null ? "—" : (labels.get(row.wowAccountId) ?? "—")}
                  </td>
                  <td>{row.level ?? "—"}</td>
                  <td>{row.itemLevel ?? "—"}</td>
                  <td style={{ whiteSpace: "nowrap" }}>{row.spec || row.className || "—"}</td>
                  <td>{row.race ?? "—"}</td>
                  <td>{row.faction ?? "—"}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </>
  );
}
