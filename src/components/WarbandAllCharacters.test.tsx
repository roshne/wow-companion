import { describe, it, expect, vi } from "vitest";
import { screen, fireEvent, waitFor } from "@testing-library/react";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));

import { invoke } from "@tauri-apps/api/core";
import { WarbandAllCharacters } from "./WarbandAllCharacters";
import { renderWithClient } from "../test/utils";
import type { AccountCharacter, AccountProfile } from "../lib/accountProfile";
import type { WarbandCharacter, WarbandData } from "../lib/warband";

const mockInvoke = vi.mocked(invoke);

function apiCharacter(overrides: Partial<AccountCharacter> = {}): AccountCharacter {
  return {
    name: "Nobody",
    id: 1,
    wowAccountId: 111,
    realmName: "Area 52",
    realmSlug: "area-52",
    class: "Mage",
    race: "Troll",
    faction: "Horde",
    gender: "Female",
    level: 80,
    protected: false,
    ...overrides,
  };
}

function addonCharacter(overrides: Partial<WarbandCharacter> = {}): WarbandCharacter {
  return {
    name: "Nobody",
    realm: "Area 52",
    guid: null,
    classId: null,
    classKey: null,
    className: null,
    level: null,
    itemLevel: null,
    spec: null,
    role: null,
    professionPrimary: null,
    professionSecondary: null,
    guild: null,
    faction: null,
    lastRefresh: null,
    gold: null,
    currencies: [],
    weekly: null,
    locks: [],
    titles: null,
    ...overrides,
  };
}

function warband(characters: WarbandCharacter[]): WarbandData {
  return {
    account: "TESTACCOUNT",
    source: "C:/wow/SavedVariables/Warbandeer_Characters.lua",
    characters,
    wealth: null,
    titleCatalog: null,
  };
}

/**
 * Route the mocked `invoke`. Deliberately re-assigns the implementation per test rather than
 * resetting between them — clearing a mock that came from a `vi.mock` factory makes Vitest report a
 * thrown object as an uncaught error even when the code under test catches it.
 */
function routeInvoke({
  connected = true,
  profile,
  profileError,
  onConnect,
}: {
  connected?: boolean;
  profile?: AccountProfile;
  profileError?: unknown;
  onConnect?: () => void;
} = {}) {
  mockInvoke.mockImplementation((cmd: string) => {
    if (cmd === "has_account_grant") return Promise.resolve(connected);
    if (cmd === "begin_account_login") {
      onConnect?.();
      return Promise.resolve(undefined);
    }
    if (cmd === "get_account_profile") {
      if (profileError) throw profileError;
      return Promise.resolve(profile ?? { characters: [], wowAccountCount: 0 });
    }
    return Promise.resolve(undefined);
  });
}

