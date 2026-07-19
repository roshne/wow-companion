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

/**
 * Find the realm index entry a typed value refers to — by display name (what the autocomplete fills
 * in) or by an already-slugged value — or `undefined` when nothing matches. Shared by realm-slug
 * resolution and cross-region detection so both agree on what counts as a match.
 */
export function findRealm<T extends { name: string; slug: string }>(
  input: string,
  realms: T[],
): T | undefined {
  const derived = toRealmSlug(input);
  const typed = input.trim().toLowerCase();
  return realms.find((r) => r.name.toLowerCase() === typed || r.slug === derived);
}

/**
 * Resolve a typed realm value to its true API slug using the realm index. When the input matches an
 * index entry — by display name (what the autocomplete fills in) or by an already-slugged value — that
 * entry's real `slug` is used, which is correct even for realms whose slug isn't just the hyphenated
 * name (e.g. "Aggra (Português)" -> "aggra-portugues"). Falls back to `toRealmSlug` for free-typed
 * input with no match, so an out-of-list realm still submits as before.
 */
export function resolveRealmSlug(input: string, realms: { name: string; slug: string }[]): string {
  return findRealm(input, realms)?.slug ?? toRealmSlug(input);
}

/**
 * A guild display name to its API `nameSlug`: same normalization as a realm slug (trimmed,
 * lowercased, whitespace runs collapsed to hyphens). Covers the common case; names with apostrophes
 * or accents may not match Blizzard's exact slugging.
 */
export function toGuildNameSlug(input: string): string {
  return toRealmSlug(input);
}
