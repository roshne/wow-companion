// Read the Warbandeer_Characters addon's SavedVariables — a Lua table literal
// (`WarbandeerCharDB = { ... }`) the addon rewrites on every login — and expose a
// typed, warband-wide character list to the frontend.
//
// The file is loaded in an embedded Lua VM with an empty environment, so the
// chunk can only assign the data table (it has no access to any Lua stdlib).

use std::collections::HashMap;
use std::path::PathBuf;

use mlua::{Lua, LuaSerdeExt, Table, Value};
use serde::{Deserialize, Serialize};

/// One currency held by a character, from `characters[name].currency`.
///
/// Keyed by the addon's own field name (`HeroDawncrest`, `CofferKeyShard`, …) because the saved
/// data carries **no currency ids** — the ids live only in the addon's Lua field definitions, so
/// mapping a key to the vendored static-data bundle (which *is* id-keyed) belongs to the consumer,
/// not here. `gold` is not in this list: it's promoted to `WarbandCharacter::gold`.
///
/// The addon stores two shapes — a bare quantity, or a table with weekly-cap detail — so everything
/// past `quantity` is optional and absent for the bare form.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WarbandCurrency {
    pub key: String,
    pub quantity: i64,
    /// Earned this week (or this season, for the currencies capped season-wide).
    pub earned: Option<i64>,
    pub max: Option<i64>,
    pub weekly_max: Option<i64>,
    pub capped: Option<bool>,
}

/// One week of warband wealth, from `warband.week` (the open week) or `warband.history` (closed).
///
/// One struct for both because they differ only in which fields are present: an open week carries
/// `baseline`, a closed one carries `ending` and `made`.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WarbandWeek {
    /// Server-time of the weekly reset this week began at.
    pub start: Option<i64>,
    /// Total warband wealth (copper) when the week opened.
    pub baseline: Option<i64>,
    /// Total warband wealth (copper) when the week closed.
    pub ending: Option<i64>,
    /// `ending - baseline`; may be negative.
    pub made: Option<i64>,
}

/// Account-wide wealth, from `WarbandeerCharDB.warband`. The warband bank is shared across the
/// account, so the addon stores it once at the DB top level rather than per character.
///
/// Deliberately raw: the addon's own total ("bank gold plus every character's last-known gold") is
/// left to the consumer to derive, so this type reports only what's on disk. All amounts are copper.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WarbandWealth {
    pub bank_gold: Option<i64>,
    /// The currently-open week.
    pub week: Option<WarbandWeek>,
    /// Closed weeks, oldest first.
    pub history: Vec<WarbandWeek>,
}

/// One of the three slots on a Great Vault track.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct VaultSlot {
    /// Activities needed to unlock this slot (raid 2/4/6, Mythic+ 1/4/8).
    pub threshold: i64,
    pub progress: i64,
    pub complete: bool,
    /// Reward item level — the addon resolves it for unlocked slots only, so a locked slot has none.
    pub ilvl: Option<i64>,
}

/// The Great Vault's three tracks, each an ordered list of slots (ascending threshold).
///
/// A track is empty rather than absent when the character has no progress on it, so callers can
/// render three consistent rows without distinguishing "no progress" from "not recorded" — that
/// distinction lives one level up, on whether `WarbandWeekly::vault` is present at all.
#[derive(Debug, Serialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct VaultTracks {
    pub raid: Vec<VaultSlot>,
    pub dungeons: Vec<VaultSlot>,
    pub world: Vec<VaultSlot>,
}

/// One instance lockout, flattened out of the addon's `locks[instanceId][difficultyId]` nesting.
///
/// Flattened deliberately: the ids are the addon's map keys, and a nested map would reach the
/// frontend as JSON object keys with no guaranteed order. A sorted list of records keeps the payload
/// stable and lets a consumer group it however it likes.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct InstanceLock {
    pub instance_id: i64,
    pub difficulty_id: i64,
    pub name: Option<String>,
    /// Bosses defeated this lockout.
    pub progress: Option<i64>,
    /// Total encounters in the instance.
    pub total: Option<i64>,
    /// Server-time epoch the lockout resets at.
    pub reset: Option<i64>,
    pub extended: Option<bool>,
    pub is_raid: Option<bool>,
}

/// A character's weekly-reset state, from the addon's `weeklies` broker.
///
/// Every field is independently optional: the Great Vault is a max-level feature, a character can
/// hold no keystone, and a levelling alt has none of it.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WarbandWeekly {
    pub vault: Option<VaultTracks>,
    /// A vault reward sitting uncollected — the actionable signal a vault board exists to surface.
    pub has_unclaimed_vault: Option<bool>,
    /// Level of the Mythic+ keystone the character is holding.
    pub keystone_level: Option<i64>,
    /// Challenge-map id of that keystone's dungeon; the name is resolved by the consumer.
    pub keystone_map: Option<i64>,
    /// Mythic+ runs completed this week, against the vault's top threshold.
    pub dungeons_done: Option<i64>,
    pub dungeons_max: Option<i64>,
}

/// One player title: its `titleMaskID` and display name.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Title {
    pub id: i64,
    pub name: String,
}

/// A character's titles, from the addon's `titles` broker.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CharacterTitles {
    /// Earned titles, sorted by name so the payload is stable across reads.
    pub known: Vec<Title>,
    /// The featured title's id, and its display name. Both absent when none is active.
    pub current: Option<i64>,
    pub current_name: Option<String>,
}

/// The account-wide title catalog — every player title the game knows, earned or not.
///
/// The reason this is worth reading at all: an earned list can't tell you what's *missing*, and
/// Blizzard's REST API has no title catalogue to diff against. The addon scans the full range
/// without the "is it known" gate precisely so an offline reader can compute the unearned set.
///
/// `locale` matters because names follow the game client's language, not the app's.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TitleCatalog {
    /// Every catalogued title, sorted by name.
    pub titles: Vec<Title>,
    pub locale: Option<String>,
    /// The addon's own count of what it scanned — a cross-check against `titles.len()`.
    pub count: Option<i64>,
    pub scanned_at: Option<i64>,
    /// Which character produced the scan. Titles are account-wide, so one scan serves the warband.
    pub scanned_by: Option<String>,
}

/// A character's mailbox snapshot, from the addon's `mail` broker (its schema v20).
///
/// **Only written when the player opens a mailbox**, so `scanned_at` here can trail the character's
/// `last_refresh` by weeks. That is the whole reason this block carries its own timestamp: an
/// "expires in 2 days" derived from a month-old scan isn't merely stale, it's wrong, so every mail
/// claim must be dated by this block rather than the character-level anchor.
///
/// `has_mail` is the exception worth calling out — it comes from `HasNewMail()`, which the client
/// keeps current *without* a mailbox visit, so it stays trustworthy when `count`/`expiries` have
/// gone stale. All amounts are copper.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WarbandMail {
    /// Server time this block was last written (a mailbox was opened) — its own freshness anchor.
    pub scanned_at: Option<i64>,
    /// Messages in the mailbox at the scan. `None` when unwritten; `Some(0)` is a real empty box —
    /// the distinction a consumer needs, so it's never collapsed to a bare zero.
    pub count: Option<i64>,
    /// Absolute server-time expiry epochs, ascending as the addon writes them. Empty when nothing is
    /// expiring (the common live shape) — an empty list, never absent-as-zero.
    pub expiries: Vec<i64>,
    /// Attached gold summed across the mailbox, in copper.
    pub money: Option<i64>,
    /// `HasNewMail()` — true while unread mail waits. Maintained without opening a mailbox, so it's
    /// trustworthy even when the counts above have gone stale.
    pub has_mail: Option<bool>,
}

/// A character's own posted auctions, from the addon's `auctions` broker (its schema v22).
///
/// Same freshness caveat as [`WarbandMail`]: only written when the auction house is opened, so
/// `scanned_at` is this block's own anchor rather than the character's `last_refresh`. All amounts
/// are copper.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WarbandAuctions {
    /// Server time this block was last written (the AH was opened) — its own freshness anchor.
    pub scanned_at: Option<i64>,
    /// Active auctions posted by this character. `None` when unwritten; `Some(0)` is a real none.
    pub count: Option<i64>,
    /// Absolute server-time expiry epochs, ascending as the addon writes them. Empty when none.
    pub expiries: Vec<i64>,
    /// Gold tied up in active auctions (buyout/bid), in copper.
    pub value: Option<i64>,
}

