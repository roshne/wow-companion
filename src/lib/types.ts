// Best-effort shapes for the (schema-less) responses this app reads.
// Requests are typed by the OpenAPI spec; response bodies are `unknown`, so we cast to these
// locally. Fields are optional on purpose — treat everything as best-effort.

/** A localized string. Flattened to a plain string when a `locale` query param is sent. */
export type LocalizedName = string | { en_US?: string; [key: string]: string | undefined };

/** Read a localized value as a display string (prefers en_US). */
export function loc(v: LocalizedName | undefined): string {
  if (!v) return "";
  if (typeof v === "string") return v;
  return v.en_US ?? Object.values(v).find(Boolean) ?? "";
}

export interface Named {
  type?: string;
  name?: LocalizedName;
  id?: number;
}

export interface RealmInfo {
  id?: number;
  name?: LocalizedName;
  slug?: string;
  category?: LocalizedName;
  timezone?: string;
  is_tournament?: boolean;
}

export interface ConnectedRealm {
  id?: number;
  has_queue?: boolean;
  status?: Named;
  population?: Named;
  realms?: RealmInfo[];
}

export interface ConnectedRealmSearch {
  page?: number;
  pageCount?: number;
  results?: { data?: ConnectedRealm }[];
}

export interface CharacterSummary {
  id?: number;
  name?: string;
  level?: number;
  faction?: Named;
  race?: Named;
  character_class?: Named;
  active_spec?: Named;
  realm?: { name?: LocalizedName; slug?: string; id?: number };
  guild?: { name?: LocalizedName };
  title?: { name?: LocalizedName };
  achievement_points?: number;
  average_item_level?: number;
  equipped_item_level?: number;
  last_login_timestamp?: number;
  gender?: Named;
}

export interface CharacterMedia {
  assets?: { key: string; value: string }[];
}
