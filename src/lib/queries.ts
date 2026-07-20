// The app's data-fetching contract, built on TanStack Query.
//
// Every read goes through a thin `queryFn` over `bnet.api.GET` plus `unwrap()` — deliberately *not*
// `openapi-react-query`, whose queryKey (`[method, path, params]`) omits the per-region host and would
// silently collide caches across regions. `region` is baked into every queryKey here instead, so each
// region gets an independent cache (correct switching, no cross-region bleed).
//
// `BnetError` + `unwrap()` are the shared error contract: consumed today by query error-states, and by
// the retry/backoff (#20) and error-boundary work that plug in next.

import { queryOptions } from "@tanstack/react-query";
import type { BlizzardClient, Region, paths } from "../vendor/battlenet-wow-client";
import { aggregateRealmAuctions, aggregateCommodities, type AggregatedRow } from "./auctions";
import type { ResolvedItem } from "./persist";

const SECOND = 1000;
const MINUTE = 60 * SECOND;

/** Current WoW Token price document (dynamic namespace). Price is in copper; 1 gold = 10,000 copper. */
export type TokenIndex =
  paths["/data/wow/token/index"]["get"]["responses"][200]["content"]["application/json"];

/** The `data` payload of one connected-realm search result (dynamic namespace, names as objects). */
export type ConnectedRealm = NonNullable<
  NonNullable<
    paths["/data/wow/search/connected-realm"]["get"]["responses"][200]["content"]["application/json"]["results"]
  >[number]["data"]
>;

/** Character profile summary (profile namespace, `locale=en_US` — localized names come flattened). */
export type CharacterSummary =
  paths["/profile/wow/character/{realmSlug}/{characterName}"]["get"]["responses"][200]["content"]["application/json"];

/** Character equipment document (per-slot items, quality, item level, enchants, sockets). */
export type CharacterEquipment =
  paths["/profile/wow/character/{realmSlug}/{characterName}/equipment"]["get"]["responses"][200]["content"]["application/json"];

/** Character Mythic+ profile (overall `current_mythic_rating` and the current period). */
export type CharacterMythicKeystone =
  paths["/profile/wow/character/{realmSlug}/{characterName}/mythic-keystone-profile"]["get"]["responses"][200]["content"]["application/json"];

/** Character PvP summary (honor level/kills and per-map match statistics). */
export type CharacterPvpSummary =
  paths["/profile/wow/character/{realmSlug}/{characterName}/pvp-summary"]["get"]["responses"][200]["content"]["application/json"];

/** Character professions (primary/secondary professions, each with tiered skill points). */
export type CharacterProfessions =
  paths["/profile/wow/character/{realmSlug}/{characterName}/professions"]["get"]["responses"][200]["content"]["application/json"];

/** Character specializations (active spec, active hero talent tree, and per-spec talent loadouts). */
export type CharacterSpecializations =
  paths["/profile/wow/character/{realmSlug}/{characterName}/specializations"]["get"]["responses"][200]["content"]["application/json"];

/** Character reputations (per-faction standing, renown level, and paragon progress). */
export type CharacterReputations =
  paths["/profile/wow/character/{realmSlug}/{characterName}/reputations"]["get"]["responses"][200]["content"]["application/json"];

/** Character mount collection (the `mounts` array lists each collected mount). */
export type CharacterMounts =
  paths["/profile/wow/character/{realmSlug}/{characterName}/collections/mounts"]["get"]["responses"][200]["content"]["application/json"];

/** Character battle-pet collection (the `pets` array lists each collected pet). */
export type CharacterPets =
  paths["/profile/wow/character/{realmSlug}/{characterName}/collections/pets"]["get"]["responses"][200]["content"]["application/json"];

/** Character toy collection (the `toys` array lists each collected toy). */
export type CharacterToys =
  paths["/profile/wow/character/{realmSlug}/{characterName}/collections/toys"]["get"]["responses"][200]["content"]["application/json"];

/** Character raid encounters (per-expansion instances, each with per-difficulty boss progress). */
export type CharacterRaids =
  paths["/profile/wow/character/{realmSlug}/{characterName}/encounters/raids"]["get"]["responses"][200]["content"]["application/json"];

