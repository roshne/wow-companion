import bundle from "../vendor/wow-static-data/static-data.json";
import type { Region } from "../vendor/battlenet-wow-client";
import type { WarbandCharacter, WarbandCurrency, WarbandData } from "./warband";
import { isStale } from "./vaultBoard";

/**
 * The Warbandeer field key → Blizzard currency id bridge.
 *
 * Needed because the two halves are keyed differently and neither can be changed: the addon saves
 * currencies under its **own field names** (`characters[n].currency.HeroDawncrest`) and never writes
 * an id, while the vendored static-data bundle is keyed by **numeric currency id**. The ids live only
 * in the addon's `data/currency.lua` field definitions, which is where these come from.
 *
 * A key absent here is a supported outcome, not a bug — see {@link resolveCurrency}. The live
 * database already contains `AdventurerCrest` and `Manaflux`, written by older addon versions and no
 * longer in its field list, so the unknown-key path is exercised in practice from day one.
 */
export const CURRENCY_IDS: Record<string, number> = {
  RestoredCofferKey: 3028,
  CofferKeyShard: 3310,
  Catalyst: 3378,
  HeroDawncrest: 3345,
  MythDawncrest: 3347,
  NebulousVoidcore: 3418,
  UntaintedManaCrystal: 3356,
  ShardOfDundun: 3376,
  FieldAccolade: 3405,
  UnalloyedAbundance: 3377,
};

/** Entries are partial by design: some currencies in the bundle carry a null icon (e.g. id 830). */
interface BundleEntry {
  name?: string | null;
  icon?: string | null;
  maxQty?: number | null;
  quality?: number | null;
}

const CURRENCIES = bundle.currencies as Record<string, BundleEntry>;

/** The static-data build the bundle was generated from — shown so a stale bundle is visible. */
export const BUNDLE_BUILD: string = bundle.build;

/** A currency key resolved (or not) against the bridge and the bundle. */
export interface ResolvedCurrency {
  key: string;
  id: number | null;
  /** Bundle name when known, otherwise the addon key split into words. */
  name: string;
  icon: string | null;
  /** The bundle's hard cap, when it declares one. Zero means "no cap" and is normalised to null. */
  bundleMaxQty: number | null;
  /** False when the key isn't in the bridge, or its id isn't in the bundle. */
  known: boolean;
}

/** `AdventurerCrest` → `Adventurer Crest`, so an unresolved key still reads as a name. */
export function humanizeKey(key: string): string {
  return key.replace(/([a-z0-9])([A-Z])/g, "$1 $2");
}

/**
 * Resolve an addon currency key to its display form.
 *
 * Degrades in two independent steps rather than failing: a key the bridge doesn't know, and an id the
 * bundle doesn't know, both fall back to the humanised key. The first is the likelier one when a new
 * season lands — the addon starts writing a new currency before this map learns about it — so the
 * fallback has to read as a real name, not as a blank cell or an error.
 */
export function resolveCurrency(key: string): ResolvedCurrency {
  const id = CURRENCY_IDS[key] ?? null;
  const entry = id != null ? CURRENCIES[String(id)] : undefined;
  const maxQty = entry?.maxQty ?? 0;
  return {
    key,
    id,
    name: entry?.name ?? humanizeKey(key),
    icon: entry?.icon ?? null,
    bundleMaxQty: maxQty > 0 ? maxQty : null,
    known: entry != null,
  };
}

/**
 * A currency icon on Blizzard's render CDN. The host is already permitted by the app's `img-src`
 * CSP, so this needs no config change — but slugs can contain spaces, so the path is encoded, and
 * callers must tolerate a 404 (the bundle's slug and the CDN's filename don't always agree).
 */
export function iconUrl(icon: string, region: Region): string {
  return `https://render.worldofwarcraft.com/${region}/icons/56/${encodeURIComponent(icon)}.jpg`;
}

