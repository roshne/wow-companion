// Normalize user-typed realm/character input into the forms the WoW Web API path expects.
// Realm slugs are lowercase with spaces collapsed to hyphens (e.g. "Argent Dawn" -> "argent-dawn");
// character names are lowercased.

/** A realm display name to its API slug: trimmed, lowercased, whitespace runs collapsed to hyphens. */
export function toRealmSlug(input: string): string {
  return input.trim().toLowerCase().replace(/\s+/g, "-");
}

/** A character name to its API path form: trimmed and lowercased. */
export function toCharacterName(input: string): string {
  return input.trim().toLowerCase();
}
