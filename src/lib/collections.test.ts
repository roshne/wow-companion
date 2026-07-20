import { describe, it, expect } from "vitest";
import type { CharacterMounts, CharacterPets, CharacterToys } from "./queries";
import { mountCount, petCount, toyCount } from "./collections";

describe("collection counts", () => {
  it("counts the entries in each collection's array", () => {
    expect(mountCount({ mounts: [{}, {}, {}] } as CharacterMounts)).toBe(3);
    expect(petCount({ pets: [{}, {}] } as CharacterPets)).toBe(2);
    expect(toyCount({ toys: [{}] } as CharacterToys)).toBe(1);
  });

  it("counts an empty or absent collection as 0", () => {
    expect(mountCount({ mounts: [] } as CharacterMounts)).toBe(0);
    expect(petCount({} as CharacterPets)).toBe(0);
    expect(toyCount({} as CharacterToys)).toBe(0);
  });
});