/// One character extracted from `WarbandeerCharDB.characters[name]`. Most fields are
/// optional — not every alt has every field populated.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WarbandCharacter {
    pub name: String,
    pub realm: String,
    pub guid: Option<String>,
    pub class_id: Option<i64>,
    /// Blizzard class file key, e.g. `DeathKnight` — drives the class colour in the UI.
    pub class_key: Option<String>,
    pub class_name: Option<String>,
    pub level: Option<i64>,
    /// Equipped item level (`equipment.ilvl`, falling back to the top-level `ilvl`).
    pub item_level: Option<i64>,
    pub spec: Option<String>,
    pub role: Option<String>,
    pub profession_primary: Option<String>,
    pub profession_secondary: Option<String>,
    pub guild: Option<String>,
    pub faction: Option<String>,
    /// Server time of the last completed scan of this character (the addon's `lastRefresh`).
    ///
    /// The freshness anchor for everything else here: SavedVariables is only written when the game
    /// writes it, so comparing this against the current weekly reset is what distinguishes "this
    /// character did nothing this week" from "this character hasn't been played since the reset".
    pub last_refresh: Option<i64>,
    /// This character's own gold in copper (`currency.gold`), promoted out of the currency map
    /// because it's money rather than a catalogued currency and has no static-data entry.
    pub gold: Option<i64>,
    /// Every other currency the addon recorded, sorted by key so the payload is stable across
    /// reads (the underlying Lua table has no order).
    pub currencies: Vec<WarbandCurrency>,
    /// Weekly-reset state (Great Vault, keystone, M+ count). `None` when the addon recorded none —
    /// which for a levelling character is the normal case, not an error.
    pub weekly: Option<WarbandWeekly>,
    /// Instance lockouts, sorted by instance then difficulty so the payload is stable across reads.
    pub locks: Vec<InstanceLock>,
    /// Earned titles and the featured one. `None` for a character the addon hasn't seen since it
    /// began recording titles.
    pub titles: Option<CharacterTitles>,
    /// The mailbox snapshot. `None` until the character has opened a mailbox — distinct from an empty
    /// mailbox, which is a present block with `count: Some(0)`.
    pub mail: Option<WarbandMail>,
    /// Posted-auctions snapshot. `None` until the character has opened the auction house — distinct
    /// from having none posted, which is a present block with `count: Some(0)`.
    pub auctions: Option<WarbandAuctions>,
}

/// Result of a warband read: which account/file it came from, the characters, and account-wide wealth.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WarbandData {
    pub account: String,
    pub source: String,
    pub characters: Vec<WarbandCharacter>,
    /// `None` when the file predates the addon's account-wide wealth tracking (its schema v8).
    pub wealth: Option<WarbandWealth>,
    /// The account-wide title catalog. `None` on a file written before the addon began scanning it.
    pub title_catalog: Option<TitleCatalog>,
}

// --- Raw deserialize model -------------------------------------------------
//
// A faithful mirror of the on-disk `characters[name]` table shape, deserialized
// straight off the Lua value via `LuaSerdeExt::from_value`. Every field is
// `Option<_>` (a missing key becomes `None`; unmodelled keys are ignored), and
// **every numeric is `f64`**: WoW's Lua has no separate integer subtype, so a cell
// can hold any double. serde's float visitor also accepts integer visits, making
// `f64` total for every numeric cell — we cast to `i64` only when building the
// public `WarbandCharacter` payload below.

#[derive(Debug, Deserialize)]
struct RawCharacter {
    name: Option<String>,
    realm: Option<String>,
    guid: Option<String>,
    #[serde(rename = "classId")]
    class_id: Option<f64>,
    #[serde(rename = "classKey")]
    class_key: Option<String>,
    #[serde(rename = "className")]
    class_name: Option<String>,
    #[serde(rename = "isAlliance")]
    is_alliance: Option<bool>,
    guild: Option<String>,
    #[serde(rename = "lastRefresh")]
    last_refresh: Option<f64>,
    ilvl: Option<f64>,
    basic: Option<RawBasic>,
    equipment: Option<RawEquipment>,
    currency: Option<HashMap<String, RawCurrency>>,
    // `weeklies` and `instances` are deliberately absent here — see `sub_tree` in the parse loop.
}

#[derive(Debug, Deserialize)]
struct RawBasic {
    level: Option<f64>,
    specialization: Option<RawSpec>,
    professions: Option<RawProfessions>,
}

#[derive(Debug, Deserialize)]
struct RawSpec {
    active: Option<String>,
    key: Option<String>,
    role: Option<String>,
}

#[derive(Debug, Deserialize)]
struct RawProfessions {
    primary: Option<RawProfession>,
    secondary: Option<RawProfession>,
}

#[derive(Debug, Deserialize)]
struct RawProfession {
    name: Option<String>,
}

#[derive(Debug, Deserialize)]
struct RawEquipment {
    ilvl: Option<f64>,
}

/// A single `currency` cell. The addon writes either a bare quantity or a detail table, and a cell
/// left over from an older addon version can be the *other* shape than the current code writes
/// (`NebulousVoidcore` is the documented case), so both are accepted.
///
/// `Unknown` is the safety net and the reason this can't regress the existing read: variants are
/// tried in order, and `IgnoredAny` accepts anything at all. Without it, one unexpected cell would
/// fail the whole character's `from_value` and make a previously-visible character disappear.
#[derive(Debug, Deserialize)]
#[serde(untagged)]
enum RawCurrency {
    Amount(f64),
    Detail(RawCurrencyDetail),
    Unknown(serde::de::IgnoredAny),
}

#[derive(Debug, Deserialize)]
struct RawCurrencyDetail {
    quantity: Option<f64>,
    earned: Option<f64>,
    max: Option<f64>,
    #[serde(rename = "weeklyMax")]
    weekly_max: Option<f64>,
    capped: Option<bool>,
}

/// Deserialize `T`, or absorb any shape that doesn't fit instead of failing the enclosing struct.
///
/// The same guarantee `RawCurrency::Unknown` gives, generalised — used for leaf values inside a
/// sub-tree, so one bad entry costs only itself.
///
/// **Only for string-keyed tables.** Being untagged, this buffers through `deserialize_any`, and
/// mlua renders a Lua table whose keys are a contiguous run from 1 as a *sequence* — so a map with
/// integer keys wrapped in this fails to deserialize as a map. That's why the `instances` tree is
/// read via `sub_tree` rather than wrapped here.
#[derive(Debug, Deserialize)]
#[serde(untagged)]
enum Maybe<T> {
    Parsed(T),
    Unknown(serde::de::IgnoredAny),
}

impl<T> Maybe<T> {
    fn parsed(self) -> Option<T> {
        match self {
            Maybe::Parsed(v) => Some(v),
            Maybe::Unknown(_) => None,
        }
    }
}

/// `characters[name].weeklies` — the addon's weekly-reset broker.
#[derive(Debug, Deserialize)]
struct RawWeeklies {
    #[serde(rename = "vaultSlots")]
    vault_slots: Option<Maybe<RawVaultTracks>>,
    #[serde(rename = "hasUnclaimedVault")]
    has_unclaimed_vault: Option<bool>,
    keystone: Option<f64>,
    #[serde(rename = "keystoneMap")]
    keystone_map: Option<f64>,
    dungeons: Option<Maybe<RawDungeons>>,
}

/// Track names are capitalised in the addon's own output (`SummarizeVaultSlots` keys).
#[derive(Debug, Deserialize)]
struct RawVaultTracks {
    #[serde(rename = "Raid")]
    raid: Option<Vec<RawVaultSlot>>,
    #[serde(rename = "Dungeons")]
    dungeons: Option<Vec<RawVaultSlot>>,
    #[serde(rename = "World")]
    world: Option<Vec<RawVaultSlot>>,
}

#[derive(Debug, Deserialize)]
struct RawVaultSlot {
    threshold: Option<f64>,
    progress: Option<f64>,
    complete: Option<bool>,
    ilvl: Option<f64>,
}

#[derive(Debug, Deserialize)]
struct RawDungeons {
    done: Option<f64>,
    max: Option<f64>,
}

/// `characters[name].instances` — the lockout broker.
#[derive(Debug, Deserialize)]
struct RawInstances {
    /// Keyed `[instanceId][difficultyId]`. Both levels are integer Lua keys.
    locks: Option<HashMap<i64, HashMap<i64, Maybe<RawLock>>>>,
}

#[derive(Debug, Deserialize)]
struct RawLock {
    name: Option<String>,
    total: Option<f64>,
    progress: Option<f64>,
    reset: Option<f64>,
    extended: Option<bool>,
    #[serde(rename = "isRaid")]
    is_raid: Option<bool>,
}

/// `characters[name].titles` — the addon's per-character titles broker.
#[derive(Debug, Deserialize)]
struct RawCharacterTitles {
    known: Option<Vec<RawTitle>>,
    current: Option<f64>,
    #[serde(rename = "currentName")]
    current_name: Option<String>,
}

#[derive(Debug, Deserialize)]
struct RawTitle {
    id: Option<f64>,
    name: Option<String>,
}

