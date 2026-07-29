import { useCallback, useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";

/**
 * How long a Battle.net account grant lasts.
 *
 * Blizzard issues **no refresh token** — an access token lives 24 hours and the documented recovery
 * is to request a new one. Surfaced in the UI because otherwise a connection that silently lapses
 * overnight reads as a bug rather than as the documented behaviour.
 */
export const GRANT_LIFETIME_HOURS = 24;

/**
 * Whether an account is connected.
 *
 * `unknown` is the pre-first-answer state, kept distinct from `disconnected` so the UI doesn't flash
 * "not connected" before it has actually asked.
 *
 * `rejected` is the state `has_account_grant` structurally cannot see: a grant that is present and
 * unexpired locally, but which Battle.net has revoked on their side. It only became producible once
 * something actually called an account endpoint — until then it would have been untestable
 * decoration. It is distinct from `disconnected` because it needs a different sentence: nothing the
 * player did ended this connection.
 */
export type AccountState = "unknown" | "connected" | "disconnected" | "rejected";

export interface AccountGrant {
  state: AccountState;
  /** A consent round trip is in flight — the browser is open and waiting on the player. */
  connecting: boolean;
  /** Why the last attempt didn't connect. Empty when there's nothing to report. */
  error: string;
  connect: () => Promise<void>;
  disconnect: () => Promise<void>;
  refresh: () => Promise<void>;
  /**
   * Record that Battle.net rejected the grant we hold. Called by whatever read got the rejection —
   * the auth layer can't discover this on its own.
   */
  reportRejected: () => void;
}

/**
 * The account-wide grant's state, and the two actions that change it.
 *
 * Deliberately exposes a **state, not a credential**: the only thing crossing from Rust is
 * `has_account_grant`'s boolean. The token itself is read only in Rust, the same rule the client
 * secret has always followed.
 *
 * This grant is independent of the client credentials every data tab uses. Connecting or
 * disconnecting an account must never disturb those.
 */
export function useAccountGrant(): AccountGrant {
  const [state, setState] = useState<AccountState>("unknown");
  const [connecting, setConnecting] = useState(false);
  const [error, setError] = useState("");

  const refresh = useCallback(async () => {
    try {
      const connected = await invoke<boolean>("has_account_grant");
      setState(connected ? "connected" : "disconnected");
    } catch {
      // Failing to read the grant is not the same as not having one, but there's nothing usable
      // either way — report disconnected rather than stranding the UI on `unknown`.
      setState("disconnected");
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const connect = useCallback(async () => {
    setConnecting(true);
    setError("");
    try {
      // Resolves only once the browser round trip finishes, so `connecting` covers the whole wait.
      await invoke("begin_account_login");
    } catch (e) {
      setError(String(e));
    } finally {
      setConnecting(false);
      // Re-read either way: a failed attempt must not leave a stale "connected" on screen.
      await refresh();
    }
  }, [refresh]);

  const disconnect = useCallback(async () => {
    setError("");
    try {
      await invoke("clear_account_grant");
    } catch (e) {
      setError(String(e));
    } finally {
      await refresh();
    }
  }, [refresh]);

  // Rust already deletes a grant Battle.net rejected, so this doesn't clear anything — it moves the
  // UI to the state that says so, instead of leaving a stale "connected" on screen until something
  // else happens to re-read it.
  const reportRejected = useCallback(() => setState("rejected"), []);

  return { state, connecting, error, connect, disconnect, refresh, reportRejected };
}