/** Character achievements (aggregate totals plus the earned-achievement list). */
export type CharacterAchievements =
  paths["/profile/wow/character/{realmSlug}/{characterName}/achievements"]["get"]["responses"][200]["content"]["application/json"];

/** Guild summary (profile namespace): name, faction, member count, achievement points, realm, crest. */
export type GuildSummary =
  paths["/data/wow/guild/{realmSlug}/{nameSlug}"]["get"]["responses"][200]["content"]["application/json"];

/** Guild roster document (members carry class/race ids, level, and rank — no localized names). */
export type GuildRoster =
  paths["/data/wow/guild/{realmSlug}/{nameSlug}/roster"]["get"]["responses"][200]["content"]["application/json"];

/** One guild roster entry: a member's character stub plus their rank. */
export type GuildRosterMember = NonNullable<GuildRoster["members"]>[number];

/** Guild achievements document (total quantity/points, per-category progress, recent events). */
export type GuildAchievements =
  paths["/data/wow/guild/{realmSlug}/{nameSlug}/achievements"]["get"]["responses"][200]["content"]["application/json"];

/** Guild activity feed (recent character-achievement events with timestamps). */
export type GuildActivity =
  paths["/data/wow/guild/{realmSlug}/{nameSlug}/activity"]["get"]["responses"][200]["content"]["application/json"];

/** One realm from the realm index (name + slug), used for slug autocomplete. */
export interface RealmIndexEntry {
  name: string;
  slug: string;
}

/**
 * Thrown when a Battle.net request comes back non-OK (or a 200 with no body). Carries the HTTP
 * `status` for error-state routing and retry gating, plus any parsed `Retry-After` (seconds) so the
 * backoff work (#20) can honor it. Only the numeric delta-seconds form is parsed here; #20 extends
 * this to the HTTP-date form.
 */
export class BnetError extends Error {
  constructor(
    readonly status: number,
    readonly retryAfter: number | null = null,
  ) {
    super(`Battle.net API request failed (HTTP ${status}).`);
    this.name = "BnetError";
  }
}

/**
 * Parse a `Retry-After` header into seconds. Handles both RFC 9110 forms: delta-seconds
 * (`Retry-After: 12`) and an HTTP-date (`Retry-After: Wed, 21 Oct 2015 07:28:00 GMT`), the latter
 * converted to seconds-from-now and clamped to ≥ 0. Returns null when the header is absent or unparseable.
 */
function parseRetryAfter(response: Response): number | null {
  const raw = response.headers.get("retry-after");
  if (!raw) return null;
  const seconds = Number(raw);
  if (Number.isFinite(seconds)) return Math.max(0, seconds);
  const date = Date.parse(raw);
  if (Number.isNaN(date)) return null;
  return Math.max(0, Math.round((date - Date.now()) / 1000));
}

/**
 * Turn an `openapi-fetch` result into resolved data or a thrown `BnetError`. TanStack treats a thrown
 * error as the query's error state (and a queryFn must never resolve to `undefined`), so a non-OK
 * response — or an OK response with no body — becomes an error rather than a silent "success".
 */
export function unwrap<T>(data: T | undefined, response: Response): T {
  if (!response.ok || data === undefined) {
    throw new BnetError(response.status, parseRetryAfter(response));
  }
  return data;
}

/** Map any thrown query error to a short display string. */
export function describeError(error: unknown): string {
  if (error instanceof BnetError) return `Failed (HTTP ${error.status}).`;
  return `Error: ${String(error)}`;
}

/**
 * Whether a query error deserves a global error toast. Only "real" failures qualify: server errors
 * (5xx), rate limiting (429), and non-HTTP failures (network/unknown). Expected request-specific 4xx
 * — a 404 "not found", a 401 (which routes to the reconnect form) — are shown inline instead, so they
 * don't also spam a toast.
 */
export function shouldToastError(error: unknown): boolean {
  if (error instanceof BnetError) return error.status >= 500 || error.status === 429;
  return true;
}

/**
 * QueryKey factories — the single source of cache identity. `region` leads every key so per-region
 * caches never collide; character keys also carry the realm slug + name.
 */
