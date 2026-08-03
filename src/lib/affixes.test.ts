import { describe, it, expect } from "vitest";
import { resolveAffixRotation, resolveCurrentPeriodId } from "./affixes";

describe("resolveCurrentPeriodId", () => {
  it("prefers the explicit current_period", () => {
    expect(
      resolveCurrentPeriodId({
        current_period: { id: 1001 },
        periods: [{ id: 1000 }, { id: 1001 }],
      }),
    ).toBe(1001);
  });

  it("falls back to the highest period id when current_period is absent", () => {
    expect(resolveCurrentPeriodId({ periods: [{ id: 1000 }, { id: 1002 }, { id: 1001 }] })).toBe(
      1002,
    );
  });

  it("returns null when neither a current period nor any period id is present", () => {
    expect(resolveCurrentPeriodId({})).toBeNull();
    expect(resolveCurrentPeriodId({ periods: [] })).toBeNull();
    expect(resolveCurrentPeriodId(undefined)).toBeNull();
  });
});

describe("resolveAffixRotation", () => {
  it("maps affixes to id/name/level, ordered by starting level", () => {
    expect(
      resolveAffixRotation([
        { keystone_affix: { id: 9, name: "Tyrannical" }, starting_level: 7 },
        { keystone_affix: { id: 10, name: "Fortified" }, starting_level: 2 },
      ]),
    ).toEqual([
      { id: 10, name: "Fortified", startingLevel: 2 },
      { id: 9, name: "Tyrannical", startingLevel: 7 },
    ]);
  });

  it("degrades an affix with no name to its id", () => {
    expect(resolveAffixRotation([{ keystone_affix: { id: 42 }, starting_level: 4 }])).toEqual([
      { id: 42, name: "Affix 42", startingLevel: 4 },
    ]);
  });

  it("drops entries that carry no affix id", () => {
    expect(resolveAffixRotation([{ starting_level: 2 }, { keystone_affix: {} }])).toEqual([]);
  });

  it("tolerates an absent affix list", () => {
    expect(resolveAffixRotation(undefined)).toEqual([]);
  });
});
