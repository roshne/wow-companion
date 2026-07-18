// Read the Warbandeer_Characters addon's SavedVariables — a Lua table literal
// (`WarbandeerCharDB = { ... }`) the addon rewrites on every login — and expose a
// typed, warband-wide character list to the frontend.
//
// The file is loaded in an embedded Lua VM with an empty environment, so the
// chunk can only assign the data table (it has no access to any Lua stdlib).

use std::path::PathBuf;

use mlua::{Lua, LuaSerdeExt, Table, Value};
use serde::{Deserialize, Serialize};

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
}

/// Result of a warband read: which account/file it came from, and the characters.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WarbandData {
    pub account: String,
    pub source: String,
    pub characters: Vec<WarbandCharacter>,
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
    ilvl: Option<f64>,
    basic: Option<RawBasic>,
    equipment: Option<RawEquipment>,
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

/// Fold a deserialized `RawCharacter` into the flat public payload, applying the
/// fallbacks the file shape doesn't encode and casting numerics to `i64` here — at
/// the payload edge — rather than at deserialize time.
fn build_character(name_key: String, raw: RawCharacter) -> WarbandCharacter {
    let RawCharacter {
        name,
        realm,
        guid,
        class_id,
        class_key,
        class_name,
        is_alliance,
        guild,
        ilvl,
        basic,
        equipment,
    } = raw;

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
    }
}

/// Parse a `Warbandeer_Characters.lua` body into a name-sorted character list.
fn parse_from_lua(content: &str) -> Result<Vec<WarbandCharacter>, String> {
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
        if let Ok(raw) = lua.from_value::<RawCharacter>(value) {
            out.push(build_character(name_key, raw));
        }
    }
    out.sort_by_key(|c| c.name.to_lowercase());
    Ok(out)
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
    let characters = parse_from_lua(&content)?;
    Ok(WarbandData {
        account,
        source: path.to_string_lossy().into_owned(),
        characters,
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
            },
            ["Altchar"] = {
              ["realm"] = "Altrealm",
              ["classKey"] = "Warrior",
              ["basic"] = { ["level"] = 60 },
            },
          },
        }
    "#;

    #[test]
    fn parses_and_sorts_characters() {
        let chars = parse_from_lua(FIXTURE).expect("parse");
        assert_eq!(chars.len(), 2);
        // Sorted case-insensitively by name: Altchar before Testchar.
        assert_eq!(chars[0].name, "Altchar");
        assert_eq!(chars[1].name, "Testchar");
    }

    #[test]
    fn extracts_nested_fields() {
        let chars = parse_from_lua(FIXTURE).expect("parse");
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
    }

    #[test]
    fn falls_back_to_key_name_and_top_level_ilvl() {
        let chars = parse_from_lua(FIXTURE).expect("parse");
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
        let chars = parse_from_lua(FIXTURE_MALFORMED).expect("parse");
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
        let chars = parse_from_lua(FIXTURE_FRACTIONAL).expect("parse");
        assert_eq!(chars.len(), 1);
        // 445.5 deserializes as f64 and casts to 445 at the payload edge.
        assert_eq!(chars[0].item_level, Some(445));
        assert_eq!(chars[0].level, Some(70));
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
        for c in data.characters.iter().take(3) {
            eprintln!(
                "  {} - {} | lvl {:?} | ilvl {:?} | {:?} | {:?}",
                c.name, c.realm, c.level, c.item_level, c.class_key, c.spec
            );
        }
    }
}
