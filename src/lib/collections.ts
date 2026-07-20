// Pure counting over the character collection documents (#109): the mounts / pets / toys sub-documents
// each list their collected entries in a top-level array, so a collection's size is just that array's
// length (0 when absent). Kept here — pure and per-type — so the Collections sub-tab stays a thin view
// and the counts are unit-tested away from the query wiring.

import type { CharacterMounts, CharacterPets, CharacterToys } from "./queries";

/** How many mounts the character has collected. */
export function mountCount(data: CharacterMounts): number {
  return (data.mounts ?? []).length;
}

/** How many battle pets the character has collected. */
export function petCount(data: CharacterPets): number {
  return (data.pets ?? []).length;
}

/** How many toys the character has collected. */
export function toyCount(data: CharacterToys): number {
  return (data.toys ?? []).length;
}