/// `characters[name].mail` — the addon's mailbox broker (its schema v20).
#[derive(Debug, Deserialize)]
struct RawMail {
    #[serde(rename = "scannedAt")]
    scanned_at: Option<f64>,
    count: Option<f64>,
    /// A Lua array. Read via `sub_tree` (a direct `from_value`, not an untagged wrapper) so it
    /// deserializes through `deserialize_seq` — which makes an empty `expiries` table an empty
    /// sequence rather than a parse failure.
    expiries: Option<Vec<f64>>,
    money: Option<f64>,
    #[serde(rename = "hasMail")]
    has_mail: Option<bool>,
}

/// `characters[name].auctions` — the addon's posted-auctions broker (its schema v22).
#[derive(Debug, Deserialize)]
struct RawAuctions {
    #[serde(rename = "scannedAt")]
    scanned_at: Option<f64>,
    count: Option<f64>,
    expiries: Option<Vec<f64>>,
    value: Option<f64>,
}

/// `WarbandeerCharDB.titleCatalog` — account-wide, so it sits beside `characters`.
#[derive(Debug, Deserialize)]
struct RawTitleCatalog {
    /// Keyed by `titleMaskID`.
    ///
    /// This table is a Lua **array/map hybrid**: ids form a contiguous run from 1 (written as bare
    /// array values) with several dozen sparse high ids written as explicit `[id] = name` pairs.
    /// Deserializing it as a sequence would silently keep only the array part and drop the sparse
    /// tail, so it is read as a map — which `pairs()` fills from both halves. That's also why the
    /// catalog is read through `sub_tree` rather than an untagged wrapper: untagged buffers through
    /// `deserialize_any`, where mlua would resolve the leading run to a sequence.
    names: Option<HashMap<i64, String>>,
    locale: Option<String>,
    count: Option<f64>,
    #[serde(rename = "scannedAt")]
    scanned_at: Option<f64>,
    #[serde(rename = "scannedBy")]
    scanned_by: Option<String>,
}

/// `WarbandeerCharDB.warband` — account-wide, so it sits beside `characters` rather than inside it.
#[derive(Debug, Deserialize)]
struct RawWarband {
    #[serde(rename = "bankGold")]
    bank_gold: Option<f64>,
    week: Option<RawWeek>,
    history: Option<Vec<RawWeek>>,
}

#[derive(Debug, Deserialize)]
struct RawWeek {
    start: Option<f64>,
    baseline: Option<f64>,
    ending: Option<f64>,
    made: Option<f64>,
}

/// Fold a deserialized `RawCharacter` into the flat public payload, applying the
/// fallbacks the file shape doesn't encode and casting numerics to `i64` here — at
/// the payload edge — rather than at deserialize time.
/// The optional sub-trees read separately from a character entry, rather than as `RawCharacter`
/// fields — see the parse loop for why.
struct CharacterSubTrees {
    weekly: Option<WarbandWeekly>,
    locks: Vec<InstanceLock>,
    titles: Option<CharacterTitles>,
    mail: Option<WarbandMail>,
    auctions: Option<WarbandAuctions>,
}

fn build_character(
    name_key: String,
    raw: RawCharacter,
    subs: CharacterSubTrees,
) -> WarbandCharacter {
    let RawCharacter {
        name,
        realm,
        guid,
        class_id,
        class_key,
        class_name,
        is_alliance,
        guild,
        last_refresh,
        ilvl,
        basic,
        equipment,
        currency,
    } = raw;

    let (gold, currencies) = split_currency(currency);

    let (level, spec, professions) = match basic {
        Some(b) => (b.level, b.specialization, b.professions),
        None => (None, None, None),
    };
    let (spec_active, spec_key, role) = match spec {
        Some(s) => (s.active, s.key, s.role),
        None => (None, None, None),
    };
    let (profession_primary, profession_secondary) = match professions {
        Some(p) => (
            p.primary.and_then(|x| x.name),
            p.secondary.and_then(|x| x.name),
        ),
        None => (None, None),
    };

    WarbandCharacter {
        // Prefer a non-empty in-entry name, else fall back to the table key.
        name: name.filter(|s| !s.is_empty()).unwrap_or(name_key),
        realm: realm.unwrap_or_default(),
        guid,
        class_id: class_id.map(|n| n as i64),
        class_key,
        class_name,
        level: level.map(|n| n as i64),
        // equipment.ilvl wins over the top-level ilvl.
        item_level: equipment.and_then(|e| e.ilvl).or(ilvl).map(|n| n as i64),
        // specialization.active wins over specialization.key.
        spec: spec_active.or(spec_key),
        role,
        profession_primary,
        profession_secondary,
        guild,
        faction: is_alliance.map(|a| if a { "Alliance" } else { "Horde" }.to_string()),
        last_refresh: last_refresh.map(|n| n as i64),
        gold,
        currencies,
        weekly: subs.weekly,
        locks: subs.locks,
        titles: subs.titles,
        mail: subs.mail,
        auctions: subs.auctions,
    }
}

/// Fold the raw per-character titles broker into the public payload.
///
/// Sorted by name because the earned list is browsed rather than indexed, and the addon's own order
/// is its scan order. Entries missing an id or a name are dropped: a title that can't be identified
/// or can't be shown is not something a consumer can do anything with.
fn build_titles(raw: RawCharacterTitles) -> CharacterTitles {
    let mut known: Vec<Title> = raw
        .known
        .unwrap_or_default()
        .into_iter()
        .filter_map(|t| {
            Some(Title {
                id: t.id? as i64,
                name: t.name?,
            })
        })
        .collect();
    known.sort_by(|a, b| a.name.cmp(&b.name));

    CharacterTitles {
        known,
        current: raw.current.map(|n| n as i64),
        current_name: raw.current_name,
    }
}

/// Fold the raw `mail` broker into the public payload.
///
/// Expiries pass through in the addon's ascending order (like the vault slots and wealth history),
/// and a missing list becomes an empty one — so a present block always reports a list, never a nil.
fn build_mail(raw: RawMail) -> WarbandMail {
    WarbandMail {
        scanned_at: raw.scanned_at.map(|n| n as i64),
        count: raw.count.map(|n| n as i64),
        expiries: raw
            .expiries
            .unwrap_or_default()
            .into_iter()
            .map(|n| n as i64)
            .collect(),
        money: raw.money.map(|n| n as i64),
        has_mail: raw.has_mail,
    }
}

/// Fold the raw `auctions` broker into the public payload. Same expiry handling as [`build_mail`].
fn build_auctions(raw: RawAuctions) -> WarbandAuctions {
    WarbandAuctions {
        scanned_at: raw.scanned_at.map(|n| n as i64),
        count: raw.count.map(|n| n as i64),
        expiries: raw
            .expiries
            .unwrap_or_default()
            .into_iter()
            .map(|n| n as i64)
            .collect(),
        value: raw.value.map(|n| n as i64),
    }
}

/// Fold the raw account-wide catalog into the public payload.
fn build_title_catalog(raw: RawTitleCatalog) -> TitleCatalog {
    let mut titles: Vec<Title> = raw
        .names
        .unwrap_or_default()
        .into_iter()
        .map(|(id, name)| Title { id, name })
        .collect();
    // The source is a hash table, so iteration order is arbitrary; sort for a stable payload.
    titles.sort_by(|a, b| a.name.cmp(&b.name).then(a.id.cmp(&b.id)));

    TitleCatalog {
        titles,
        locale: raw.locale,
        count: raw.count.map(|n| n as i64),
        scanned_at: raw.scanned_at.map(|n| n as i64),
        scanned_by: raw.scanned_by,
    }
}

/// Read one optional sub-table off a character entry, yielding `None` if it's missing or a shape we
/// don't recognise. Isolating each sub-tree this way is what keeps a malformed section from costing
/// the whole character, since `from_value` over a character entry is all-or-nothing.
fn sub_tree<T: serde::de::DeserializeOwned>(lua: &Lua, entry: &Table, key: &str) -> Option<T> {
    entry
        .get::<Value>(key)
        .ok()
        .and_then(|v| lua.from_value::<T>(v).ok())
}

/// Fold the raw `weeklies` broker into the public weekly payload.
fn build_weekly(raw: RawWeeklies) -> WarbandWeekly {
    let slot = |s: RawVaultSlot| VaultSlot {
        threshold: s.threshold.unwrap_or(0.0) as i64,
        progress: s.progress.unwrap_or(0.0) as i64,
        // The addon writes `complete`, but derive it when absent rather than defaulting to false —
        // a slot reported as locked when it's actually earned is the one wrong answer that matters.
        complete: s
            .complete
            .unwrap_or_else(|| s.progress.unwrap_or(0.0) >= s.threshold.unwrap_or(f64::INFINITY)),
        ilvl: s.ilvl.map(|n| n as i64),
    };
    let track =
        |t: Option<Vec<RawVaultSlot>>| t.unwrap_or_default().into_iter().map(slot).collect();

    let vault = raw
        .vault_slots
        .and_then(Maybe::parsed)
        .map(|t| VaultTracks {
            raid: track(t.raid),
            dungeons: track(t.dungeons),
            world: track(t.world),
        });
    let dungeons = raw.dungeons.and_then(Maybe::parsed);

    WarbandWeekly {
        vault,
        has_unclaimed_vault: raw.has_unclaimed_vault,
        keystone_level: raw.keystone.map(|n| n as i64),
        keystone_map: raw.keystone_map.map(|n| n as i64),
        dungeons_done: dungeons.as_ref().and_then(|d| d.done).map(|n| n as i64),
        dungeons_max: dungeons.as_ref().and_then(|d| d.max).map(|n| n as i64),
    }
}

