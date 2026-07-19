import { useEffect, useRef, useState } from "react";
import type { BlizzardClient } from "../vendor/battlenet-wow-client";
import { fetchItemMedia } from "./queries";
import { loadItemIcons, mergeItemIcons } from "./persist";

/**
 * Resolve item icon URLs for the *given* ids only — the paper doll passes just its equipped items
 * (~16), so a character never resolves more than the handful actually worn.
 *
 * Two layers keep it cheap (mirrors `useItemNames`):
 *  - A persistent, indefinite cache (`persist`): seeded on mount and written back after each batch, so
 *    a remount, tab switch, or app restart reuses every icon already known (item media is en_US and
 *    region-independent, so one global cache is correct).
 *  - An in-session `requested` ref: every id fetched (or attempted) is recorded, so an id is requested
 *    at most once even as the doll remounts across characters — this is the in-flight dedup. A failed
 *    resolve stays recorded and isn't retried this session.
 *
 * Returns the resolved map; look up by numeric id (`resolved[itemId]`), `undefined` while unresolved.
 */
export function useItemIcons(bnet: BlizzardClient, ids: number[]): Record<number, string> {
  const [resolved, setResolved] = useState<Record<number, string>>(loadItemIcons);
  const requested = useRef<Set<number>>(new Set());

  // A stable, order-independent signature of the requested ids, so the effect re-runs only when the
  // *set* of ids changes — not on every parent re-render.
  const idKey = [...new Set(ids)].sort((a, b) => a - b).join(",");

  useEffect(() => {
    const missing = (idKey === "" ? [] : idKey.split(",").map(Number)).filter(
      (id) => resolved[id] === undefined && !requested.current.has(id),
    );
    if (missing.length === 0) return;
    for (const id of missing) requested.current.add(id);

    void Promise.all(
      missing.map(async (id) => [id, await fetchItemMedia(bnet, id).catch(() => null)] as const),
    ).then((results) => {
      const fresh: Record<number, string> = {};
      for (const [id, url] of results) if (url) fresh[id] = url;
      // Persist and re-render only when something actually resolved (skip a batch of pure failures).
      if (Object.keys(fresh).length > 0) setResolved(mergeItemIcons(fresh));
    });
  }, [idKey, resolved, bnet]);

  return resolved;
}
