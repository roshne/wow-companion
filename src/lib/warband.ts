import { queryOptions } from "@tanstack/react-query";
import { invoke } from "@tauri-apps/api/core";

/** One character from the Warbandeer addon export (via the `get_warband` Rust command). */
export interface WarbandCharacter {
  name: string;
  realm: string;
  guid: string | null;
  classId: number | null;
  classKey: string | null;
  className: string | null;
  level: number | null;
  itemLevel: number | null;
  spec: string | null;
  role: string | null;
  professionPrimary: string | null;
  professionSecondary: string | null;
  guild: string | null;
  faction: string | null;
}

/** The full warband export: account label, source path, and the character list. */
export interface WarbandData {
  account: string;
  source: string;
  characters: WarbandCharacter[];
}

/**
 * Read the local Warbandeer export via the Rust `get_warband` command. Region-agnostic (the export
 * has no region), so a single cache key. `retry: false` — a missing addon/file is a definitive result,
 * not a transient error to back off on.
 */
export const warbandQuery = () =>
  queryOptions({
    queryKey: ["warband"] as const,
    queryFn: () => invoke<WarbandData>("get_warband"),
    retry: false,
    staleTime: 5 * 60_000,
  });
