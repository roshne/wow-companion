import { useEffect, useRef, useState } from "react";
import type { BlizzardClient } from "../vendor/battlenet-wow-client";
import { fetchItemName } from "./queries";
import { loadItemNames, mergeItemNames, type ResolvedItem } from "./persist";

/**
 * Resolve item names for the *given* ids only — the auction browser passes just its current viewport,
 * so a snapshot with tens of thousands of distinct items only ever resolves the handful on screen.
 *
 * Two layers keep it cheap:
 *  - A persistent, indefinite cache (`persist`): seeded on mount and written back after each batch, so
 *    a scroll-back, remount, or region switch reuses every name already known (item names are en_US
 *    and region-independent, so one global cache is correct).
 *  - An in-session `requested` ref: every id fetched (or attempted) is recorded, so an id is requested
 *    at most once even as the viewport shifts and the same id reappears across renders — this is the
 *    in-flight dedup. A failed resolve stays recorded and isn't retried this session.
 *
 * Returns the resolved map; look up by numeric id (`resolved[itemId]`), `undefined` while unresolved.
 */
export function useItemNames(bnet: BlizzardClient, ids: number[]): Record<number, ResolvedItem> {
  const [resolved, setResolved] = useState<Record<number, ResolvedItem>>(loadItemNames);
  const requested = useRef<Set<number>>(new Set());

  // A stable, order-independent signature of the requested ids, so the effect re-runs only when the
  // *set* of visible ids changes — not on every parent (scroll) render.
  const idKey = [...new Set(ids)].sort((a, b) => a - b).join(",");

  useEffect(() => {
    const missing = (idKey === "" ? [] : idKey.split(",").map(Number)).filter(
      (id) => resolved[id] === undefined && !requested.current.has(id),
    );
    if (missing.length === 0) return;
    for (const id of missing) requested.current.add(id);

    void Promise.all(
      missing.map(async (id) => [id, await fetchItemName(bnet, id).catch(() => null)] as const),
    ).then((results) => {
      const fresh: Record<number, ResolvedItem> = {};
      for (const [id, item] of results) if (item) fresh[id] = item;
      // Persist and re-render only when something actually resolved (skip a batch of pure failures).
      if (Object.keys(fresh).length > 0) setResolved(mergeItemNames(fresh));
    });
  }, [idKey, resolved, bnet]);

  return resolved;
}