export const queryKeys = {
  token: (region: Region) => ["token", region] as const,
  connectedRealms: (region: Region) => ["connected-realms", region] as const,
  character: (region: Region, realmSlug: string, characterName: string) =>
    ["character", region, realmSlug, characterName] as const,
  characterMedia: (region: Region, realmSlug: string, characterName: string) =>
    ["character-media", region, realmSlug, characterName] as const,
  realmIndex: (region: Region) => ["realm-index", region] as const,
  characterEquipment: (region: Region, realmSlug: string, characterName: string) =>
    ["character-equipment", region, realmSlug, characterName] as const,
  characterMythicKeystone: (region: Region, realmSlug: string, characterName: string) =>
    ["character-mythic-keystone", region, realmSlug, characterName] as const,
  characterPvpSummary: (region: Region, realmSlug: string, characterName: string) =>
    ["character-pvp-summary", region, realmSlug, characterName] as const,
  characterProfessions: (region: Region, realmSlug: string, characterName: string) =>
    ["character-professions", region, realmSlug, characterName] as const,
  characterSpecializations: (region: Region, realmSlug: string, characterName: string) =>
    ["character-specializations", region, realmSlug, characterName] as const,
  characterReputations: (region: Region, realmSlug: string, characterName: string) =>
    ["character-reputations", region, realmSlug, characterName] as const,
  characterMounts: (region: Region, realmSlug: string, characterName: string) =>
    ["character-mounts", region, realmSlug, characterName] as const,
  characterPets: (region: Region, realmSlug: string, characterName: string) =>
    ["character-pets", region, realmSlug, characterName] as const,
  characterToys: (region: Region, realmSlug: string, characterName: string) =>
    ["character-toys", region, realmSlug, characterName] as const,
  characterRaids: (region: Region, realmSlug: string, characterName: string) =>
    ["character-raids", region, realmSlug, characterName] as const,
  characterAchievements: (region: Region, realmSlug: string, characterName: string) =>
    ["character-achievements", region, realmSlug, characterName] as const,
  guild: (region: Region, realmSlug: string, nameSlug: string) =>
    ["guild", region, realmSlug, nameSlug] as const,
  guildRoster: (region: Region, realmSlug: string, nameSlug: string) =>
    ["guild-roster", region, realmSlug, nameSlug] as const,
  guildAchievements: (region: Region, realmSlug: string, nameSlug: string) =>
    ["guild-achievements", region, realmSlug, nameSlug] as const,
  guildActivity: (region: Region, realmSlug: string, nameSlug: string) =>
    ["guild-activity", region, realmSlug, nameSlug] as const,
  realmAuctions: (region: Region, connectedRealmId: number) =>
    ["realm-auctions", region, connectedRealmId] as const,
  commodities: (region: Region) => ["commodities", region] as const,
};

/** Fetch the current WoW Token price document. */
export async function fetchTokenIndex(bnet: BlizzardClient): Promise<TokenIndex> {
  const { data, response } = await bnet.api.GET("/data/wow/token/index", {
    params: { query: { namespace: bnet.namespace("dynamic"), locale: "en_US" } },
  });
  return unwrap(data, response);
}

/**
 * Fetch every connected realm via the search endpoint, following pagination. Stays a single query —
 * TanStack retries re-run the whole function, which #20 addresses with a transport-layer retry for
 * the pagination loop.
 */
export async function fetchConnectedRealms(bnet: BlizzardClient): Promise<ConnectedRealm[]> {
  const MAX_PAGES = 20;
  const all: ConnectedRealm[] = [];
  for (let page = 1; page <= MAX_PAGES; page++) {
    const { data, response } = await bnet.api.GET("/data/wow/search/connected-realm", {
      params: { query: { namespace: bnet.namespace("dynamic"), orderby: "id", _page: page } },
    });
    const body = unwrap(data, response);
    for (const r of body.results ?? []) if (r.data) all.push(r.data);
    if (page >= (body.pageCount ?? 1)) break;
  }
  return all;
}

/**
 * Fetch the full realm list (name + slug) for autocomplete. `locale=en_US` flattens the names.
 * Near-static, so it's cached aggressively; keeps only entries with both a name and a slug.
 */
export async function fetchRealmIndex(bnet: BlizzardClient): Promise<RealmIndexEntry[]> {
  const { data, response } = await bnet.api.GET("/data/wow/realm/index", {
    params: { query: { namespace: bnet.namespace("dynamic"), locale: "en_US" } },
  });
  const body = unwrap(data, response);
  return (body.realms ?? [])
    .flatMap((r) => (r.name && r.slug ? [{ name: r.name, slug: r.slug }] : []))
    .sort((a, b) => a.name.localeCompare(b.name));
}

