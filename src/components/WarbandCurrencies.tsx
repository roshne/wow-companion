import { useMemo } from "react";
import type { Region } from "../vendor/battlenet-wow-client";
import type { WarbandData } from "../lib/warband";
import type { CurrencyCell, ResolvedCurrency } from "../lib/currencies";
import { buildCurrencyBoard, iconUrl } from "../lib/currencies";
import { CLASS_COLORS } from "../lib/wow";

function when(epoch: number | null): string {
  if (epoch == null) return "—";
  return new Date(epoch * 1000).toLocaleString();
}

/** A column header: the currency's icon and name, with the raw addon key exposed on hover. */
function Header({ currency, region }: { currency: ResolvedCurrency; region: Region }) {
  return (
    <th
      title={
        currency.known
          ? `${currency.name} (currency ${currency.id})`
          : `${currency.key} — not in the currency map, so it's shown by its addon key`
      }
    >
      <span className="currency-head">
        {currency.icon ? (
          <img
            className="currency-icon"
            src={iconUrl(currency.icon, region)}
            alt=""
            width={20}
            height={20}
            loading="lazy"
            // The bundle's slug and the CDN's filename don't always agree; a missing icon should
            // leave the name alone rather than show a broken image.
            onError={(e) => {
              e.currentTarget.style.display = "none";
            }}
          />
        ) : null}
        {currency.name}
      </span>
    </th>
  );
}

/** One amount, with cap progress where a cap applies. */
function Amount({ cell }: { cell: CurrencyCell | undefined }) {
  if (!cell) return <span className="muted">—</span>;
  const capped = cell.capped;
  return (
    <span
      className={capped ? "currency-capped" : undefined}
      title={
        cell.cap == null
          ? undefined
          : `${cell.capKind === "weekly" ? "Weekly earn cap" : "Hold cap"}: ${cell.cap}${
              cell.earned != null ? ` · earned this week: ${cell.earned}` : ""
            }${capped ? " · capped" : ""}`
      }
    >
      {cell.quantity.toLocaleString()}
      {cell.cap != null ? (
        <span className="muted">
          {" / "}
          {cell.cap.toLocaleString()}
        </span>
      ) : null}
    </span>
  );
}

/**
 * Currencies and crests across the warband: a characters × currencies matrix.
 *
 * Columns come from the data rather than a fixed list, and names/icons/caps are resolved through the
 * vendored static-data bundle — so a currency introduced in a new season shows up after a bundle
 * refresh instead of a code change. A key the bridge doesn't know still renders, by its addon key;
 * the live database already contains such keys from older addon versions.
 *
 * Caps prefer the addon's own figures over the bundle's single `maxQty`, because the addon
 * distinguishes a weekly *earn* cap from a hard *hold* cap and the bundle can't.
 */
export function WarbandCurrencies({ data, region }: { data: WarbandData | null; region: Region }) {
  const board = useMemo(() => buildCurrencyBoard(data), [data]);

  if (board.rows.length === 0) {
    return <p className="muted">No currencies recorded yet.</p>;
  }

  const unknown = board.columns.filter((c) => !c.known).length;
  const stale = board.rows.filter((r) => r.stale).length;

  return (
    <>
      <p className="muted" style={{ marginTop: 0 }}>
        {board.columns.length} {board.columns.length === 1 ? "currency" : "currencies"} across{" "}
        {board.rows.length} {board.rows.length === 1 ? "character" : "characters"}
        {" · data as of "}
        {when(board.lastRefresh)}
        {stale > 0 ? ` · ${stale} not seen since the reset` : ""}
        {unknown > 0 ? ` · ${unknown} shown by addon key (not in the currency map)` : ""}
      </p>

      <div style={{ overflowX: "auto" }}>
        <table className="grid currency-board">
          <thead>
            <tr>
              <th>Character</th>
              {board.columns.map((c) => (
                <Header key={c.key} currency={c} region={region} />
              ))}
            </tr>
          </thead>
          <tbody>
            {board.rows.map((row) => {
              const c = row.character;
              const color = (c.classKey && CLASS_COLORS[c.classKey]) || undefined;
              return (
                <tr key={c.guid ?? `${c.name}-${c.realm}`} className={row.stale ? "muted" : ""}>
                  <td style={{ whiteSpace: "nowrap" }}>
                    <span style={{ color, fontWeight: 600 }}>{c.name}</span>
                    {row.stale ? (
                      <span
                        className="muted"
                        title={`Last scanned ${when(c.lastRefresh)}, before this week's reset.`}
                      >
                        {" "}
                        · stale
                      </span>
                    ) : null}
                  </td>
                  {board.columns.map((col) => (
                    <td key={col.key}>
                      <Amount cell={row.cells[col.key]} />
                    </td>
                  ))}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </>
  );
}