/// Flatten `instances.locks[instanceId][difficultyId]` into a sorted list.
///
/// Sorted by instance then difficulty because the source is a pair of Lua hash tables whose
/// iteration order is arbitrary — without this the list would reshuffle between reads.
fn build_locks(instances: Option<RawInstances>) -> Vec<InstanceLock> {
    let Some(locks) = instances.and_then(|i| i.locks) else {
        return Vec::new();
    };

    let mut out = Vec::new();
    for (instance_id, by_difficulty) in locks {
        for (difficulty_id, lock) in by_difficulty {
            // An unreadable lock is skipped; the rest of the character's lockouts still come through.
            let Some(lock) = lock.parsed() else { continue };
            out.push(InstanceLock {
                instance_id,
                difficulty_id,
                name: lock.name,
                progress: lock.progress.map(|n| n as i64),
                total: lock.total.map(|n| n as i64),
                reset: lock.reset.map(|n| n as i64),
                extended: lock.extended,
                is_raid: lock.is_raid,
            });
        }
    }
    out.sort_by_key(|l| (l.instance_id, l.difficulty_id));
    out
}

/// Split a raw `currency` table into this character's gold and its other currencies.
///
/// `gold` is lifted out because it's money, not a catalogued currency — it has no static-data entry
/// and every consumer wants it on its own. Cells that parsed as `Unknown` are dropped here rather
/// than rendered as a zero, so an unreadable cell reads as "not captured" rather than "you have none".
/// The result is sorted by key: the source is a Lua hash table, so iteration order is arbitrary and
/// an unsorted payload would reshuffle between reads.
fn split_currency(
    currency: Option<HashMap<String, RawCurrency>>,
) -> (Option<i64>, Vec<WarbandCurrency>) {
    let Some(map) = currency else {
        return (None, Vec::new());
    };

    let mut gold = None;
    let mut out = Vec::new();
    for (key, value) in map {
        let detail = match value {
            RawCurrency::Amount(n) => {
                if key == "gold" {
                    gold = Some(n as i64);
                    continue;
                }
                WarbandCurrency {
                    key,
                    quantity: n as i64,
                    earned: None,
                    max: None,
                    weekly_max: None,
                    capped: None,
                }
            }
            RawCurrency::Detail(d) => {
                // `gold` is only ever a bare number, so a table under that key is unexpected; skip it
                // rather than inventing a gold figure out of a `quantity` that may not mean gold.
                if key == "gold" {
                    continue;
                }
                WarbandCurrency {
                    key,
                    quantity: d.quantity.unwrap_or(0.0) as i64,
                    earned: d.earned.map(|n| n as i64),
                    max: d.max.map(|n| n as i64),
                    weekly_max: d.weekly_max.map(|n| n as i64),
                    capped: d.capped,
                }
            }
            RawCurrency::Unknown(_) => continue,
        };
        out.push(detail);
    }
    out.sort_by(|a, b| a.key.cmp(&b.key));
    (gold, out)
}

/// Fold the raw `warband` table into the public wealth payload.
fn build_wealth(raw: RawWarband) -> WarbandWealth {
    let week = |w: RawWeek| WarbandWeek {
        start: w.start.map(|n| n as i64),
        baseline: w.baseline.map(|n| n as i64),
        ending: w.ending.map(|n| n as i64),
        made: w.made.map(|n| n as i64),
    };
    WarbandWealth {
        bank_gold: raw.bank_gold.map(|n| n as i64),
        week: raw.week.map(week),
        history: raw
            .history
            .unwrap_or_default()
            .into_iter()
            .map(week)
            .collect(),
    }
}

/// Everything read out of one SavedVariables file, before the account/source labels are attached.
struct ParsedDb {
    characters: Vec<WarbandCharacter>,
    wealth: Option<WarbandWealth>,
    title_catalog: Option<TitleCatalog>,
}

/// Parse a `Warbandeer_Characters.lua` body into a name-sorted character list plus account-wide wealth.
fn parse_from_lua(content: &str) -> Result<ParsedDb, String> {
    let lua = Lua::new();
    // Load the chunk into an *empty* environment: the file can assign its data table
    // but can't reach any Lua stdlib. The global is then read back from that env,
    // never from `lua.globals()`.
    let env = lua.create_table().map_err(|e| e.to_string())?;
    lua.load(content)
        .set_name("Warbandeer_Characters.lua")
        .set_environment(env.clone())
        .exec()
        .map_err(|e| format!("Lua parse error: {e}"))?;

    let db: Table = env
        .get("WarbandeerCharDB")
        .map_err(|_| "WarbandeerCharDB not found in the file".to_string())?;
    let characters: Table = db
        .get("characters")
        .map_err(|_| "WarbandeerCharDB has no `characters` table".to_string())?;

    let mut out = Vec::new();
    // Deserialize each character on its own: `.flatten()` skips an unreadable pair,
    // and `from_value` failing on one malformed entry drops just that character
    // rather than failing the whole read.
    for (name_key, value) in characters.pairs::<String, Value>().flatten() {
        let Ok(raw) = lua.from_value::<RawCharacter>(value.clone()) else {
            continue;
        };
        // The `weeklies` and `instances` sub-trees are read separately rather than as fields of
        // `RawCharacter`, for two reasons: a shape we don't recognise then costs only its own
        // section instead of the whole character, and each deserializes directly (no untagged
        // buffering), which is what lets `instances.locks` come through as an integer-keyed map.
        let subs = match value.as_table() {
            Some(t) => CharacterSubTrees {
                weekly: sub_tree::<RawWeeklies>(&lua, t, "weeklies").map(build_weekly),
                locks: build_locks(sub_tree::<RawInstances>(&lua, t, "instances")),
                titles: sub_tree::<RawCharacterTitles>(&lua, t, "titles").map(build_titles),
                // `mail` and `auctions` are only written when the player opens a mailbox / the AH, so
                // each carries its own `scannedAt`; read via `sub_tree` for the same reason as the
                // others — a shape we don't recognise costs its own section, not the character.
                mail: sub_tree::<RawMail>(&lua, t, "mail").map(build_mail),
                auctions: sub_tree::<RawAuctions>(&lua, t, "auctions").map(build_auctions),
            },
            None => CharacterSubTrees {
                weekly: None,
                locks: Vec::new(),
                titles: None,
                mail: None,
                auctions: None,
            },
        };
        out.push(build_character(name_key, raw, subs));
    }
    out.sort_by_key(|c| c.name.to_lowercase());

    // Account-wide wealth is best-effort on purpose: it arrived in the addon's schema v8, so an
    // older file simply has no `warband` key, and a shape we don't recognise must not cost us the
    // characters we just read. Both cases collapse to `None`.
    let wealth = db
        .get::<Value>("warband")
        .ok()
        .and_then(|v| lua.from_value::<RawWarband>(v).ok())
        .map(build_wealth);

    // Account-wide like `warband`, and read the same best-effort way — see RawTitleCatalog for why
    // it must not go through an untagged wrapper.
    let title_catalog = db
        .get::<Value>("titleCatalog")
        .ok()
        .and_then(|v| lua.from_value::<RawTitleCatalog>(v).ok())
        .map(build_title_catalog);

    Ok(ParsedDb {
        characters: out,
        wealth,
        title_catalog,
    })
}

/// Candidate WoW install roots to probe (registry-free — covers the common cases).
fn candidate_roots() -> Vec<PathBuf> {
    let subs = [
        r"\Program Files (x86)\World of Warcraft",
        r"\Program Files\World of Warcraft",
        r"\World of Warcraft",
        r"\Games\World of Warcraft",
    ];
    let mut roots = Vec::new();
    for drive in ["C:", "D:", "E:", "F:"] {
        for sub in subs {
            roots.push(PathBuf::from(format!("{drive}{sub}")));
        }
    }
    roots
}