/** Look up a character's profile summary by realm slug and name. */
export async function fetchCharacter(
  bnet: BlizzardClient,
  realmSlug: string,
  characterName: string,
): Promise<CharacterSummary> {
  const { data, response } = await bnet.api.GET(
    "/profile/wow/character/{realmSlug}/{characterName}",
    {
      params: {
        path: { realmSlug, characterName },
        query: { namespace: bnet.namespace("profile"), locale: "en_US" },
      },
    },
  );
  return unwrap(data, response);
}

/** Fetch a character's equipment document (per-slot items). */
export async function fetchCharacterEquipment(
  bnet: BlizzardClient,
  realmSlug: string,
  characterName: string,
): Promise<CharacterEquipment> {
  const { data, response } = await bnet.api.GET(
    "/profile/wow/character/{realmSlug}/{characterName}/equipment",
    {
      params: {
        path: { realmSlug, characterName },
        query: { namespace: bnet.namespace("profile"), locale: "en_US" },
      },
    },
  );
  return unwrap(data, response);
}

/** Fetch a character's Mythic+ profile (overall rating + current period). */
export async function fetchCharacterMythicKeystone(
  bnet: BlizzardClient,
  realmSlug: string,
  characterName: string,
): Promise<CharacterMythicKeystone> {
  const { data, response } = await bnet.api.GET(
    "/profile/wow/character/{realmSlug}/{characterName}/mythic-keystone-profile",
    {
      params: {
        path: { realmSlug, characterName },
        query: { namespace: bnet.namespace("profile"), locale: "en_US" },
      },
    },
  );
  return unwrap(data, response);
}

/** Fetch a character's PvP summary (honor level/kills + per-map statistics). */
export async function fetchCharacterPvpSummary(
  bnet: BlizzardClient,
  realmSlug: string,
  characterName: string,
): Promise<CharacterPvpSummary> {
  const { data, response } = await bnet.api.GET(
    "/profile/wow/character/{realmSlug}/{characterName}/pvp-summary",
    {
      params: {
        path: { realmSlug, characterName },
        query: { namespace: bnet.namespace("profile"), locale: "en_US" },
      },
    },
  );
  return unwrap(data, response);
}

/** Fetch a character's professions (primaries + secondaries, each with tiers). */
export async function fetchCharacterProfessions(
  bnet: BlizzardClient,
  realmSlug: string,
  characterName: string,
): Promise<CharacterProfessions> {
  const { data, response } = await bnet.api.GET(
    "/profile/wow/character/{realmSlug}/{characterName}/professions",
    {
      params: {
        path: { realmSlug, characterName },
        query: { namespace: bnet.namespace("profile"), locale: "en_US" },
      },
    },
  );
  return unwrap(data, response);
}

/** Fetch a character's specializations (active spec + hero talents + per-spec talent loadouts). */
export async function fetchCharacterSpecializations(
  bnet: BlizzardClient,
  realmSlug: string,
  characterName: string,
): Promise<CharacterSpecializations> {
  const { data, response } = await bnet.api.GET(
    "/profile/wow/character/{realmSlug}/{characterName}/specializations",
    {
      params: {
        path: { realmSlug, characterName },
        query: { namespace: bnet.namespace("profile"), locale: "en_US" },
      },
    },
  );
  return unwrap(data, response);
}

/** Fetch a character's reputations (per-faction standing + renown). */
export async function fetchCharacterReputations(
  bnet: BlizzardClient,
  realmSlug: string,
  characterName: string,
): Promise<CharacterReputations> {
  const { data, response } = await bnet.api.GET(
    "/profile/wow/character/{realmSlug}/{characterName}/reputations",
    {
      params: {
        path: { realmSlug, characterName },
        query: { namespace: bnet.namespace("profile"), locale: "en_US" },
      },
    },
  );
  return unwrap(data, response);
}

