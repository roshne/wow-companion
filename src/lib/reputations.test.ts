import { describe, it, expect } from "vitest";
import type { CharacterReputations } from "./queries";
import { reputationRows } from "./reputations";

const doc = (v: unknown): CharacterReputations => v as CharacterReputations;

describe("reputationRows", () => {
  it("distills a faction into name, standing name, and localized value/max progress", () => {
    const rows = reputationRows(
      doc({
        reputations: [
          {
            faction: { id: 2510, name: "Valdrakken Accord" },
            standing: { name: "Exalted", value: 2400, max: 3000, tier: 8 },
          },
        ],
      }),
    );
    expect(rows).toEqual([
      { factionName: "Valdrakken Accord", standing: "Exalted", progress: "2,400 / 3,000" },
    ]);
  });

  it("falls back to a 'Renown N' standing when there is a renown level but no standing name", () => {
    const rows = reputationRows(
      doc({
        reputations: [
          {
            faction: { name: "Dream Wardens" },
            standing: { renown_level: 20, value: 0, max: 2500 },
          },
        ],
      }),
    );
    expect(rows[0].standing).toBe("Renown 20");
    expect(rows[0].progress).toBe("0 / 2,500");
  });

  it("drops factions with no name, and shows '—' when progress is unavailable", () => {
    const rows = reputationRows(
      doc({
        reputations: [
          { standing: { name: "Honored" } }, // no faction name → dropped
          { faction: { name: "The Enlightened" }, standing: { name: "Revered" } }, // no value/max
        ],
      }),
    );
    expect(rows).toEqual([{ factionName: "The Enlightened", standing: "Revered", progress: "—" }]);
  });

  it("shows '—' standing when neither a name nor a renown level is present", () => {
    const rows = reputationRows(
      doc({ reputations: [{ faction: { name: "Nameless Standing" }, standing: {} }] }),
    );
    expect(rows[0].standing).toBe("—");
  });

  it("returns an empty list for a document with no reputations", () => {
    expect(reputationRows(doc({}))).toEqual([]);
    expect(reputationRows(doc({ reputations: [] }))).toEqual([]);
  });
});