describe("WarbandAllCharacters", () => {
  it("prompts to connect rather than showing an error or an empty table", async () => {
    routeInvoke({ connected: false });
    renderWithClient(<WarbandAllCharacters data={null} region="us" />);

    expect(
      await screen.findByRole("button", { name: /Connect Battle.net account/ }),
    ).toBeInTheDocument();
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
  });

  it("starts the consent round trip when the connect button is used", async () => {
    const onConnect = vi.fn();
    routeInvoke({ connected: false, onConnect });
    renderWithClient(<WarbandAllCharacters data={null} region="us" />);

    fireEvent.click(await screen.findByRole("button", { name: /Connect Battle.net account/ }));
    await waitFor(() => expect(onConnect).toHaveBeenCalled());
  });

  it("renders the account's characters once connected", async () => {
    routeInvoke({
      profile: {
        characters: [
          apiCharacter({ name: "Nazu", level: 80 }),
          apiCharacter({ name: "Alt", id: 2, level: 71 }),
        ],
        wowAccountCount: 1,
      },
    });
    renderWithClient(<WarbandAllCharacters data={null} region="us" />);

    expect(await screen.findByText("Nazu")).toBeInTheDocument();
    expect(screen.getByText("Alt")).toBeInTheDocument();
  });

  it("says which rows the addon has never seen, so they don't read as neglected", async () => {
    // The reason the endpoint is worth calling at all: ~10 of 68 characters on the real account are
    // invisible to the addon. A blank item level with no explanation looks like a character nobody
    // plays rather than one the addon has never met.
    routeInvoke({
      profile: { characters: [apiCharacter({ name: "Unseen" })], wowAccountCount: 1 },
    });
    renderWithClient(<WarbandAllCharacters data={warband([])} region="us" />);

    await screen.findByText("Unseen");
    expect(screen.getByText(/not seen by the addon/)).toBeInTheDocument();
  });

  it("marks a character only the addon remembers", async () => {
    routeInvoke({ profile: { characters: [], wowAccountCount: 1 } });
    renderWithClient(
      <WarbandAllCharacters
        data={warband([addonCharacter({ name: "Ghost", realm: "Stormrage" })])}
        region="us"
      />,
    );

    await screen.findByText("Ghost");
    expect(screen.getByText(/not in the Battle.net index/)).toBeInTheDocument();
  });

  it("keeps the addon's depth on rows both sources describe", async () => {
    routeInvoke({
      profile: { characters: [apiCharacter({ name: "Nazu" })], wowAccountCount: 1 },
    });
    renderWithClient(
      <WarbandAllCharacters
        data={warband([addonCharacter({ name: "Nazu", itemLevel: 684, spec: "Frost" })])}
        region="us"
      />,
    );

    await screen.findByText("Nazu");
    expect(screen.getByText("684")).toBeInTheDocument();
    expect(screen.getByText("Frost")).toBeInTheDocument();
    // A merged row is not marked as coming from only one side.
    expect(screen.queryByText(/not seen by the addon/)).not.toBeInTheDocument();
  });

  it("summarizes what each source contributed", async () => {
    routeInvoke({
      profile: {
        characters: [apiCharacter({ name: "Deep" }), apiCharacter({ name: "Unseen", id: 2 })],
        wowAccountCount: 3,
      },
    });
    renderWithClient(
      <WarbandAllCharacters
        data={warband([addonCharacter({ name: "Deep", itemLevel: 600 })])}
        region="us"
      />,
    );

    await screen.findByText("Deep");
    expect(screen.getByText(/2 characters/)).toBeInTheDocument();
    expect(screen.getByText(/across 3 WoW accounts/)).toBeInTheDocument();
    expect(screen.getByText(/1 with addon detail/)).toBeInTheDocument();
    expect(screen.getByText(/1 the addon hasn't seen/)).toBeInTheDocument();
  });

  it("distinguishes the WoW accounts rather than flattening them into one", async () => {
    // Three WoW accounts under one Battle.net account is the real shape; a single-account warband
    // must not be the only one the view can render.
    routeInvoke({
      profile: {
        characters: [
          apiCharacter({ name: "First", wowAccountId: 111 }),
          apiCharacter({ name: "Second", id: 2, wowAccountId: 222 }),
        ],
        wowAccountCount: 2,
      },
    });
    renderWithClient(<WarbandAllCharacters data={null} region="us" />);

    await screen.findByText("First");
    expect(screen.getByText("Account 1")).toBeInTheDocument();
    expect(screen.getByText("Account 2")).toBeInTheDocument();
  });

  it("renders an empty account as an empty state that names the region", async () => {
    // Characters on another region are the likely explanation, and the fix is a setting away.
    routeInvoke({ profile: { characters: [], wowAccountCount: 1 } });
    renderWithClient(<WarbandAllCharacters data={null} region="us" />);

    expect(await screen.findByText(/no characters for this account on this region/)).toBeVisible();
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
  });

  it("treats a grant Battle.net rejected as needing reconnection, not as a failed fetch", async () => {
    // The state `has_account_grant` structurally cannot see: stored, unexpired, and revoked.
    routeInvoke({
      profileError: { kind: "unauthorized", message: "Battle.net rejected the connection." },
    });
    renderWithClient(<WarbandAllCharacters data={null} region="us" />);

    expect(await screen.findByText(/Battle.net ended this connection/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Connect Battle.net account/ })).toBeInTheDocument();
    expect(screen.queryByText(/Couldn't load your characters/)).not.toBeInTheDocument();
  });

  it("offers a retry for a failure that has nothing to do with the connection", async () => {
    routeInvoke({ profileError: { kind: "http", message: "Battle.net returned HTTP 500." } });
    renderWithClient(<WarbandAllCharacters data={null} region="us" />);

    expect(await screen.findByText(/Couldn't load your characters/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Retry" })).toBeInTheDocument();
    // Not mistaken for a dead grant — that would send the player through a pointless consent trip.
    expect(screen.queryByText(/Battle.net ended this connection/)).not.toBeInTheDocument();
  });

  it("does not ask Battle.net at all until an account is connected", async () => {
    routeInvoke({ connected: false });
    // Counted from here rather than cleared: see `routeInvoke` on why this mock isn't reset.
    const before = mockInvoke.mock.calls.length;
    renderWithClient(<WarbandAllCharacters data={null} region="us" />);

    await screen.findByRole("button", { name: /Connect Battle.net account/ });
    const commands = mockInvoke.mock.calls.slice(before).map((call) => call[0]);
    expect(commands).not.toContain("get_account_profile");
  });
});