/** Fetch a character's mount collection. */
export async function fetchCharacterMounts(
  bnet: BlizzardClient,
  realmSlug: string,
  characterName: string,
): Promise<CharacterMounts> {
  const { data, response } = await bnet.api.GET(
    "/profile/wow/character/{realmSlug}/{characterName}/collections/mounts",
    {
      params: {
        path: { realmSlug, characterName },
        query: { namespace: bnet.namespace("profile"), locale: "en_US" },
      },
    },
  );
  return unwrap(data, response);
}

/** Fetch a character's battle-pet collection. */
export async function fetchCharacterPets(
  bnet: BlizzardClient,
  realmSlug: string,
  characterName: string,
): Promise<CharacterPets> {
  const { data, response } = await bnet.api.GET(
    "/profile/wow/character/{realmSlug}/{characterName}/collections/pets",
    {
      params: {
        path: { realmSlug, characterName },
        query: { namespace: bnet.namespace("profile"), locale: "en_US" },
      },
    },
  );
  return unwrap(data, response);
}

/** Fetch a character's toy collection. */
export async function fetchCharacterToys(
  bnet: BlizzardClient,
  realmSlug: string,
  characterName: string,
): Promise<CharacterToys> {
  const { data, response } = await bnet.api.GET(
    "/profile/wow/character/{realmSlug}/{characterName}/collections/toys",
    {
      params: {
        path: { realmSlug, characterName },
        query: { namespace: bnet.namespace("profile"), locale: "en_US" },
      },
    },
  );
  return unwrap(data, response);
}

/** Fetch a character's raid encounters (per-expansion, per-difficulty boss progress). */
export async function fetchCharacterRaids(
  bnet: BlizzardClient,
  realmSlug: string,
  characterName: string,
): Promise<CharacterRaids> {
  const { data, response } = await bnet.api.GET(
    "/profile/wow/character/{realmSlug}/{characterName}/encounters/raids",
    {
      params: {
        path: { realmSlug, characterName },
        query: { namespace: bnet.namespace("profile"), locale: "en_US" },
      },
    },
  );
  return unwrap(data, response);
}

/** Fetch a character's achievements (totals + the earned-achievement list). */
export async function fetchCharacterAchievements(
  bnet: BlizzardClient,
  realmSlug: string,
  characterName: string,
): Promise<CharacterAchievements> {
  const { data, response } = await bnet.api.GET(
    "/profile/wow/character/{realmSlug}/{characterName}/achievements",
    {
      params: {
        path: { realmSlug, characterName },
        query: { namespace: bnet.namespace("profile"), locale: "en_US" },
      },
    },
  );
  return unwrap(data, response);
}

/** A character's portrait image URLs from the media document — best-effort, either may be `null`. */
export interface CharacterMedia {
  /** Full-body render: the `main-raw` asset (preferred) or `main`. */
  render: string | null;
  /** The small square `avatar` asset. */
  avatar: string | null;
}

/**
 * Best-effort character portrait URLs from the media document. Returns both the full-body `render`
 * (preferring `main-raw` over `main`) and the square `avatar`; each is `null` when that asset — or the
 * whole document — is unavailable, so a caller can fall back render → avatar → placeholder.
 */
export async function fetchCharacterMedia(
  bnet: BlizzardClient,
  realmSlug: string,
  characterName: string,
): Promise<CharacterMedia> {
  const { data, response } = await bnet.api.GET(
    "/profile/wow/character/{realmSlug}/{characterName}/character-media",
    {
      params: {
        path: { realmSlug, characterName },
        query: { namespace: bnet.namespace("profile"), locale: "en_US" },
      },
    },
  );
  if (!response.ok) return { render: null, avatar: null };
  const asset = (key: string) => data?.assets?.find((x) => x.key === key)?.value ?? null;
  return { render: asset("main-raw") ?? asset("main"), avatar: asset("avatar") };
}

// Guild reads — all four share the profile namespace and a `{realmSlug, nameSlug}` path.

/** Fetch a guild's summary document (member count, achievement points, faction, realm). */
export async function fetchGuild(
  bnet: BlizzardClient,
  realmSlug: string,
  nameSlug: string,
): Promise<GuildSummary> {
  const { data, response } = await bnet.api.GET("/data/wow/guild/{realmSlug}/{nameSlug}", {
    params: {
      path: { realmSlug, nameSlug },
      query: { namespace: bnet.namespace("profile"), locale: "en_US" },
    },
  });
  return unwrap(data, response);
}

