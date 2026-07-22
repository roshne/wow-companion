import { useId, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useVirtualizer } from "@tanstack/react-virtual";
import type { BlizzardClient } from "../vendor/battlenet-wow-client";
import { loc } from "../lib/types";
import { QUALITY_COLORS, formatGold } from "../lib/wow";
import {
  connectedRealmsQuery,
  realmAuctionsQuery,
  commoditiesQuery,
  describeError,
} from "../lib/queries";
import { useItemNames } from "../lib/useItemNames";
import type { AuctionMode, AggregatedRow } from "../lib/auctions";
import { SkeletonTable } from "./Skeleton";
import { EmptyState } from "./EmptyState";
import { Tabs, tabId, panelId, type TabSpec } from "./Tabs";

// A stable empty array so the sort memo doesn't re-run every render while a query is pending.
const NO_ROWS: AggregatedRow[] = [];

// Estimated row height (px) for the virtualizer; rows are fixed-height so no per-row measuring.
const ROW_HEIGHT = 34;

/** The two auction sources; each swaps the panel below, so they're a tablist rather than a toggle. */
const MODE_TABS: TabSpec<AuctionMode>[] = [
  { key: "commodities", label: "Region commodities" },
  { key: "realm", label: "Realm auctions" },
];

type SortKey = "price" | "quantity" | "listings";
interface Sort {
  key: SortKey;
  dir: 1 | -1;
}

/**
 * A column header that applies (or reverses) the list's sort.
 *
 * Hoisted to module scope deliberately: declared inside `AuctionHouse` it was a *new component type*
 * on every render, so React unmounted and remounted the whole header — on every scroll frame, and
 * critically on the click that activated it, which dropped keyboard focus onto `<body>`.
 */
function SortButton({
  label,
  sortKey,
  sort,
  onToggle,
}: {
  label: string;
  sortKey: SortKey;
  sort: Sort;
  onToggle: (key: SortKey) => void;
}) {
  const active = sort.key === sortKey;
  return (
    <button
      type="button"
      className="ghost ah-sort"
      aria-pressed={active}
      onClick={() => onToggle(sortKey)}
      title="Sort"
    >
      {label}
      {active ? (sort.dir === 1 ? " ▲" : " ▼") : ""}
    </button>
  );
}

/** Compare two aggregated rows on the active sort key; rows with no price always sort last. */
function compareRows(a: AggregatedRow, b: AggregatedRow, sort: Sort): number {
  if (sort.key === "price") {
    if (a.minPrice === null && b.minPrice === null) return 0;
    if (a.minPrice === null) return 1;
    if (b.minPrice === null) return -1;
    return (a.minPrice - b.minPrice) * sort.dir;
  }
  const av = sort.key === "quantity" ? a.totalQuantity : a.listings;
  const bv = sort.key === "quantity" ? b.totalQuantity : b.listings;
  return (av - bv) * sort.dir;
}

/**
 * Auction house browser. Two modes share one virtualized, item-aggregated list:
 *   - Region commodities (loads immediately, region-wide).
 *   - Realm auctions (needs a connected-realm pick).
 * The snapshot is fetched once and held (Infinity staleTime) — only Refresh re-fetches. Item names are
 * resolved for the visible viewport only (`useItemNames`), so a huge snapshot resolves just a handful.
 */
