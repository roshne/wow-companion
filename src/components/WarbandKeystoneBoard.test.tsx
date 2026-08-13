import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, within, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

// The dungeon catalogue is the board's one API call; stub it at the query layer.
vi.mock("../lib/bnet", () => ({ makeClient: () => ({ region: "us" }) }));
vi.mock("../lib/queries", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../lib/queries")>();
  return {
    ...actual,
    keystoneDungeonsQuery: () => ({
      queryKey: ["keystone-dungeons", "us"],
      queryFn: () => Promise.resolve(dungeonCatalogue),
    }),
    currentAffixesQuery: () => ({
      queryKey: ["current-affixes", "us"],
      queryFn: () => Promise.resolve(affixRotation),
    }),
  };
});

import { WarbandKeystoneBoard } from "./WarbandKeystoneBoard";
import type { InstanceLock, WarbandCharacter, WarbandData } from "../lib/warband";
import type { KeystoneDungeon } from "../lib/queries";
import type { AffixEntry } from "../lib/affixes";

const WEEK_START = 1785164400;
let dungeonCatalogue: KeystoneDungeon[] = [];
let affixRotation: AffixEntry[] = [];

function renderBoard(data: WarbandData | null) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <WarbandKeystoneBoard data={data} region="us" />
    </QueryClientProvider>,
  );
}

function character(overrides: Partial<WarbandCharacter> = {}): WarbandCharacter {
  return {
    name: "Nobody",
    realm: "Testrealm",
    guid: null,
    classId: null,
    classKey: null,
    className: null,
    level: 90,
    itemLevel: null,
    spec: null,
    role: null,
    professionPrimary: null,
    professionSecondary: null,
    guild: null,
    faction: null,
    lastRefresh: WEEK_START + 100,
    gold: null,
    currencies: [],
    weekly: {
      vault: null,
      hasUnclaimedVault: null,
      keystoneLevel: 12,
      keystoneMap: 507,
      dungeonsDone: 5,
      dungeonsMax: 8,
    },
    locks: [],
    titles: null,
    mail: null,
    auctions: null,
    ...overrides,
  };
}

function data(characters: WarbandCharacter[]): WarbandData {
  return {
    account: "TESTACCOUNT",
    source: "C:/wow/Warbandeer_Characters.lua",
    characters,
    titleCatalog: null,
    wealth: {
      bankGold: null,
      week: { start: WEEK_START, baseline: null, ending: null, made: null },
      history: [],
    },
  };
}

describe("WarbandKeystoneBoard", () => {
  beforeEach(() => {
    dungeonCatalogue = [{ id: 507, name: "Altar of Fangs" }];
    affixRotation = [];
  });

  it("names the keystone's dungeon once the catalogue resolves", async () => {
    renderBoard(data([character({ name: "Keyholder" })]));
    expect(await screen.findByText("Altar of Fangs")).toBeInTheDocument();
    expect(screen.getByText("+12")).toBeInTheDocument();
    expect(screen.getByText("1 keystone held")).toBeInTheDocument();
  });

  it("falls back to the raw dungeon id when the catalogue doesn't know it", async () => {
    // What a new season's dungeon looks like before the cached index catches up.
    dungeonCatalogue = [{ id: 503, name: "Somewhere Else" }];
    renderBoard(data([character({ name: "Keyholder" })]));
    expect(await screen.findByText("Dungeon 507")).toBeInTheDocument();
  });

  it("still shows the keystone when the catalogue fails to load", async () => {
    dungeonCatalogue = [];
    renderBoard(data([character({ name: "Keyholder" })]));
    // Enrichment is best-effort — losing it must not cost the row.
    await waitFor(() => expect(screen.getByText("+12")).toBeInTheDocument());
    expect(screen.getByText("Keyholder")).toBeInTheDocument();
  });

  it("shows the week's Mythic+ count against its threshold", async () => {
    renderBoard(data([character({ name: "Runner" })]));
    const row = (await screen.findByText("Runner")).closest("tr")!;
    expect(within(row).getByText("5 / 8")).toBeInTheDocument();
  });

  it("lists lockouts with difficulty and progress", async () => {
    const lock: InstanceLock = {
      instanceId: 2810,
      difficultyId: 16,
      name: "Venomous Abyss",
      progress: 3,
      total: 8,
      reset: null,
      extended: null,
      isRaid: true,
    };
    renderBoard(data([character({ name: "Raider", weekly: null, locks: [lock] })]));
    const row = (await screen.findByText("Raider")).closest("tr")!;
    expect(within(row).getByText(/Venomous Abyss/)).toBeInTheDocument();
    expect(within(row).getByText(/M 3\/8/)).toBeInTheDocument();
  });

  it("marks a row whose key predates the reset", async () => {
    renderBoard(data([character({ name: "Away", lastRefresh: WEEK_START - 500 })]));
    expect(await screen.findByText(/not seen this week/)).toBeInTheDocument();
  });

  it("says so when nothing is recorded", () => {
    renderBoard(data([character({ name: "Idle", weekly: null })]));
    expect(screen.getByText(/No keystones or lockouts recorded this week/)).toBeInTheDocument();
  });

  it("shows the week's affix rotation when it resolves", async () => {
    affixRotation = [
      { id: 10, name: "Fortified", startingLevel: 2 },
      { id: 9, name: "Tyrannical", startingLevel: 7 },
    ];
    renderBoard(data([character({ name: "Keyholder" })]));
    expect(await screen.findByText("Fortified · Tyrannical")).toBeInTheDocument();
  });

  it("renders the board unchanged when the affix chain yields nothing", async () => {
    affixRotation = [];
    renderBoard(data([character({ name: "Keyholder" })]));
    // The affix line is decoration — its absence must not touch the board itself.
    expect(await screen.findByText("Altar of Fangs")).toBeInTheDocument();
    expect(screen.getByText("+12")).toBeInTheDocument();
    expect(screen.queryByText(/Affixes this week/)).not.toBeInTheDocument();
  });
});