/** Fetch a guild's roster (members with class/race ids, level, and rank). */
export async function fetchGuildRoster(
  bnet: BlizzardClient,
  realmSlug: string,
  nameSlug: string,
): Promise<GuildRoster> {
  const { data, response } = await bnet.api.GET("/data/wow/guild/{realmSlug}/{nameSlug}/roster", {
    params: {
      path: { realmSlug, nameSlug },
      query: { namespace: bnet.namespace("profile"), locale: "en_US" },
    },
  });
  return unwrap(data, response);
}

/** Fetch a guild's achievements document (total quantity/points, recent events). */
export async function fetchGuildAchievements(
  bnet: BlizzardClient,
  realmSlug: string,
  nameSlug: string,
): Promise<GuildAchievements> {
  const { data, response } = await bnet.api.GET(
    "/data/wow/guild/{realmSlug}/{nameSlug}/achievements",
    {
      params: {
        path: { realmSlug, nameSlug },
        query: { namespace: bnet.namespace("profile"), locale: "en_US" },
      },
    },
  );
  return unwrap(data, response);
}

/** Fetch a guild's recent activity feed. */
export async function fetchGuildActivity(
  bnet: BlizzardClient,
  realmSlug: string,
  nameSlug: string,
): Promise<GuildActivity> {
  const { data, response } = await bnet.api.GET("/data/wow/guild/{realmSlug}/{nameSlug}/activity", {
    params: {
      path: { realmSlug, nameSlug },
      query: { namespace: bnet.namespace("profile"), locale: "en_US" },
    },
  });
  return unwrap(data, response);
}

// Auction reads. The snapshots (dynamic namespace) are large, so they're aggregated by item id in the
// queryFn — the cache then holds the compact `AggregatedRow[]`, not the raw listing dump. Item detail
// (for name resolution) is a *static*-namespace read and best-effort: a failure yields `null` rather
// than throwing, so one unresolved item never breaks the list.

/** Fetch a connected realm's auction snapshot, aggregated by item id. */
export async function fetchRealmAuctions(
  bnet: BlizzardClient,
  connectedRealmId: number,
): Promise<AggregatedRow[]> {
  const { data, response } = await bnet.api.GET(
    "/data/wow/connected-realm/{connectedRealmId}/auctions",
    {
      params: {
        path: { connectedRealmId },
        query: { namespace: bnet.namespace("dynamic"), locale: "en_US" },
      },
    },
  );
  return aggregateRealmAuctions(unwrap(data, response).auctions);
}

/** Fetch the region-wide commodities snapshot, aggregated by item id. */
export async function fetchCommodities(bnet: BlizzardClient): Promise<AggregatedRow[]> {
  const { data, response } = await bnet.api.GET("/data/wow/auctions/commodities", {
    params: { query: { namespace: bnet.namespace("dynamic"), locale: "en_US" } },
  });
  return aggregateCommodities(unwrap(data, response).auctions);
}

/**
 * Resolve one item's display name + quality (static namespace, `locale=en_US` so the name comes back
 * flattened). Best-effort: returns `null` on any non-OK response or a body with no name.
 */
export async function fetchItemName(
  bnet: BlizzardClient,
  itemId: number,
): Promise<ResolvedItem | null> {
  const { data, response } = await bnet.api.GET("/data/wow/item/{itemId}", {
    params: {
      path: { itemId: String(itemId) },
      query: { namespace: bnet.namespace("static"), locale: "en_US" },
    },
  });
  if (!response.ok || typeof data?.name !== "string") return null;
  const quality = data.quality?.type;
  return typeof quality === "string" ? { name: data.name, quality } : { name: data.name };
}

/**
 * Resolve one item's icon URL from its media document (static namespace, `locale=en_US`). Best-effort:
 * returns `null` on any non-OK response or a body with no `icon` asset. Backs the paper doll's
 * viewport-only `useItemIcons` resolver. (This path types `itemId` as a number, unlike the string id
 * `fetchItemName` passes for `/data/wow/item/{itemId}`.)
 */
