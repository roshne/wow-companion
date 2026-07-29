import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));

import { invoke } from "@tauri-apps/api/core";
import { GRANT_LIFETIME_HOURS, useAccountGrant } from "./account";

const mockInvoke = vi.mocked(invoke);

/** Route each command to a handler, so a test only states the calls it cares about. */
function routeInvoke(handlers: Record<string, () => unknown>) {
  mockInvoke.mockImplementation((cmd: string) => {
    const handler = handlers[cmd];
    if (!handler) throw new Error(`unexpected command: ${cmd}`);
    return Promise.resolve(handler());
  });
}

describe("useAccountGrant", () => {
  beforeEach(() => {
    mockInvoke.mockReset();
  });

  it("reports connected when a grant exists", async () => {
    routeInvoke({ has_account_grant: () => true });
    const { result } = renderHook(() => useAccountGrant());
    await waitFor(() => expect(result.current.state).toBe("connected"));
  });

  it("reports disconnected when none exists", async () => {
    routeInvoke({ has_account_grant: () => false });
    const { result } = renderHook(() => useAccountGrant());
    await waitFor(() => expect(result.current.state).toBe("disconnected"));
  });

  it("starts unknown rather than flashing 'not connected' before it has asked", async () => {
    routeInvoke({ has_account_grant: () => true });
    const { result } = renderHook(() => useAccountGrant());
    expect(result.current.state).toBe("unknown");
    await waitFor(() => expect(result.current.state).toBe("connected"));
  });

  it("exposes a state, never the token itself", async () => {
    // The whole point of the Rust boundary: the frontend learns *whether*, not *what*.
    routeInvoke({ has_account_grant: () => true });
    const { result } = renderHook(() => useAccountGrant());
    await waitFor(() => expect(result.current.state).toBe("connected"));
    expect(Object.keys(result.current)).toEqual([
      "state",
      "connecting",
      "error",
      "connect",
      "disconnect",
      "refresh",
      "reportRejected",
    ]);
  });

  it("moves to rejected when a read reports Battle.net refused the grant", async () => {
    // The state `has_account_grant` structurally cannot see: present and unexpired locally, revoked
    // on Blizzard's side. Only something that actually calls an account endpoint can discover it.
    routeInvoke({ has_account_grant: () => true });
    const { result } = renderHook(() => useAccountGrant());
    await waitFor(() => expect(result.current.state).toBe("connected"));

    act(() => result.current.reportRejected());
    expect(result.current.state).toBe("rejected");
  });

  it("connects and re-reads the resulting state", async () => {
    let connected = false;
    routeInvoke({
      has_account_grant: () => connected,
      begin_account_login: () => {
        connected = true;
      },
    });
    const { result } = renderHook(() => useAccountGrant());
    await waitFor(() => expect(result.current.state).toBe("disconnected"));

    await act(async () => {
      await result.current.connect();
    });
    expect(result.current.state).toBe("connected");
  });

  it("surfaces a declined consent and stays disconnected", async () => {
    routeInvoke({
      has_account_grant: () => false,
      begin_account_login: () => {
        throw "Battle.net declined the request: access_denied";
      },
    });
    const { result } = renderHook(() => useAccountGrant());
    await waitFor(() => expect(result.current.state).toBe("disconnected"));

    await act(async () => {
      await result.current.connect();
    });
    expect(result.current.error).toMatch(/access_denied/);
    expect(result.current.state).toBe("disconnected");
    expect(result.current.connecting).toBe(false);
  });

  it("re-reads state even when the attempt failed, so nothing stale survives", async () => {
    // A failed attempt after a successful one must not leave "connected" on screen.
    let connected = true;
    routeInvoke({
      has_account_grant: () => connected,
      begin_account_login: () => {
        connected = false;
        throw "Timed out waiting for Battle.net to redirect back.";
      },
    });
    const { result } = renderHook(() => useAccountGrant());
    await waitFor(() => expect(result.current.state).toBe("connected"));

    await act(async () => {
      await result.current.connect();
    });
    expect(result.current.state).toBe("disconnected");
  });

  it("disconnects through clear_account_grant and never touches the credentials", async () => {
    // The regression that would break every data tab: the two authorisations are independent.
    let connected = true;
    routeInvoke({
      has_account_grant: () => connected,
      clear_account_grant: () => {
        connected = false;
      },
    });
    const { result } = renderHook(() => useAccountGrant());
    await waitFor(() => expect(result.current.state).toBe("connected"));

    await act(async () => {
      await result.current.disconnect();
    });
    expect(result.current.state).toBe("disconnected");

    const commands = mockInvoke.mock.calls.map(([cmd]) => cmd);
    expect(commands).toContain("clear_account_grant");
    expect(commands).not.toContain("clear_credentials");
    expect(commands).not.toContain("save_credentials");
  });

  it("treats an unreadable grant as disconnected rather than stranding on unknown", async () => {
    routeInvoke({
      has_account_grant: () => {
        throw "keychain unavailable";
      },
    });
    const { result } = renderHook(() => useAccountGrant());
    await waitFor(() => expect(result.current.state).toBe("disconnected"));
  });

  it("states the grant lifetime, since a silent lapse would read as a bug", () => {
    expect(GRANT_LIFETIME_HOURS).toBe(24);
  });
});
