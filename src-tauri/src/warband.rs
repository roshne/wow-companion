// Read the Warbandeer_Characters addon's SavedVariables — a Lua table literal
// (`WarbandeerCharDB = { ... }`) the addon rewrites on every login — and expose a
// typed, warband-wide character list to the frontend.
//
// The file is loaded in an embedded Lua VM with an empty environment, so the
// chunk can only assign the data table (it has no access to any Lua stdlib).

use std::path::PathBuf;

use mlua::{Lua, Table};
use serde::Serialize;

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

fn get_str(t: &Table, key: &str) -> Option<String> {
    t.get::<Option<String>>(key).ok().flatten()
}

fn get_int(t: &Table, key: &str) -> Option<i64> {
    t.get::<Option<i64>>(key).ok().flatten()
}

fn get_table(t: &Table, key: &str) -> Option<Table> {
    t.get::<Option<Table>>(key).ok().flatten()
}

fn extract_character(name_key: String, c: &Table) -> WarbandCharacter {
    let basic = get_table(c, "basic");
    let spec = basic.as_ref().and_then(|b| get_table(b, "specialization"));
    let profs = basic.as_ref().and_then(|b| get_table(b, "professions"));
    let equipment = get_table(c, "equipment");

    WarbandCharacter {
        name: get_str(c, "name").unwrap_or(name_key),
        realm: get_str(c, "realm").unwrap_or_default(),
        guid: get_str(c, "guid"),
        class_id: get_int(c, "classId"),
        class_key: get_str(c, "classKey"),
        class_name: get_str(c, "className"),
        level: basic.as_ref().and_then(|b| get_int(b, "level")),
        item_level: equipment
            .as_ref()
            .and_then(|e| get_int(e, "ilvl"))
            .or_else(|| get_int(c, "ilvl")),
        spec: spec
            .as_ref()
            .and_then(|s| get_str(s, "active").or_else(|| get_str(s, "key"))),
        role: spec.as_ref().and_then(|s| get_str(s, "role")),
        profession_primary: profs
            .as_ref()
            .and_then(|p| get_table(p, "primary"))
            .and_then(|p| get_str(&p, "name")),
        profession_secondary: profs
            .as_ref()
            .and_then(|p| get_table(p, "secondary"))
            .and_then(|p| get_str(&p, "name")),
        guild: get_str(c, "guild"),
        faction: c
            .get::<Option<bool>>("isAlliance")
            .ok()
            .flatten()
            .map(|a| if a { "Alliance" } else { "Horde" }.to_string()),
    }
}

/// Parse a `Warbandeer_Characters.lua` body into a name-sorted character list.
fn parse_from_lua(content: &str) -> Result<Vec<WarbandCharacter>, String> {
    let lua = Lua::new();
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
    // `.flatten()` skips any malformed (Err) entry rather than failing the whole read.
    for (name_key, c) in characters.pairs::<String, Table>().flatten() {
        out.push(extract_character(name_key, &c));
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
/// paired with the account-folder name (e.g. `ROSHNE`).
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
            ["Kobrick"] = {
              ["name"] = "Kobrick",
              ["realm"] = "Eitrigg",
              ["guid"] = "Player-47-043DE0BE",
              ["classId"] = 6,
              ["classKey"] = "DeathKnight",
              ["className"] = "Death Knight",
              ["isAlliance"] = true,
              ["guild"] = "We Know",
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
            ["Bravo"] = {
              ["realm"] = "Norgannon",
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
        // Sorted case-insensitively by name: Bravo before Kobrick.
        assert_eq!(chars[0].name, "Bravo");
        assert_eq!(chars[1].name, "Kobrick");
    }

    #[test]
    fn extracts_nested_fields() {
        let chars = parse_from_lua(FIXTURE).expect("parse");
        let k = chars.iter().find(|c| c.name == "Kobrick").expect("Kobrick");
        assert_eq!(k.realm, "Eitrigg");
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
            .find(|c| c.realm == "Norgannon")
            .expect("Bravo");
        // name missing in the entry -> falls back to the table key.
        assert_eq!(b.name, "Bravo");
        assert_eq!(b.level, Some(60));
        assert_eq!(b.item_level, None);
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