export async function fetchItemMedia(bnet: BlizzardClient, itemId: number): Promise<string | null> {
  const { data, response } = await bnet.api.GET("/data/wow/media/item/{itemId}", {
    params: {
      path: { itemId },
      query: { namespace: bnet.namespace("static"), locale: "en_US" },
    },
  });
  if (!response.ok) return null;
  const icon = data?.assets?.find((a) => a.key === "icon")?.value;
  return typeof icon === "string" && icon.length > 0 ? icon : null;
}

// Query-option factories: region-scoped keys + per-endpoint staleTime. Components call these and
// spread the result into `useQuery`. staleTime is the main lever for staying under the rate limits —
// the token/realm docs move slowly (~5 min), character data a little faster (~60 s), and a
// character's media is effectively static (~30 min).

export const tokenQuery = (bnet: BlizzardClient) =>
  queryOptions({
    queryKey: queryKeys.token(bnet.region),
    queryFn: () => fetchTokenIndex(bnet),
    staleTime: 5 * MINUTE,
  });

export const connectedRealmsQuery = (bnet: BlizzardClient) =>
  queryOptions({
    queryKey: queryKeys.connectedRealms(bnet.region),
    queryFn: () => fetchConnectedRealms(bnet),
    staleTime: 5 * MINUTE,
  });

export const realmIndexQuery = (bnet: BlizzardClient) =>
  queryOptions({
    queryKey: queryKeys.realmIndex(bnet.region),
    queryFn: () => fetchRealmIndex(bnet),
    staleTime: 60 * MINUTE,
  });

export const characterEquipmentQuery = (
  bnet: BlizzardClient,
  realmSlug: string,
  characterName: string,
) =>
  queryOptions({
    queryKey: queryKeys.characterEquipment(bnet.region, realmSlug, characterName),
    queryFn: () => fetchCharacterEquipment(bnet, realmSlug, characterName),
    staleTime: 2 * MINUTE,
  });

export const characterMythicKeystoneQuery = (
  bnet: BlizzardClient,
  realmSlug: string,
  characterName: string,
) =>
  queryOptions({
    queryKey: queryKeys.characterMythicKeystone(bnet.region, realmSlug, characterName),
    queryFn: () => fetchCharacterMythicKeystone(bnet, realmSlug, characterName),
    staleTime: 2 * MINUTE,
  });

export const characterPvpSummaryQuery = (
  bnet: BlizzardClient,
  realmSlug: string,
  characterName: string,
) =>
  queryOptions({
    queryKey: queryKeys.characterPvpSummary(bnet.region, realmSlug, characterName),
    queryFn: () => fetchCharacterPvpSummary(bnet, realmSlug, characterName),
    staleTime: 2 * MINUTE,
  });

export const characterProfessionsQuery = (
  bnet: BlizzardClient,
  realmSlug: string,
  characterName: string,
) =>
  queryOptions({
    queryKey: queryKeys.characterProfessions(bnet.region, realmSlug, characterName),
    queryFn: () => fetchCharacterProfessions(bnet, realmSlug, characterName),
    staleTime: 2 * MINUTE,
  });

export const characterSpecializationsQuery = (
  bnet: BlizzardClient,
  realmSlug: string,
  characterName: string,
) =>
  queryOptions({
    queryKey: queryKeys.characterSpecializations(bnet.region, realmSlug, characterName),
    queryFn: () => fetchCharacterSpecializations(bnet, realmSlug, characterName),
    staleTime: 2 * MINUTE,
  });

export const characterReputationsQuery = (
  bnet: BlizzardClient,
  realmSlug: string,
  characterName: string,
) =>
  queryOptions({
    queryKey: queryKeys.characterReputations(bnet.region, realmSlug, characterName),
    queryFn: () => fetchCharacterReputations(bnet, realmSlug, characterName),
    staleTime: 2 * MINUTE,
  });

export const characterMountsQuery = (
  bnet: BlizzardClient,
  realmSlug: string,
  characterName: string,
) =>
  queryOptions({
    queryKey: queryKeys.characterMounts(bnet.region, realmSlug, characterName),
    queryFn: () => fetchCharacterMounts(bnet, realmSlug, characterName),
    staleTime: 2 * MINUTE,
  });

export const characterPetsQuery = (
  bnet: BlizzardClient,
  realmSlug: string,
  characterName: string,
) =>
  queryOptions({
    queryKey: queryKeys.characterPets(bnet.region, realmSlug, characterName),
    queryFn: () => fetchCharacterPets(bnet, realmSlug, characterName),
    staleTime: 2 * MINUTE,
  });

