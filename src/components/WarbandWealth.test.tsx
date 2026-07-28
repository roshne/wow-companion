import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

// The token price is this component's only network read; stub it at the query layer.
vi.mock("../lib/bnet", () => ({ makeClient: () => ({ region: "us" }) }));
vi.mock("../lib/queries", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../lib/queries")>();
  return {
    ...actual,
    tokenQuery: () => ({
      queryKey: ["token", "us"],
      queryFn: () =>
        tokenPrice === "fail"
          ? Promise.reject(new Error("boom"))
          : Promise.resolve({ price: tokenPrice }),
    }),
  };
});

import { WarbandWealth } from "./WarbandWealth";
import type { WarbandCharacter, WarbandData } from "../lib/warband";

const G = 10_000;
let tokenPrice: number | null | "fail" = 250_000 * G;

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
    lastRefresh: null,
    gold: null,
    currencies: [],
    weekly: null,
    locks: [],
    ...overrides,
  };
}

function data(
  characters: WarbandCharacter[],
  wealth: WarbandData["wealth"] = { bankGold: null, week: null, history: [] },
): WarbandData {
  return {
    account: "TESTACCOUNT",
    source: "C:/wow/Warbandeer_Characters.lua",
    characters,
    wealth,
  };
}

function renderWealth(d: WarbandData | null) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <WarbandWealth data={d} region="us" />
    </QueryClientProvider>,
  );
}

describe("WarbandWealth", () => {
  beforeEach(() => {
    tokenPrice = 250_000 * G;
  });

  it("shows the total and what it buys in tokens", async () => {
    renderWealth(
      data([character({ gold: 400_000 * G }), character({ gold: 100_000 * G })], {
        bankGold: 0,
        week: null,
        history: [],
      }),
    );
    expect(screen.getByText("500,000 g")).toBeInTheDocument();
    // 500,000g against a 250,000g token.
    expect(await screen.findByText(/2 tokens/)).toBeInTheDocument();
    // 2 tokens is 60 days, which reads better as months — and a token count and a month count are
    // the same figure, so this is the translation of the number rather than a second metric.
    expect(screen.getByText(/2 months of game time/)).toBeInTheDocument();
  });

  it("uses days for a single token, where months would read oddly", async () => {
    tokenPrice = 100_000 * G;
    renderWealth(data([character({ gold: 100_000 * G })]));
    expect(await screen.findByText(/30 days of game time/)).toBeInTheDocument();
  });

  it("still shows the gold when the token price fails to load", async () => {
    // The local figure must never depend on the network.
    tokenPrice = "fail";
    renderWealth(data([character({ gold: 123_000 * G })]));
    expect(screen.getByText("123,000 g")).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByText(/tokens/)).not.toBeInTheDocument());
  });

  it("omits the conversion rather than dividing by zero", async () => {
    tokenPrice = 0;
    renderWealth(data([character({ gold: 5_000 * G })]));
    expect(screen.getByText("5,000 g")).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByText(/Infinity/)).not.toBeInTheDocument());
    expect(screen.queryByText(/tokens/)).not.toBeInTheDocument();
  });

  it("shows a gaining week as a gain", async () => {
    renderWealth(
      data([character({ gold: 150_000 * G })], {
        bankGold: 0,
        week: { start: null, baseline: 100_000 * G, ending: null, made: null },
        history: [],
      }),
    );
    const change = screen.getByText("+50,000 g");
    expect(change).toHaveClass("wealth-up");
  });

  it("shows a losing week as a loss, not a smaller number", async () => {
    renderWealth(
      data([character({ gold: 80_000 * G })], {
        bankGold: 0,
        week: { start: null, baseline: 100_000 * G, ending: null, made: null },
        history: [],
      }),
    );
    const change = screen.getByText("−20,000 g");
    expect(change).toHaveClass("wealth-down");
  });

  it("renders a flat week neutrally rather than as a gain", () => {
    // The live history contains a week with made = 0; "+0 g" in gain-green reads as a bug.
    renderWealth(
      data([character({ gold: 100_000 * G })], {
        bankGold: 0,
        week: { start: null, baseline: 100_000 * G, ending: null, made: null },
        history: [],
      }),
    );
    const change = screen.getByText("0 g");
    expect(change).not.toHaveClass("wealth-up");
    expect(change).not.toHaveClass("wealth-down");
  });

  it("treats a sub-gold change as flat, so the sign agrees with the number shown", () => {
    // 5,000 copper is half a gold: it rounds to 0, and "+0 g" would contradict itself.
    renderWealth(
      data([character({ gold: 100_000 * G + 5_000 })], {
        bankGold: 0,
        week: { start: null, baseline: 100_000 * G, ending: null, made: null },
        history: [],
      }),
    );
    const change = screen.getByText("0 g");
    expect(change).not.toHaveClass("wealth-up");
  });

  it("lists the most recent closed weeks, newest first", () => {
    renderWealth(
      data([character({ gold: 1_000 * G })], {
        bankGold: 0,
        week: null,
        history: [
          { start: null, baseline: null, ending: null, made: 1_000 * G },
          { start: null, baseline: null, ending: null, made: -2_000 * G },
          { start: null, baseline: null, ending: null, made: 3_000 * G },
        ],
      }),
    );
    expect(screen.getByText(/previous: \+3,000 g, −2,000 g, \+1,000 g/)).toBeInTheDocument();
  });

  it("renders nothing when no wealth was recorded", () => {
    // It sits above every Warband view, so an empty placeholder here would just be noise.
    const { container } = renderWealth(data([character({ gold: null })], null));
    expect(container).toBeEmptyDOMElement();
  });

  it("treats a recorded zero balance as a real answer", () => {
    renderWealth(data([character({ gold: 0 })], null));
    expect(screen.getByText("0 g")).toBeInTheDocument();
  });
});
