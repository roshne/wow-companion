import { useDeferredValue, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useVirtualizer } from "@tanstack/react-virtual";
import type { BlizzardClient } from "../vendor/battlenet-wow-client";
import { characterAchievementsQuery, describeError } from "../lib/queries";
import { summarizeAchievements, filterAchievements } from "../lib/achievements";
import { SkeletonLines } from "./Skeleton";
import { EmptyState } from "./EmptyState";

/** Row height for the virtualized list (must match the `.ach-row` CSS). */
const ROW_HEIGHT = 32;

/**
 * The Achievements sub-tab: the character's aggregate totals plus a browsable, name-filterable list of
 * every earned achievement — beyond the Overview's summary point count. The list can run to thousands
 * of rows, so it's virtualized (only the on-screen rows mount); the totals + filter come from the pure
 * {@link summarizeAchievements} / {@link filterAchievements} helpers. Lazily fetched on select.
 */
export function Achievements({
  bnet,
  realmSlug,
  characterName,
}: {
  bnet: BlizzardClient;
  realmSlug: string;
  characterName: string;
}) {
  const { data, isPending, isError, error, refetch } = useQuery(
    characterAchievementsQuery(bnet, realmSlug, characterName),
  );
  const [query, setQuery] = useState("");
  const scrollRef = useRef<HTMLDivElement>(null);

  // The input stays fully controlled by `query` (so typing never lags), while the list re-filters from
  // the deferred copy — React can keep the old list on screen for a frame instead of blocking the
  // keystroke on a scan of several thousand achievements.
  const deferredQuery = useDeferredValue(query);

  const summary = useMemo(() => (data ? summarizeAchievements(data) : null), [data]);
  const filtered = useMemo(
    () => (summary ? filterAchievements(summary.earned, deferredQuery) : []),
    [summary, deferredQuery],
  );

  const virtualizer = useVirtualizer({
    count: filtered.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => ROW_HEIGHT,
    overscan: 12,
  });

  if (isError) return <EmptyState message={describeError(error)} onRetry={() => void refetch()} />;
  if (isPending || !data || !summary) return <SkeletonLines lines={4} />;
  if (summary.earned.length === 0) return <EmptyState message="No achievements." />;

  return (
    <>
      <dl className="stats">
        <div>
          <dt>Earned</dt>
          <dd>{summary.totalQuantity.toLocaleString()}</dd>
        </div>
        <div>
          <dt>Points</dt>
          <dd>{summary.totalPoints.toLocaleString()}</dd>
        </div>
      </dl>
      <input
        type="search"
        className="ach-filter"
        placeholder="Filter achievements…"
        aria-label="Filter achievements"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
      />
      {filtered.length === 0 ? (
        <p className="muted">No matches.</p>
      ) : (
        // Focusable + named: a virtualized scroller has no child to Tab to, so without its own tab
        // stop a keyboard user can't scroll the list at all.
        <div
          className="ach-list"
          ref={scrollRef}
          tabIndex={0}
          role="group"
          aria-label="Earned achievements"
        >
          <div style={{ height: virtualizer.getTotalSize(), position: "relative" }}>
            {virtualizer.getVirtualItems().map((v) => {
              const a = filtered[v.index];
              return (
                <div
                  key={a.id}
                  className="ach-row"
                  style={{
                    position: "absolute",
                    top: 0,
                    left: 0,
                    width: "100%",
                    height: ROW_HEIGHT,
                    transform: `translateY(${v.start}px)`,
                  }}
                >
                  {a.name}
                </div>
              );
            })}
          </div>
        </div>
      )}
    </>
  );
}
