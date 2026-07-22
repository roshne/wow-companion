import { describe, it, expect } from "vitest";
import { screen, fireEvent, waitFor, within } from "@testing-library/react";
import { GuildDetail } from "./GuildDetail";
import { renderWithClient } from "../test/utils";
import { mockBnet, mockResponse } from "../test/mocks";
import { CLASS_COLORS } from "../lib/wow";

const ROSTER_PATH = "/data/wow/guild/{realmSlug}/{nameSlug}/roster";
const ACHIEVEMENTS_PATH = "/data/wow/guild/{realmSlug}/{nameSlug}/achievements";
const ACTIVITY_PATH = "/data/wow/guild/{realmSlug}/{nameSlug}/activity";

interface Member {
  character?: {
    id?: number;
    name?: string;
    level?: number;
    playable_class?: { id?: number };
    playable_race?: { id?: number };
    realm?: { slug?: string };
  };
  rank?: number;
}

/** Route `api.GET` by path to the given per-endpoint payloads. */
function routeGuild(
  get: ReturnType<typeof mockBnet>["get"],
  opts: { roster?: Member[]; achievements?: unknown; activity?: unknown },
) {
  get.mockImplementation((path: string) => {
    if (path === ROSTER_PATH) {
      return Promise.resolve({
        data: { members: opts.roster ?? [] },
        response: mockResponse(200),
      });
    }
    if (path === ACHIEVEMENTS_PATH) {
      return Promise.resolve({ data: opts.achievements ?? {}, response: mockResponse(200) });
    }
    if (path === ACTIVITY_PATH) {
      return Promise.resolve({ data: opts.activity ?? {}, response: mockResponse(200) });
    }
    return Promise.resolve({ data: {}, response: mockResponse(200) });
  });
}

const ROSTER: Member[] = [
  {
    character: {
      id: 1,
      name: "Maximum",
      level: 80,
      playable_class: { id: 6 }, // Death Knight
      playable_race: { id: 5 }, // Undead
      realm: { slug: "illidan" },
    },
    rank: 0,
  },
  {
    character: {
      id: 2,
      name: "Adam",
      level: 70,
      playable_class: { id: 8 }, // Mage
      playable_race: { id: 1 }, // Human
      realm: { slug: "illidan" },
    },
    rank: 3,
  },
];

function bodyRowNames(): string[] {
  const rows = document.querySelectorAll("tbody tr");
  return Array.from(rows).map((r) => r.querySelector("td")?.textContent ?? "");
}

describe("GuildDetail — Roster", () => {
  it("renders members with class colour, race/class names, and GM rank", async () => {
    const { bnet, get } = mockBnet();
    routeGuild(get, { roster: ROSTER });
    renderWithClient(<GuildDetail bnet={bnet} realmSlug="illidan" nameSlug="complexity-limit" />);

    await screen.findByText("Maximum");
    const nameCell = screen.getByText("Maximum");
    expect(nameCell).toHaveStyle({ color: CLASS_COLORS.DeathKnight });
    expect(screen.getByText("Death Knight")).toBeInTheDocument();
    expect(screen.getByText("Undead")).toBeInTheDocument();
    // Rank 0 renders as GM; a non-zero rank renders as "Rank N".
    expect(screen.getByText("GM")).toBeInTheDocument();
    expect(screen.getByText("Rank 3")).toBeInTheDocument();
    expect(screen.getByText("2 members")).toBeInTheDocument();
  });

  it("defaults to rank ascending (GM first) and re-sorts by name when the header is clicked", async () => {
    const { bnet, get } = mockBnet();
    routeGuild(get, { roster: ROSTER });
    renderWithClient(<GuildDetail bnet={bnet} realmSlug="illidan" nameSlug="complexity-limit" />);

    await screen.findByText("Maximum");
    // Default: rank asc → Maximum (0) before Adam (3).
    expect(bodyRowNames()).toEqual(["Maximum", "Adam"]);

    fireEvent.click(screen.getByRole("columnheader", { name: /Name/ }));
    // Name asc → Adam before Maximum.
    await waitFor(() => expect(bodyRowNames()).toEqual(["Adam", "Maximum"]));

    fireEvent.click(screen.getByRole("columnheader", { name: /Name/ }));
    // Toggled to desc → Maximum before Adam.
    await waitFor(() => expect(bodyRowNames()).toEqual(["Maximum", "Adam"]));
  });

  it("caps a large roster and reveals the rest on demand", async () => {
    const many: Member[] = Array.from({ length: 150 }, (_, i) => ({
      character: {
        id: i,
        name: `Char${String(i).padStart(3, "0")}`,
        level: 70,
        playable_class: { id: 1 },
        playable_race: { id: 1 },
        realm: { slug: "illidan" },
      },
      rank: 5,
    }));
    const { bnet, get } = mockBnet();
    routeGuild(get, { roster: many });
    renderWithClient(<GuildDetail bnet={bnet} realmSlug="illidan" nameSlug="complexity-limit" />);

    await screen.findByText("Showing 100 of 150 members");
    expect(document.querySelectorAll("tbody tr")).toHaveLength(100);

    fireEvent.click(screen.getByRole("button", { name: "Show all 150 members" }));
    await screen.findByText("150 members");
    expect(document.querySelectorAll("tbody tr")).toHaveLength(150);
  });

  it("shows an empty-state when the roster has no members", async () => {
    const { bnet, get } = mockBnet();
    routeGuild(get, { roster: [] });
    renderWithClient(<GuildDetail bnet={bnet} realmSlug="illidan" nameSlug="complexity-limit" />);

    await screen.findByText("No members.");
  });
});

describe("GuildDetail — lazy sub-tabs", () => {
  it("fetches achievements only after the Achievements tab is selected", async () => {
    const { bnet, get } = mockBnet();
    routeGuild(get, {
      roster: ROSTER,
      achievements: { total_quantity: 500, total_points: 3000, recent_events: [] },
    });
    renderWithClient(<GuildDetail bnet={bnet} realmSlug="illidan" nameSlug="complexity-limit" />);

    await screen.findByText("Maximum");
    expect(get).not.toHaveBeenCalledWith(ACHIEVEMENTS_PATH, expect.anything());

    fireEvent.click(screen.getByRole("tab", { name: "Achievements" }));
    await waitFor(() => expect(get).toHaveBeenCalledWith(ACHIEVEMENTS_PATH, expect.anything()));
    expect(await screen.findByText("3,000")).toBeInTheDocument();
  });

  it("fetches activity only after the Activity tab is selected", async () => {
    const { bnet, get } = mockBnet();
    routeGuild(get, {
      roster: ROSTER,
      activity: {
        activities: [
          {
            character_achievement: {
              character: { name: "Maximum" },
              achievement: { name: "Cutting Edge" },
            },
            timestamp: 0,
          },
        ],
      },
    });
    renderWithClient(<GuildDetail bnet={bnet} realmSlug="illidan" nameSlug="complexity-limit" />);

    await screen.findByText("Maximum");
    expect(get).not.toHaveBeenCalledWith(ACTIVITY_PATH, expect.anything());

    fireEvent.click(screen.getByRole("tab", { name: "Activity" }));
    await waitFor(() => expect(get).toHaveBeenCalledWith(ACTIVITY_PATH, expect.anything()));
    const list = await screen.findByRole("list");
    expect(within(list).getByText(/Cutting Edge/)).toBeInTheDocument();
  });
});