export function AuctionHouse({ bnet }: { bnet: BlizzardClient }) {
  const [mode, setMode] = useState<AuctionMode>("commodities");
  const [connectedRealmId, setConnectedRealmId] = useState<number | null>(null);
  const [sort, setSort] = useState<Sort>({ key: "quantity", dir: -1 });
  const base = useId();

  // The connected-realm picker reuses the search-based list (id + localized realm names) — the same
  // data the Realm Status tab loads. Only needed in realm mode.
  const realms = useQuery({ ...connectedRealmsQuery(bnet), enabled: mode === "realm" });
  const realmAuctions = useQuery({
    ...realmAuctionsQuery(bnet, connectedRealmId ?? 0),
    enabled: mode === "realm" && connectedRealmId !== null,
  });
  const commodities = useQuery({ ...commoditiesQuery(bnet), enabled: mode === "commodities" });

  const active = mode === "realm" ? realmAuctions : commodities;
  const rows = active.data ?? NO_ROWS;

  const realmOptions = useMemo(
    () =>
      (realms.data ?? [])
        .flatMap((cr) => {
          if (typeof cr.id !== "number") return [];
          const label = (cr.realms ?? [])
            .map((r) => loc(r.name))
            .filter(Boolean)
            .join(" / ");
          return [{ id: cr.id, label: label || `#${cr.id}` }];
        })
        .sort((a, b) => a.label.localeCompare(b.label)),
    [realms.data],
  );

  const sortedRows = useMemo(() => [...rows].sort((a, b) => compareRows(a, b, sort)), [rows, sort]);

  const scrollRef = useRef<HTMLDivElement>(null);
  const virtualizer = useVirtualizer({
    count: sortedRows.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => ROW_HEIGHT,
    overscan: 12,
  });
  const virtualRows = virtualizer.getVirtualItems();

  // Resolve names for the on-screen rows only.
  const visibleIds = virtualRows.map((v) => sortedRows[v.index].itemId);
  const names = useItemNames(bnet, visibleIds);

  const priceLabel = mode === "realm" ? "Min buyout" : "Min unit price";
  const awaitingRealm = mode === "realm" && connectedRealmId === null;

  function toggleSort(key: SortKey) {
    setSort((s) => (s.key === key ? { key, dir: s.dir === 1 ? -1 : 1 } : { key, dir: -1 }));
  }

  return (
    <section className="card">
      <div className="row" style={{ justifyContent: "space-between", flexWrap: "wrap" }}>
        <h2 style={{ margin: 0 }}>Auction House</h2>
        <div className="row" style={{ flexWrap: "wrap" }}>
          <Tabs
            base={base}
            label="Auction source"
            tabs={MODE_TABS}
            active={mode}
            onSelect={setMode}
            style={{ border: "none", margin: 0 }}
          />
          {mode === "realm" && (
            <select
              aria-label="Realm"
              value={connectedRealmId ?? ""}
              onChange={(e) =>
                setConnectedRealmId(e.currentTarget.value ? Number(e.currentTarget.value) : null)
              }
            >
              <option value="">{realms.isFetching ? "Loading realms…" : "Choose a realm…"}</option>
              {realmOptions.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.label}
                </option>
              ))}
            </select>
          )}
          <button
            onClick={() => void active.refetch()}
            disabled={active.isFetching || awaitingRealm}
          >
            {active.isFetching ? "…" : "Refresh"}
          </button>
        </div>
      </div>
      <div id={panelId(base)} role="tabpanel" aria-labelledby={tabId(base, mode)}>
        {awaitingRealm ? (
          <p className="muted">Choose a realm to view its auctions.</p>
        ) : active.isError ? (
          <EmptyState message={describeError(active.error)} onRetry={() => void active.refetch()} />
        ) : active.isFetching && rows.length === 0 ? (
          <SkeletonTable rows={10} columns={4} />
        ) : rows.length === 0 ? (
          <EmptyState message="No auctions found." onRetry={() => void active.refetch()} />
        ) : (
          <>
            <p className="muted">{`${rows.length.toLocaleString()} items · ${bnet.region.toUpperCase()}`}</p>
            <div className="ah-head">
              <span>Item</span>
              <SortButton label="Listings" sortKey="listings" sort={sort} onToggle={toggleSort} />
              <SortButton label="Qty" sortKey="quantity" sort={sort} onToggle={toggleSort} />
              <SortButton label={priceLabel} sortKey="price" sort={sort} onToggle={toggleSort} />
            </div>
            {/* Focusable + named: a virtualized scroller is otherwise a keyboard dead end — there's no
                child to Tab to, so arrow-key scrolling is unreachable without a tab stop of its own. */}
            <div
              className="ah-list"
              ref={scrollRef}
              tabIndex={0}
              role="group"
              aria-label="Auction results"
            >
              <div style={{ height: virtualizer.getTotalSize(), position: "relative" }}>
                {virtualRows.map((v) => {
                  const row = sortedRows[v.index];
                  const resolved = names[row.itemId];
                  const color = resolved?.quality ? QUALITY_COLORS[resolved.quality] : undefined;
                  return (
                    <div
                      key={row.itemId}
                      className="ah-row"
                      style={{
                        position: "absolute",
                        top: 0,
                        left: 0,
                        width: "100%",
                        height: ROW_HEIGHT,
                        transform: `translateY(${v.start}px)`,
                      }}
                    >
                      <span className="ah-item" style={{ color }}>
                        {resolved?.name ?? <span className="muted">Item #{row.itemId}</span>}
                      </span>
                      <span>{row.listings.toLocaleString()}</span>
                      <span>{row.totalQuantity.toLocaleString()}</span>
                      <span>{row.minPrice === null ? "—" : formatGold(row.minPrice)}</span>
                    </div>
                  );
                })}
              </div>
            </div>
          </>
        )}
      </div>
    </section>
  );
}
