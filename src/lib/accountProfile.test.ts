import { describe, it, expect, vi } from "vitest";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));

import { invoke } from "@tauri-apps/api/core";
import {
  AccountError,
  accountProfileQuery,
  fetchAccountProfile,
  needsReconnect,
  toAccountError,
  type AccountProfile,
} from "./accountProfile";

const mockInvoke = vi.mocked(invoke);

const EMPTY: AccountProfile = { characters: [], wowAccountCount: 0 };

// Each test sets its own `invoke` implementation, so there is deliberately no `beforeEach` reset:
// clearing a mock that came from a `vi.mock` factory makes Vitest report an object thrown by a later
// implementation as an uncaught error, even though the code under test catches and converts it.
describe("fetchAccountProfile", () => {
  it("asks Rust for the index, passing the region", async () => {
    // The token never crosses into the webview, so this read goes through Rust rather than the
    // Battle.net client every other query uses.
    mockInvoke.mockResolvedValue(EMPTY);
    await fetchAccountProfile("eu");
    expect(mockInvoke).toHaveBeenCalledWith("get_account_profile", { region: "eu" });
  });

  it("turns a rejection into a typed AccountError", async () => {
    mockInvoke.mockImplementation(() => {
      throw { kind: "unauthorized", message: "Battle.net rejected it." };
    });
    const caught = await fetchAccountProfile("us").catch((e: unknown) => e);
    expect(caught).toBeInstanceOf(AccountError);
    expect(caught).toMatchObject({ kind: "unauthorized" });
  });
});

describe("toAccountError", () => {
  it("reads the kind Rust serialized", () => {
    for (const kind of ["noGrant", "expired", "unauthorized", "http", "network", "parse"]) {
      expect(toAccountError({ kind, message: "m" }).kind).toBe(kind);
    }
  });

  it("does not mistake an unrecognized failure for an auth problem", () => {
    // An IPC failure or an unregistered command must not tell the player to reconnect — that would
    // send them through a consent round trip that fixes nothing.
    for (const raw of ["boom", null, undefined, {}, { kind: "somethingElse" }, new Error("x")]) {
      const err = toAccountError(raw);
      expect(err.kind).toBe("network");
      expect(needsReconnect(err)).toBe(false);
    }
  });

  it("passes an AccountError through unchanged", () => {
    const original = new AccountError("expired", "gone");
    expect(toAccountError(original)).toBe(original);
  });
});

describe("needsReconnect", () => {
  it("is true for exactly the failures re-consenting fixes", () => {
    expect(needsReconnect(new AccountError("noGrant", ""))).toBe(true);
    expect(needsReconnect(new AccountError("expired", ""))).toBe(true);
    expect(needsReconnect(new AccountError("unauthorized", ""))).toBe(true);
  });

  it("is false for failures that have nothing to do with the connection", () => {
    expect(needsReconnect(new AccountError("http", ""))).toBe(false);
    expect(needsReconnect(new AccountError("network", ""))).toBe(false);
    expect(needsReconnect(new AccountError("parse", ""))).toBe(false);
    expect(needsReconnect(new Error("unrelated"))).toBe(false);
  });
});

describe("accountProfileQuery", () => {
  it("scopes the cache key by region", () => {
    // The grant authorizes an account, but the index is served per region host — the same connection
    // returns different rows depending on the selected region, so the caches must not collide.
    expect(accountProfileQuery("us").queryKey).toEqual(["account-profile", "us"]);
    expect(accountProfileQuery("eu").queryKey).not.toEqual(accountProfileQuery("us").queryKey);
  });

  it("holds the index long enough not to refetch per render", () => {
    expect(accountProfileQuery("us").staleTime).toBeGreaterThanOrEqual(60_000);
  });
});