/** One character's amount of one currency, with the cap that applies to it. */
export interface CurrencyCell {
  quantity: number;
  earned: number | null;
  /**
   * The cap that matters for this cell, preferring the addon's own figures over the bundle's.
   *
   * The addon distinguishes a weekly *earn* cap from a hard *hold* cap; the bundle has a single
   * `maxQty` and can't tell them apart, so it's only a fallback.
   */
  cap: number | null;
  capKind: "weekly" | "hold" | null;
  /**
   * The amount held exceeds the cap, so the cap can't be right and isn't worth showing.
   *
   * Real case: crest caps rise as a season progresses, but the vendored bundle's `maxQty` is a fixed
   * snapshot, so once the in-game cap moves past it the bundle under-reports. Rendering "120 / 100"
   * is accurate about both numbers and still reads as a bug, so the consumer hides the cap — while
   * `cap` itself is kept here, so *why* it was hidden stays inspectable.
   */
  capExceeded: boolean;
  capped: boolean;
}

export interface CurrencyRow {
  character: WarbandCharacter;
  /** Currency key → cell, for the currencies this character has recorded. */
  cells: Record<string, CurrencyCell>;
  stale: boolean;
}

export interface CurrencyBoard {
  /** Every currency any character holds, resolved; known ones first, then unknown, each by name. */
  columns: ResolvedCurrency[];
  rows: CurrencyRow[];
  lastRefresh: number | null;
  weekStart: number | null;
}

/**
 * A cap of zero means *uncapped*, in both sources — never "a cap of zero".
 *
 * The addon writes `max: 0` whenever the game reports no cap of that kind (Blizzard's
 * `maxWeeklyQuantity` is 0 for a currency with no weekly earn limit). Treating that as a real value
 * renders "11 / 0", and — because `??` only falls through on null/undefined — it also suppresses the
 * bundle's genuine hold cap, so the one useful number is lost twice over.
 */
const positiveCap = (n: number | null | undefined): number | null =>
  typeof n === "number" && n > 0 ? n : null;

function cellOf(c: WarbandCurrency, resolved: ResolvedCurrency): CurrencyCell {
  // Weekly earn cap wins: it's the one that resets and therefore the one worth chasing this week.
  const weekly = positiveCap(c.weeklyMax);
  const hold = positiveCap(c.max) ?? resolved.bundleMaxQty;
  const cap = weekly ?? hold;
  return {
    quantity: c.quantity,
    earned: c.earned,
    cap,
    capKind: cap == null ? null : weekly != null ? "weekly" : "hold",
    capExceeded: cap != null && c.quantity > cap,
    capped: c.capped ?? false,
  };
}

/**
 * Build the currencies board.
 *
 * Columns are the union of every currency any character holds — driven by the data rather than by a
 * fixed list, so a currency added in a new season appears without a code change. That's the whole
 * reason this view reads the vendored bundle instead of hardcoding names.
 */
export function buildCurrencyBoard(data: WarbandData | null): CurrencyBoard {
  if (!data) return { columns: [], rows: [], lastRefresh: null, weekStart: null };

  const weekStart = data.wealth?.week?.start ?? null;
  const seen = new Map<string, ResolvedCurrency>();
  const rows: CurrencyRow[] = [];

  for (const character of data.characters) {
    if (character.currencies.length === 0) continue;
    const cells: Record<string, CurrencyCell> = {};
    for (const c of character.currencies) {
      let resolved = seen.get(c.key);
      if (!resolved) {
        resolved = resolveCurrency(c.key);
        seen.set(c.key, resolved);
      }
      cells[c.key] = cellOf(c, resolved);
    }
    rows.push({ character, cells, stale: isStale(character, weekStart) });
  }

  // Known currencies first so the recognisable ones lead; legacy keys from older addon versions
  // sort to the end rather than interleaving with the current season's.
  const columns = [...seen.values()].sort((a, b) => {
    if (a.known !== b.known) return a.known ? -1 : 1;
    return a.name.localeCompare(b.name);
  });

  rows.sort((a, b) => {
    if (a.stale !== b.stale) return a.stale ? 1 : -1;
    return a.character.name.localeCompare(b.character.name);
  });

  let lastRefresh: number | null = null;
  for (const r of rows) {
    const t = r.character.lastRefresh;
    if (t != null && (lastRefresh == null || t > lastRefresh)) lastRefresh = t;
  }

  return { columns, rows, lastRefresh, weekStart };
}