/// All `Warbandeer_Characters.lua` files found under any client version / account,
/// paired with the account-folder name (e.g. `TESTACCOUNT`).
fn find_sv_files() -> Vec<(PathBuf, String)> {
    let mut out = Vec::new();
    for root in candidate_roots() {
        let Ok(versions) = std::fs::read_dir(&root) else {
            continue;
        };
        for version in versions.flatten() {
            // <root>/_retail_/WTF/Account
            let accounts_dir = version.path().join("WTF").join("Account");
            let Ok(accounts) = std::fs::read_dir(&accounts_dir) else {
                continue;
            };
            for account in accounts.flatten() {
                let sv = account
                    .path()
                    .join("SavedVariables")
                    .join("Warbandeer_Characters.lua");
                if sv.is_file() {
                    let name = account.file_name().to_string_lossy().into_owned();
                    out.push((sv, name));
                }
            }
        }
    }
    out
}

/// The most-recently-written `Warbandeer_Characters.lua` (the actively-played account).
fn find_sv_file() -> Result<(PathBuf, String), String> {
    let mut files = find_sv_files();
    if files.is_empty() {
        return Err(
            "Could not find Warbandeer_Characters.lua. Is the Warbandeer_Characters \
                    addon installed, and have you logged in since installing it?"
                .to_string(),
        );
    }
    files.sort_by_key(|(p, _)| std::fs::metadata(p).and_then(|m| m.modified()).ok());
    Ok(files.pop().expect("non-empty"))
}

