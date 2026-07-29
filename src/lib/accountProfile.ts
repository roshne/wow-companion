// The account's own character index — the frontend half of `get_account_profile`.
//
// Unlike every other read in the app, this one does not go through `makeClient`: it needs the user's
// own token, and that token is deliberately unreachable from the webview (see `account.ts` and
// `src-tauri/src/account_profile.rs`). So the query calls into Rust and receives shaped rows.
//
// The interfaces here mirror the Rust structs field for field. They're hand-written rather than
// derived from the vendored OpenAPI types because the vendored spec carries no 200 body for
// `/profile/user/wow` — Blizzard's portal only renders one after an authenticated live call.

import { queryOptions } from "@tanstack/react-query";
import { invoke } from "@tauri-apps/api/core";
import type { Region } from "../vendor/battlenet-wow-client";
import { queryKeys } from "./queries";

const MINUTE = 60 * 1000;

/**
 * Why an account read didn't produce data.
 *
 * The kinds that matter to a caller are the first three: they all mean "there is no working
 * connection", and all recover the same way — consent again. `unauthorized` is specifically the case
 * `has_account_grant` cannot see, because the grant is present and unexpired locally and only
 * Battle.net knows it has been revoked.
 */
export type AccountErrorKind =
  "noGrant" | "expired" | "unauthorized" | "http" | "network" | "parse";

/** A failed account read, carrying the kind so callers route on a value rather than on prose. */
export class AccountError extends Error {
  constructor(
    readonly kind: AccountErrorKind,
    message: string,
  ) {
    super(message);
    this.name = "AccountError";
  }
}

const KINDS: AccountErrorKind[] = [
  "noGrant",
  "expired",
  "unauthorized",
  "http",
  "network",
  "parse",
];

/**
 * Normalize whatever `invoke` rejected with into an `AccountError`.
 *
 * Tauri serializes the Rust error struct, so the happy path is a `{ kind, message }` object. Anything
 * else — an IPC failure, a command that isn't registered — becomes a `network` error rather than
 * being mistaken for an auth problem, which would wrongly tell the user to reconnect.
 */
export function toAccountError(raw: unknown): AccountError {
  if (raw instanceof AccountError) return raw;
  if (typeof raw === "object" && raw !== null && "kind" in raw) {
    const { kind, message } = raw as { kind: unknown; message?: unknown };
    if (typeof kind === "string" && (KINDS as string[]).includes(kind)) {
      return new AccountError(kind as AccountErrorKind, String(message ?? kind));
    }
  }
  return new AccountError("network", String(raw));
}

/** Whether an error means the connection itself is gone, and re-consenting is the only fix. */
export function needsReconnect(error: unknown): boolean {
  return (
    error instanceof AccountError &&
    (error.kind === "noGrant" || error.kind === "expired" || error.kind === "unauthorized")
  );
}

/**
 * One character as Battle.net knows it. Shallow by design: who and where, never what they've done —
 * no gold, vault, lockouts or currencies. Those only exist in the addon's records.
 */
export interface AccountCharacter {
  name: string;
  id: number;
  /** Which WoW account under the Battle.net account this character belongs to. */
  wowAccountId: number;
  realmName: string;
  realmSlug: string;
  class: string | null;
  race: string | null;
  faction: string | null;
  gender: string | null;
  level: number | null;
  /** The entry carried a `protected_character` link. Recorded, not yet acted on. */
  protected: boolean;
}

export interface AccountProfile {
  characters: AccountCharacter[];
  /** How many WoW accounts the index reported, including any holding no characters. */
  wowAccountCount: number;
}

/** Fetch the account's character index for a region, normalizing any rejection. */
export async function fetchAccountProfile(region: Region): Promise<AccountProfile> {
  try {
    return await invoke<AccountProfile>("get_account_profile", { region });
  } catch (raw) {
    throw toAccountError(raw);
  }
}

/**
 * The account's character index, region-scoped like every other key.
 *
 * The region matters more here than elsewhere: the grant authorizes a Battle.net account, but the
 * index is served per region host, so the same connection returns different rows — possibly none —
 * depending on which region is selected.
 */
export const accountProfileQuery = (region: Region) =>
  queryOptions({
    queryKey: queryKeys.accountProfile(region),
    queryFn: () => fetchAccountProfile(region),
    staleTime: 5 * MINUTE,
  });
