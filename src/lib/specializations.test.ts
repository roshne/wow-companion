import { describe, it, expect } from "vitest";
import type { CharacterSpecializations } from "./queries";
import { activeBuild } from "./specializations";

const doc = (v: unknown): CharacterSpecializations => v as CharacterSpecializations;

describe("activeBuild", () => {
  it("distills the active spec's active loadout — code and talent counts", () => {
    const data = doc({
      active_specialization: { id: 65, name: "Holy" },
      active_hero_talent_tree: { id: 1, name: "Herald of the Sun" },
      specializations: [
        {
          specialization: { id: 65, name: "Holy" },
          loadouts: [
            { is_active: false, talent_loadout_code: "OLD", selected_class_talents: [{ id: 1 }] },
            {
              is_active: true,
              talent_loadout_code: "CODE123",
              selected_class_talents: [{ id: 1 }, { id: 2 }, { id: 3 }],
              selected_hero_talents: [{ id: 9 }],
            },
          ],
        },
      ],
    });
    expect(activeBuild(data)).toEqual({
      specName: "Holy",
      heroTreeName: "Herald of the Sun",
      loadoutCode: "CODE123",
      classTalentCount: 3,
      heroTalentCount: 1,
    });
  });

  it("matches the active loadout by active_specialization.id, not the first spec", () => {
    const data = doc({
      active_specialization: { id: 66, name: "Protection" },
      specializations: [
        {
          specialization: { id: 65, name: "Holy" },
          loadouts: [{ is_active: true, talent_loadout_code: "HOLY" }],
        },
        {
          specialization: { id: 66, name: "Protection" },
          loadouts: [
            { is_active: true, talent_loadout_code: "PROT", selected_class_talents: [{ id: 1 }] },
          ],
        },
      ],
    });
    const build = activeBuild(data);
    expect(build?.specName).toBe("Protection");
    expect(build?.loadoutCode).toBe("PROT");
    expect(build?.classTalentCount).toBe(1);
  });

  it("returns null when there is no active specialization", () => {
    expect(activeBuild(doc({}))).toBeNull();
    expect(activeBuild(doc({ specializations: [] }))).toBeNull();
  });

  it("returns the spec with no code and zero counts when the active spec has no active loadout", () => {
    const data = doc({
      active_specialization: { id: 65, name: "Holy" },
      specializations: [
        {
          specialization: { id: 65, name: "Holy" },
          loadouts: [{ is_active: false, talent_loadout_code: "OLD" }],
        },
      ],
    });
    expect(activeBuild(data)).toEqual({
      specName: "Holy",
      heroTreeName: undefined,
      loadoutCode: undefined,
      classTalentCount: 0,
      heroTalentCount: 0,
    });
  });
});