/// Locate, read, and parse the newest Warbandeer SavedVariables file.
#[tauri::command]
pub fn get_warband() -> Result<WarbandData, String> {
    let (path, account) = find_sv_file()?;
    let content =
        std::fs::read_to_string(&path).map_err(|e| format!("reading {}: {e}", path.display()))?;
    let parsed = parse_from_lua(&content)?;
    Ok(WarbandData {
        account,
        source: path.to_string_lossy().into_owned(),
        characters: parsed.characters,
        wealth: parsed.wealth,
        title_catalog: parsed.title_catalog,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    const FIXTURE: &str = r#"
        WarbandeerCharDB = {
          ["numCharacters"] = 2,
          ["characters"] = {
            ["Testchar"] = {
              ["name"] = "Testchar",
              ["realm"] = "Testrealm",
              ["guid"] = "Player-0-00000000",
              ["classId"] = 6,
              ["classKey"] = "DeathKnight",
              ["className"] = "Death Knight",
              ["isAlliance"] = true,
              ["guild"] = "Test Guild",
              ["lastRefresh"] = 1785200000,
              ["ilvl"] = 644,
              ["basic"] = {
                ["level"] = 90,
                ["specialization"] = { ["active"] = "Unholy", ["role"] = "DAMAGER" },
                ["professions"] = {
                  ["primary"] = { ["name"] = "Blacksmithing" },
                  ["secondary"] = { ["name"] = "Mining" },
                },
              },
              ["equipment"] = { ["ilvl"] = 278 },
              ["currency"] = {
                ["gold"] = 12345678,
                -- bare-number form
                ["RestoredCofferKey"] = 3,
                -- detail form, weekly-capped
                ["HeroDawncrest"] = {
                  ["quantity"] = 40, ["earned"] = 12, ["max"] = 100, ["capped"] = false,
                },
                -- detail form carrying both a hold cap and a weekly earn cap
                ["ShardOfDundun"] = {
                  ["quantity"] = 8, ["earned"] = 8, ["max"] = 8, ["weeklyMax"] = 8,
                  ["capped"] = true,
                },
              },
              ["weeklies"] = {
                ["hasUnclaimedVault"] = true,
                ["keystone"] = 12,
                ["keystoneMap"] = 507,
                ["dungeons"] = { ["done"] = 5, ["max"] = 8 },
                ["vaultSlots"] = {
                  ["Raid"] = {
                    { ["threshold"] = 2, ["progress"] = 6, ["complete"] = true, ["ilvl"] = 723 },
                    { ["threshold"] = 4, ["progress"] = 6, ["complete"] = true, ["ilvl"] = 726 },
                    { ["threshold"] = 6, ["progress"] = 6, ["complete"] = true, ["ilvl"] = 730 },
                  },
                  ["Dungeons"] = {
                    { ["threshold"] = 1, ["progress"] = 5, ["complete"] = true, ["ilvl"] = 720 },
                    { ["threshold"] = 4, ["progress"] = 5, ["complete"] = true, ["ilvl"] = 723 },
                    -- locked: no reward ilvl resolved
                    { ["threshold"] = 8, ["progress"] = 5, ["complete"] = false },
                  },
                },
              },
              ["titles"] = {
                ["current"] = 284,
                ["currentName"] = "Conservationist",
                ["known"] = {
                  { ["id"] = 474, ["name"] = "Ally of Dragons" },
                  { ["id"] = 284, ["name"] = "Conservationist" },
                  -- no name: unusable, so dropped
                  { ["id"] = 999 },
                },
              },
              -- Integer-keyed both levels: [instanceID][difficultyID]
              ["instances"] = {
                ["locks"] = {
                  [2810] = {
                    [16] = {
                      ["name"] = "Venomous Abyss", ["total"] = 8, ["progress"] = 3,
                      ["reset"] = 1785769200, ["extended"] = false, ["isRaid"] = true,
                    },
                    [14] = {
                      ["name"] = "Venomous Abyss", ["total"] = 8, ["progress"] = 8,
                      ["reset"] = 1785769200, ["isRaid"] = true,
                    },
                  },
                  [2649] = {
                    [23] = { ["name"] = "Altar of Fangs", ["total"] = 4, ["progress"] = 4 },
                  },
                },
              },
              -- Written only when a mailbox / the AH is opened, so each carries its own scannedAt,
              -- distinct from (and here older than) the character's lastRefresh of 1785200000.
              ["mail"] = {
                ["scannedAt"] = 1785100000,
                ["count"] = 3,
                ["money"] = 4560000,
                ["hasMail"] = true,
                ["expiries"] = { 1785500000, 1785600000, 1785900000 },
              },
              ["auctions"] = {
                ["scannedAt"] = 1785150000,
                ["count"] = 2,
                ["value"] = 250000000,
                ["expiries"] = { 1785400000, 1785800000 },
              },
            },
            ["Altchar"] = {
              ["realm"] = "Altrealm",
              ["classKey"] = "Warrior",
              ["basic"] = { ["level"] = 60 },
            },
          },
          -- The catalog's `names` table as the addon really writes it: a contiguous array part for
          -- the low ids, then explicit [id] = name pairs for the sparse high ones.
          ["titleCatalog"] = {
            ["locale"] = "enUS",
            ["scannedBy"] = "Testchar",
            ["scannedAt"] = 1785200000,
            ["count"] = 5,
            ["names"] = {
              "Private",           -- id 1
              "Corporal",          -- id 2
              [284] = "Conservationist",
              [474] = "Ally of Dragons",
              [743] = "the Explorer",
            },
          },
          ["warband"] = {
            ["bankGold"] = 987654321,
            ["week"] = { ["start"] = 1770000000, ["baseline"] = 900000000 },
            ["history"] = {
              { ["start"] = 1768800000, ["ending"] = 880000000, ["made"] = -20000000 },
              { ["start"] = 1769400000, ["ending"] = 900000000, ["made"] = 20000000 },
            },
          },
        }
    "#;

    #[test]
    fn parses_and_sorts_characters() {
        let chars = parse_from_lua(FIXTURE).expect("parse").characters;
        assert_eq!(chars.len(), 2);
        // Sorted case-insensitively by name: Altchar before Testchar.
        assert_eq!(chars[0].name, "Altchar");
        assert_eq!(chars[1].name, "Testchar");
    }

    #[test]
    fn extracts_nested_fields() {
        let chars = parse_from_lua(FIXTURE).expect("parse").characters;
        let k = chars
            .iter()
            .find(|c| c.name == "Testchar")
            .expect("Testchar");
        assert_eq!(k.realm, "Testrealm");
        assert_eq!(k.class_key.as_deref(), Some("DeathKnight"));
        assert_eq!(k.level, Some(90));
        // equipment.ilvl wins over the top-level ilvl.
        assert_eq!(k.item_level, Some(278));
        assert_eq!(k.spec.as_deref(), Some("Unholy"));
        assert_eq!(k.role.as_deref(), Some("DAMAGER"));
        assert_eq!(k.profession_primary.as_deref(), Some("Blacksmithing"));
        assert_eq!(k.profession_secondary.as_deref(), Some("Mining"));
        assert_eq!(k.faction.as_deref(), Some("Alliance"));
        // The freshness anchor: without it there's no way to tell an empty week from an unplayed one.
        assert_eq!(k.last_refresh, Some(1785200000));
    }

    #[test]
    fn falls_back_to_key_name_and_top_level_ilvl() {
        let chars = parse_from_lua(FIXTURE).expect("parse").characters;
        let b = chars
            .iter()
            .find(|c| c.realm == "Altrealm")
            .expect("Altchar");
        // name missing in the entry -> falls back to the table key.
        assert_eq!(b.name, "Altchar");
        assert_eq!(b.level, Some(60));
        assert_eq!(b.item_level, None);
    }

    // One entry has a string where a numeric cell is expected, so its per-character
    // `from_value` fails. The good entry must still render.
    const FIXTURE_MALFORMED: &str = r#"
        WarbandeerCharDB = {
          ["characters"] = {
            ["Good"] = { ["realm"] = "Testrealm", ["classKey"] = "Mage" },
            ["Broken"] = { ["realm"] = "Testrealm", ["classId"] = "not-a-number" },
          },
        }
    "#;

    #[test]
    fn skips_malformed_character_entry() {
        let chars = parse_from_lua(FIXTURE_MALFORMED).expect("parse").characters;
        // The broken entry is dropped, not fatal; the well-formed one survives.
        assert_eq!(chars.len(), 1);
        assert_eq!(chars[0].name, "Good");
        assert_eq!(chars[0].class_key.as_deref(), Some("Mage"));
    }

    // A fractional ilvl: the old `get_int`/`FromLua<i64>` path errored on the fraction
    // and silently yielded `None`; the f64-then-cast path keeps it.
    const FIXTURE_FRACTIONAL: &str = r#"
        WarbandeerCharDB = {
          ["characters"] = {
            ["Frac"] = {
              ["realm"] = "Testrealm",
              ["equipment"] = { ["ilvl"] = 445.5 },
              ["basic"] = { ["level"] = 70 },
            },
          },
        }
    "#;

    #[test]
    fn keeps_fractional_numeric_the_old_i64_path_dropped() {
        let chars = parse_from_lua(FIXTURE_FRACTIONAL)
            .expect("parse")
            .characters;
        assert_eq!(chars.len(), 1);
        // 445.5 deserializes as f64 and casts to 445 at the payload edge.
        assert_eq!(chars[0].item_level, Some(445));
        assert_eq!(chars[0].level, Some(70));
    }

    fn currency<'a>(c: &'a WarbandCharacter, key: &str) -> &'a WarbandCurrency {
        c.currencies
            .iter()
            .find(|x| x.key == key)
            .unwrap_or_else(|| panic!("currency {key} on {}", c.name))
    }

    #[test]
    fn promotes_gold_out_of_the_currency_table() {
        let chars = parse_from_lua(FIXTURE).expect("parse").characters;
        let k = chars
            .iter()
            .find(|c| c.name == "Testchar")
            .expect("Testchar");
        assert_eq!(k.gold, Some(12345678));
        // ...and `gold` is not left in the currency list, where it isn't a catalogued currency.
        assert!(k.currencies.iter().all(|c| c.key != "gold"));
    }

    #[test]
    fn reads_both_currency_shapes() {
        let chars = parse_from_lua(FIXTURE).expect("parse").characters;
        let k = chars
            .iter()
            .find(|c| c.name == "Testchar")
            .expect("Testchar");

        // Bare number: a quantity and nothing else.
        let bare = currency(k, "RestoredCofferKey");
        assert_eq!(bare.quantity, 3);
        assert_eq!(bare.earned, None);
        assert_eq!(bare.max, None);
        assert_eq!(bare.capped, None);

        // Detail table: the cap fields come through.
        let hero = currency(k, "HeroDawncrest");
        assert_eq!(hero.quantity, 40);
        assert_eq!(hero.earned, Some(12));
        assert_eq!(hero.max, Some(100));
        assert_eq!(hero.capped, Some(false));

        // Both cap kinds on one currency.
        let shard = currency(k, "ShardOfDundun");
        assert_eq!(shard.max, Some(8));
        assert_eq!(shard.weekly_max, Some(8));
        assert_eq!(shard.capped, Some(true));
    }

    #[test]
    fn sorts_currencies_by_key_so_the_payload_is_stable() {
        // The source is a Lua hash table with arbitrary iteration order, so without an explicit
        // sort the list would reshuffle between reads.
        let chars = parse_from_lua(FIXTURE).expect("parse").characters;
        let k = chars
            .iter()
            .find(|c| c.name == "Testchar")
            .expect("Testchar");
        let keys: Vec<&str> = k.currencies.iter().map(|c| c.key.as_str()).collect();
        assert_eq!(
            keys,
            ["HeroDawncrest", "RestoredCofferKey", "ShardOfDundun"]
        );
    }

    #[test]
    fn character_without_a_currency_table_reads_as_absent_not_zero() {
        let chars = parse_from_lua(FIXTURE).expect("parse").characters;
        let alt = chars.iter().find(|c| c.name == "Altchar").expect("Altchar");
        assert_eq!(alt.gold, None);
        assert!(alt.currencies.is_empty());
    }

    #[test]
    fn reads_account_wide_wealth() {
        let wealth = parse_from_lua(FIXTURE)
            .expect("parse")
            .wealth
            .expect("warband wealth");
        assert_eq!(wealth.bank_gold, Some(987654321));

        let week = wealth.week.expect("open week");
        assert_eq!(week.start, Some(1770000000));
        assert_eq!(week.baseline, Some(900000000));
        // An open week has no closing figures yet.
        assert_eq!(week.ending, None);
        assert_eq!(week.made, None);

        // History is oldest-first, and a losing week keeps its negative.
        assert_eq!(wealth.history.len(), 2);
        assert_eq!(wealth.history[0].made, Some(-20000000));
        assert_eq!(wealth.history[1].made, Some(20000000));
    }

    // A file from before the addon's schema v8, which introduced account-wide wealth tracking.
    const FIXTURE_NO_WARBAND: &str = r#"
        WarbandeerCharDB = {
          ["characters"] = { ["Solo"] = { ["realm"] = "Testrealm" } },
        }
    "#;

    #[test]
    fn missing_warband_table_yields_no_wealth_rather_than_failing() {
        let parsed = parse_from_lua(FIXTURE_NO_WARBAND).expect("parse");
        assert!(parsed.wealth.is_none());
        assert_eq!(parsed.characters.len(), 1);
    }

    // The regression this whole design guards against: an unreadable currency cell must not take
    // the character down with it. Before the `Unknown` catch-all, one bad cell would fail the
    // character's `from_value` and silently remove them from the warband.
    const FIXTURE_ODD_CURRENCY: &str = r#"
        WarbandeerCharDB = {
          ["characters"] = {
            ["Odd"] = {
              ["realm"] = "Testrealm",
              ["currency"] = {
                ["gold"] = 500,
                ["Weird"] = "not-a-currency",
                ["HeroDawncrest"] = { ["quantity"] = 7 },
              },
            },
          },
          ["warband"] = "not-a-table",
        }
    "#;

    #[test]
    fn an_unreadable_currency_cell_is_skipped_not_fatal() {
        let parsed = parse_from_lua(FIXTURE_ODD_CURRENCY).expect("parse");
        // The character survives...
        assert_eq!(parsed.characters.len(), 1);
        let c = &parsed.characters[0];
        // ...with the cells that *were* readable intact.
        assert_eq!(c.gold, Some(500));
        assert_eq!(currency(c, "HeroDawncrest").quantity, 7);
        // The unreadable cell is dropped rather than reported as a zero balance, which would read
        // as "you have none" instead of "this wasn't captured".
        assert!(c.currencies.iter().all(|x| x.key != "Weird"));
        // A malformed `warband` likewise costs only the wealth, not the read.
        assert!(parsed.wealth.is_none());
    }

    #[test]
    fn reads_the_great_vault_tracks() {
        let chars = parse_from_lua(FIXTURE).expect("parse").characters;
        let k = chars
            .iter()
            .find(|c| c.name == "Testchar")
            .expect("Testchar");
        let weekly = k.weekly.as_ref().expect("weekly");
        let vault = weekly.vault.as_ref().expect("vault");

        assert_eq!(vault.raid.len(), 3);
        assert_eq!(vault.raid[0].threshold, 2);
        assert_eq!(vault.raid[0].progress, 6);
        assert!(vault.raid[0].complete);
        assert_eq!(vault.raid[2].ilvl, Some(730));

        // A locked slot has no resolved reward item level — the addon only fills it once unlocked.
        let locked = &vault.dungeons[2];
        assert!(!locked.complete);
        assert_eq!(locked.ilvl, None);

        // A track with no progress comes back empty rather than absent, so all three render alike.
        assert!(vault.world.is_empty());
    }

    #[test]
    fn reads_the_keystone_and_weekly_counters() {
        let chars = parse_from_lua(FIXTURE).expect("parse").characters;
        let weekly = chars
            .iter()
            .find(|c| c.name == "Testchar")
            .expect("Testchar")
            .weekly
            .as_ref()
            .expect("weekly");
        assert_eq!(weekly.has_unclaimed_vault, Some(true));
        assert_eq!(weekly.keystone_level, Some(12));
        assert_eq!(weekly.keystone_map, Some(507));
        assert_eq!(weekly.dungeons_done, Some(5));
        assert_eq!(weekly.dungeons_max, Some(8));
    }

    #[test]
    fn flattens_integer_keyed_lockouts_and_sorts_them() {
        // The addon nests locks under two levels of *integer* Lua keys; this asserts both survive
        // the round trip as ids rather than being lost or reordered.
        let chars = parse_from_lua(FIXTURE).expect("parse").characters;
        let locks = &chars
            .iter()
            .find(|c| c.name == "Testchar")
            .expect("Testchar")
            .locks;

        assert_eq!(locks.len(), 3);
        // Sorted by instance then difficulty: 2649/23, then 2810/14, then 2810/16.
        let ids: Vec<(i64, i64)> = locks
            .iter()
            .map(|l| (l.instance_id, l.difficulty_id))
            .collect();
        assert_eq!(ids, [(2649, 23), (2810, 14), (2810, 16)]);

        let mythic = locks
            .iter()
            .find(|l| l.instance_id == 2810 && l.difficulty_id == 16)
            .expect("mythic lock");
        assert_eq!(mythic.name.as_deref(), Some("Venomous Abyss"));
        assert_eq!(mythic.progress, Some(3));
        assert_eq!(mythic.total, Some(8));
        assert_eq!(mythic.reset, Some(1785769200));
        assert_eq!(mythic.is_raid, Some(true));
        // Absent optional flags stay absent rather than becoming false.
        let normal = locks
            .iter()
            .find(|l| l.difficulty_id == 14)
            .expect("normal lock");
        assert_eq!(normal.extended, None);
    }

    #[test]
    fn a_levelling_character_has_no_weekly_state() {
        // The Great Vault is max-level only, so absent weekly data is the normal case for an alt.
        let chars = parse_from_lua(FIXTURE).expect("parse").characters;
        let alt = chars.iter().find(|c| c.name == "Altchar").expect("Altchar");
        assert!(alt.weekly.is_none());
        assert!(alt.locks.is_empty());
    }

    // `weeklies` and one lock entry are the wrong shape entirely.
    const FIXTURE_ODD_WEEKLY: &str = r#"
        WarbandeerCharDB = {
          ["characters"] = {
            ["Odd"] = {
              ["realm"] = "Testrealm",
              ["weeklies"] = "not-a-table",
              ["instances"] = {
                ["locks"] = {
                  [1] = {
                    [16] = "not-a-lock",
                    [14] = { ["name"] = "Readable", ["progress"] = 1 },
                  },
                },
              },
            },
          },
        }
    "#;

    #[test]
    fn a_malformed_weekly_or_lock_costs_only_itself() {
        // The guarantee that makes this change safe to add: per-character deserialization drops the
        // whole character on failure, so an unrecognised sub-table must be absorbed, not propagated.
        let chars = parse_from_lua(FIXTURE_ODD_WEEKLY)
            .expect("parse")
            .characters;
        assert_eq!(chars.len(), 1);
        let c = &chars[0];
        assert_eq!(c.name, "Odd");
        // The bad `weeklies` costs the weekly section only.
        assert!(c.weekly.is_none());
        // The bad lock is skipped; its readable sibling survives.
        assert_eq!(c.locks.len(), 1);
        assert_eq!(c.locks[0].difficulty_id, 14);
        assert_eq!(c.locks[0].name.as_deref(), Some("Readable"));
    }

    #[test]
    fn reads_a_characters_earned_and_featured_titles() {
        let chars = parse_from_lua(FIXTURE).expect("parse").characters;
        let titles = chars
            .iter()
            .find(|c| c.name == "Testchar")
            .expect("Testchar")
            .titles
            .as_ref()
            .expect("titles");

        assert_eq!(titles.current, Some(284));
        assert_eq!(titles.current_name.as_deref(), Some("Conservationist"));
        // Sorted by name, and the entry with no name is dropped rather than rendered blank.
        let names: Vec<&str> = titles.known.iter().map(|t| t.name.as_str()).collect();
        assert_eq!(names, ["Ally of Dragons", "Conservationist"]);
    }

    #[test]
    fn reads_both_halves_of_the_hybrid_title_catalog() {
        // The regression this whole design guards: the addon writes low ids as a contiguous Lua
        // array and high ids as explicit [id] = name pairs. Reading it as a sequence keeps only the
        // array part and silently loses the sparse tail — which is most of the real catalog.
        let catalog = parse_from_lua(FIXTURE)
            .expect("parse")
            .title_catalog
            .expect("title catalog");

        assert_eq!(
            catalog.titles.len(),
            5,
            "array part and sparse pairs both present"
        );
        let by_id = |id: i64| {
            catalog
                .titles
                .iter()
                .find(|t| t.id == id)
                .map(|t| t.name.as_str())
        };
        // From the array part...
        assert_eq!(by_id(1), Some("Private"));
        assert_eq!(by_id(2), Some("Corporal"));
        // ...and from the explicitly-keyed tail.
        assert_eq!(by_id(284), Some("Conservationist"));
        assert_eq!(by_id(743), Some("the Explorer"));

        assert_eq!(catalog.locale.as_deref(), Some("enUS"));
        assert_eq!(catalog.scanned_by.as_deref(), Some("Testchar"));
        assert_eq!(catalog.count, Some(5));
    }

    #[test]
    fn sorts_the_catalog_by_name_for_a_stable_payload() {
        let catalog = parse_from_lua(FIXTURE)
            .expect("parse")
            .title_catalog
            .expect("title catalog");
        let names: Vec<&str> = catalog.titles.iter().map(|t| t.name.as_str()).collect();
        assert_eq!(
            names,
            [
                "Ally of Dragons",
                "Conservationist",
                "Corporal",
                "Private",
                "the Explorer"
            ]
        );
    }

    #[test]
    fn a_character_without_titles_reads_as_absent() {
        let chars = parse_from_lua(FIXTURE).expect("parse").characters;
        let alt = chars.iter().find(|c| c.name == "Altchar").expect("Altchar");
        assert!(alt.titles.is_none());
    }

    // A file from before the addon began scanning the catalog.
    const FIXTURE_NO_CATALOG: &str = r#"
        WarbandeerCharDB = {
          ["characters"] = {
            ["Solo"] = {
              ["realm"] = "Testrealm",
              ["titles"] = { ["known"] = { { ["id"] = 1, ["name"] = "Private" } } },
            },
          },
        }
    "#;

    #[test]
    fn missing_catalog_still_yields_earned_titles() {
        // Degrades to earned-only rather than costing the titles entirely.
        let parsed = parse_from_lua(FIXTURE_NO_CATALOG).expect("parse");
        assert!(parsed.title_catalog.is_none());
        assert_eq!(
            parsed.characters[0]
                .titles
                .as_ref()
                .expect("titles")
                .known
                .len(),
            1
        );
    }

    // Instance ids that form a contiguous run from 1 — the shape mlua renders as a *sequence*
    // rather than a map under `deserialize_any`.
    const FIXTURE_ARRAY_LIKE_LOCKS: &str = r#"
        WarbandeerCharDB = {
          ["characters"] = {
            ["Seq"] = {
              ["realm"] = "Testrealm",
              ["instances"] = { ["locks"] = {
                [1] = { [14] = { ["name"] = "One" } },
                [2] = { [14] = { ["name"] = "Two" } },
              } },
            },
          },
        }
    "#;

    #[test]
    fn reads_locks_whose_instance_ids_look_like_an_array() {
        // Regression guard: routing this tree through an untagged wrapper made mlua expose it as a
        // sequence, `HashMap<i64, _>` then failed, and every lockout vanished silently. Real
        // instance ids are large enough never to trigger it, so only a test like this catches it.
        let chars = parse_from_lua(FIXTURE_ARRAY_LIKE_LOCKS)
            .expect("parse")
            .characters;
        let locks = &chars[0].locks;
        assert_eq!(locks.len(), 2);
        assert_eq!(locks[0].instance_id, 1);
        assert_eq!(locks[1].instance_id, 2);
        assert_eq!(locks[0].name.as_deref(), Some("One"));
    }

    // A vault slot with no explicit `complete` flag.
    const FIXTURE_VAULT_NO_FLAG: &str = r#"
        WarbandeerCharDB = {
          ["characters"] = {
            ["Derive"] = {
              ["realm"] = "Testrealm",
              ["weeklies"] = { ["vaultSlots"] = { ["Raid"] = {
                { ["threshold"] = 2, ["progress"] = 4 },
                { ["threshold"] = 6, ["progress"] = 4 },
              } } },
            },
          },
        }
    "#;

    #[test]
    fn derives_slot_completion_when_the_flag_is_absent() {
        // Defaulting a missing flag to false would report an earned slot as locked — the one wrong
        // answer that actually costs the player something.
        let chars = parse_from_lua(FIXTURE_VAULT_NO_FLAG)
            .expect("parse")
            .characters;
        let raid = &chars[0]
            .weekly
            .as_ref()
            .expect("weekly")
            .vault
            .as_ref()
            .expect("vault")
            .raid;
        assert!(raid[0].complete, "4 progress meets the threshold of 2");
        assert!(
            !raid[1].complete,
            "4 progress is short of the threshold of 6"
        );
    }

    #[test]
    fn reads_mail_and_auctions_blocks() {
        let chars = parse_from_lua(FIXTURE).expect("parse").characters;
        let k = chars
            .iter()
            .find(|c| c.name == "Testchar")
            .expect("Testchar");

        let mail = k.mail.as_ref().expect("mail");
        assert_eq!(mail.count, Some(3));
        assert_eq!(mail.money, Some(4560000));
        assert_eq!(mail.has_mail, Some(true));
        // Absolute server-time epochs, ascending as the addon writes them.
        assert_eq!(mail.expiries, [1785500000, 1785600000, 1785900000]);

        let auctions = k.auctions.as_ref().expect("auctions");
        assert_eq!(auctions.count, Some(2));
        assert_eq!(auctions.value, Some(250000000));
        assert_eq!(auctions.expiries, [1785400000, 1785800000]);

        // The point of the issue as much as the counts: each block is dated by its *own* scannedAt,
        // not the character's lastRefresh (1785200000) — a mail block can be far staler than login.
        assert_eq!(mail.scanned_at, Some(1785100000));
        assert_eq!(auctions.scanned_at, Some(1785150000));
        assert_ne!(mail.scanned_at, k.last_refresh);
        assert_ne!(auctions.scanned_at, k.last_refresh);
    }

    #[test]
    fn a_character_without_mail_or_auctions_reads_as_absent() {
        // Never opened a mailbox / the AH: the blocks read as absent, not as an empty-but-present
        // zero — the distinction the consuming views depend on.
        let chars = parse_from_lua(FIXTURE).expect("parse").characters;
        let alt = chars.iter().find(|c| c.name == "Altchar").expect("Altchar");
        assert!(alt.mail.is_none());
        assert!(alt.auctions.is_none());
    }

    // The live shape the issue calls out: hasMail can be set while count is 0 and no expiry exists,
    // because HasNewMail() is maintained without opening a mailbox.
    const FIXTURE_LIVE_SHAPE_MAIL: &str = r#"
        WarbandeerCharDB = {
          ["characters"] = {
            ["Waiting"] = {
              ["realm"] = "Testrealm",
              ["mail"] = {
                ["scannedAt"] = 1785000000,
                ["count"] = 0,
                ["money"] = 0,
                ["hasMail"] = true,
                ["expiries"] = {},
              },
            },
          },
        }
    "#;

    #[test]
    fn hasmail_parses_independently_of_count_and_empty_expiries_is_a_list() {
        let chars = parse_from_lua(FIXTURE_LIVE_SHAPE_MAIL)
            .expect("parse")
            .characters;
        let mail = chars[0].mail.as_ref().expect("mail");
        // hasMail stands on its own: true even though the mailbox scanned as empty.
        assert_eq!(mail.has_mail, Some(true));
        // A real empty box: count is Some(0), distinct from an absent block's None.
        assert_eq!(mail.count, Some(0));
        // An empty `expiries` table yields an empty list rather than failing the parse.
        assert!(mail.expiries.is_empty());
    }

    // `mail` is the wrong shape entirely; the readable `auctions` sibling must still come through.
    const FIXTURE_ODD_MAIL_AUCTIONS: &str = r#"
        WarbandeerCharDB = {
          ["characters"] = {
            ["Odd"] = {
              ["realm"] = "Testrealm",
              ["mail"] = "not-a-table",
              ["auctions"] = {
                ["scannedAt"] = 1785000000, ["count"] = 1, ["value"] = 100,
                ["expiries"] = { 1785500000 },
              },
            },
          },
        }
    "#;

    #[test]
    fn a_malformed_mail_or_auctions_block_costs_only_itself() {
        // Same guarantee as the weekly/lock case: an unrecognised block is absorbed to None and
        // costs its own section, never the character or its sibling blocks.
        let chars = parse_from_lua(FIXTURE_ODD_MAIL_AUCTIONS)
            .expect("parse")
            .characters;
        assert_eq!(chars.len(), 1);
        let c = &chars[0];
        assert_eq!(c.name, "Odd");
        // The bad mail costs the mail section only...
        assert!(c.mail.is_none());
        // ...and its readable auctions sibling survives intact.
        let auctions = c.auctions.as_ref().expect("auctions");
        assert_eq!(auctions.count, Some(1));
        assert_eq!(auctions.value, Some(100));
        assert_eq!(auctions.expiries, [1785500000]);
    }

    /// Opt-in smoke test against a real install: reads the live SavedVariables via the
    /// full `get_warband` pipeline. Runs only when `WARBAND_TEST_LIVE` is set, so it
    /// never runs in CI (no WoW install there).
    #[test]
    fn live_read_smoke() {
        if std::env::var_os("WARBAND_TEST_LIVE").is_none() {
            return;
        }
        let data = get_warband().expect("get_warband against a live install");
        eprintln!(
            "LIVE: {} characters from account {} ({})",
            data.characters.len(),
            data.account,
            data.source
        );
        assert!(!data.characters.is_empty());
        eprintln!("LIVE wealth: {:?}", data.wealth);
        // The catalog's own `count` is the addon's tally of what it scanned. If the hybrid
        // array/map table were read as a sequence, `titles.len()` would fall short of it — this is
        // the live check for that.
        match &data.title_catalog {
            Some(c) => eprintln!(
                "LIVE titles: catalog {} entries (addon count {:?}), locale {:?}, scanned by {:?}; \
                 {} characters carry titles",
                c.titles.len(),
                c.count,
                c.locale,
                c.scanned_by,
                data.characters.iter().filter(|x| x.titles.is_some()).count()
            ),
            None => eprintln!("LIVE titles: no catalog"),
        }
        let with_vault = data
            .characters
            .iter()
            .filter(|c| c.weekly.as_ref().is_some_and(|w| w.vault.is_some()))
            .count();
        let unclaimed = data
            .characters
            .iter()
            .filter(|c| {
                c.weekly
                    .as_ref()
                    .and_then(|w| w.has_unclaimed_vault)
                    .unwrap_or(false)
            })
            .count();
        let locked = data
            .characters
            .iter()
            .filter(|c| !c.locks.is_empty())
            .count();
        let slots: usize = data
            .characters
            .iter()
            .filter_map(|c| c.weekly.as_ref()?.vault.as_ref())
            .map(|v| v.raid.len() + v.dungeons.len() + v.world.len())
            .sum();
        eprintln!(
            "LIVE weekly: {with_vault} with vault data ({slots} slots total), \
             {unclaimed} with an unclaimed reward, {locked} with lockouts"
        );
        // The vault board derives its level cap from the warband's own highest character rather than
        // hardcoding one; this reports what that resolves to on real data.
        let cap = data.characters.iter().filter_map(|c| c.level).max();
        let at_cap = data
            .characters
            .iter()
            .filter(|c| c.level.is_some() && c.level == cap)
            .count();
        eprintln!("LIVE levels: cap {cap:?}, {at_cap} character(s) at it");
        // The manual cross-check for #162: mail/auctions are only written on a mailbox/AH visit, so
        // on the current install most blocks are absent and every count is 0 (see the issue's
        // live-data caveat). This reports what actually parsed.
        let with_mail = data.characters.iter().filter(|c| c.mail.is_some()).count();
        let with_auctions = data
            .characters
            .iter()
            .filter(|c| c.auctions.is_some())
            .count();
        let has_new_mail = data
            .characters
            .iter()
            .filter(|c| c.mail.as_ref().and_then(|m| m.has_mail).unwrap_or(false))
            .count();
        let mail_expiries: usize = data
            .characters
            .iter()
            .filter_map(|c| c.mail.as_ref())
            .map(|m| m.expiries.len())
            .sum();
        let auction_expiries: usize = data
            .characters
            .iter()
            .filter_map(|c| c.auctions.as_ref())
            .map(|a| a.expiries.len())
            .sum();
        eprintln!(
            "LIVE mail/auctions: {with_mail} with a mail block ({has_new_mail} with HasNewMail set, \
             {mail_expiries} expiries total), {with_auctions} with an auctions block \
             ({auction_expiries} expiries total)"
        );
        for c in data.characters.iter().take(3) {
            eprintln!(
                "  {} - {} | lvl {:?} | ilvl {:?} | {:?} | gold {:?} | {} currencies | key {:?} | {} locks",
                c.name,
                c.realm,
                c.level,
                c.item_level,
                c.class_key,
                c.gold,
                c.currencies.len(),
                c.weekly.as_ref().and_then(|w| w.keystone_level),
                c.locks.len()
            );
        }
    }
}
