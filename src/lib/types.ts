// Localized-name helper for the responses this app reads.
//
// Response *shapes* are now typed by the vendored OpenAPI client (`paths`, from captured schemas);
// the components reference them directly via `paths[...]` indexed access. What isn't expressible in
// the generated types is the localized-name duality: a name comes back either as an object (no
// `locale` query — e.g. realm search) or flattened to a plain string (with `locale=en_US` — e.g.
// character summary). `loc()` reads either form as a display string.

/** A localized string. Flattened to a plain string when a `locale` query param is sent. */
export type LocalizedName = string | { en_US?: string; [key: string]: string | undefined };

/** Read a localized value as a display string (prefers en_US). */
export function loc(v: LocalizedName | undefined): string {
  if (!v) return "";
  if (typeof v === "string") return v;
  return v.en_US ?? Object.values(v).find(Boolean) ?? "";
}