export const characterToysQuery = (
  bnet: BlizzardClient,
  realmSlug: string,
  characterName: string,
) =>
  queryOptions({
    queryKey: queryKeys.characterToys(bnet.region, realmSlug, characterName),
    queryFn: () => fetchCharacterToys(bnet, realmSlug, characterName),
    staleTime: 2 * MINUTE,
  });

export const characterRaidsQuery = (
  bnet: BlizzardClient,
  realmSlug: string,
  characterName: string,
) =>
  queryOptions({
    queryKey: queryKeys.characterRaids(bnet.region, realmSlug, characterName),
    queryFn: () => fetchCharacterRaids(bnet, realmSlug, characterName),
    staleTime: 2 * MINUTE,
  });

export const characterAchievementsQuery = (
  bnet: BlizzardClient,
  realmSlug: string,
  characterName: string,
) =>
  queryOptions({
    queryKey: queryKeys.characterAchievements(bnet.region, realmSlug, characterName),
    queryFn: () => fetchCharacterAchievements(bnet, realmSlug, characterName),
    staleTime: 2 * MINUTE,
  });

export const characterQuery = (bnet: BlizzardClient, realmSlug: string, characterName: string) =>
  queryOptions({
    queryKey: queryKeys.character(bnet.region, realmSlug, characterName),
    queryFn: () => fetchCharacter(bnet, realmSlug, characterName),
    staleTime: 60 * SECOND,
  });

export const characterMediaQuery = (
  bnet: BlizzardClient,
  realmSlug: string,
  characterName: string,
) =>
  queryOptions({
    queryKey: queryKeys.characterMedia(bnet.region, realmSlug, characterName),
    queryFn: () => fetchCharacterMedia(bnet, realmSlug, characterName),
    staleTime: 30 * MINUTE,
  });

export const guildQuery = (bnet: BlizzardClient, realmSlug: string, nameSlug: string) =>
  queryOptions({
    queryKey: queryKeys.guild(bnet.region, realmSlug, nameSlug),
    queryFn: () => fetchGuild(bnet, realmSlug, nameSlug),
    staleTime: 5 * MINUTE,
  });

export const guildRosterQuery = (bnet: BlizzardClient, realmSlug: string, nameSlug: string) =>
  queryOptions({
    queryKey: queryKeys.guildRoster(bnet.region, realmSlug, nameSlug),
    queryFn: () => fetchGuildRoster(bnet, realmSlug, nameSlug),
    staleTime: 2 * MINUTE,
  });

export const guildAchievementsQuery = (bnet: BlizzardClient, realmSlug: string, nameSlug: string) =>
  queryOptions({
    queryKey: queryKeys.guildAchievements(bnet.region, realmSlug, nameSlug),
    queryFn: () => fetchGuildAchievements(bnet, realmSlug, nameSlug),
    staleTime: 5 * MINUTE,
  });

export const guildActivityQuery = (bnet: BlizzardClient, realmSlug: string, nameSlug: string) =>
  queryOptions({
    queryKey: queryKeys.guildActivity(bnet.region, realmSlug, nameSlug),
    queryFn: () => fetchGuildActivity(bnet, realmSlug, nameSlug),
    staleTime: 5 * MINUTE,
  });

// Auction snapshots: fetch once and hold. Blizzard regenerates them ~hourly, so re-fetching per
// interaction only burns quota — `staleTime`/`gcTime` are Infinity, and the browser exposes an explicit
// Refresh instead. The queryKey carries the connected realm so each realm caches independently.

export const realmAuctionsQuery = (bnet: BlizzardClient, connectedRealmId: number) =>
  queryOptions({
    queryKey: queryKeys.realmAuctions(bnet.region, connectedRealmId),
    queryFn: () => fetchRealmAuctions(bnet, connectedRealmId),
    staleTime: Infinity,
    gcTime: Infinity,
  });

export const commoditiesQuery = (bnet: BlizzardClient) =>
  queryOptions({
    queryKey: queryKeys.commodities(bnet.region),
    queryFn: () => fetchCommodities(bnet),
    staleTime: Infinity,
    gcTime: Infinity,
  });
