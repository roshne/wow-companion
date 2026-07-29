// The account's own character index — `GET /profile/user/wow`, behind the account grant.
//
// This is the one read that cannot go through the frontend's `makeClient`. Every other endpoint uses
// the client-credentials token, which `get_access_token` hands to the webview; this one needs the
// *user's* token, and `account_auth.rs` establishes that the token is read only in Rust. So the whole
// request happens here and the webview receives shaped data, never the credential.
//
// Two things about the response shape, both established by calling it for real rather than from the
// vendored spec (which carries no 200 body for this path — Blizzard's portal only renders one after
// an authenticated live call):
//
//  1. **`wow_accounts[]` is a list.** One Battle.net account holds several WoW accounts, each with its
//     own `characters[]`. Flattening happens here; the WoW account id rides along on every character
//     so the view can still group by it.
//  2. **It sees more characters than the addon does** — every character on the account, including ones
//     never logged into since the addon was installed. That is the point of this endpoint: the API is
//     the authority on which characters *exist*, the addon on what they have *done*.
//
// Parsing is deliberately tolerant. The field list here was reconstructed from a live call, so a
// malformed or unexpected entry drops that one character rather than failing the whole index.

use serde::Serialize;
use serde_json::Value;

use crate::{account_entry, now_secs, parse_stored_grant, EXPIRY_SKEW_SECS};

/// Why an account-profile read didn't produce data.
///
/// A typed kind rather than a message string: `unauthorized` is the state the frontend has to tell
/// apart from every other failure — it means the grant is gone on Blizzard's side and the only
/// recovery is consenting again. Matching that on prose would be fragile.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum ErrorKind {
    /// Nothing stored — the account was never connected.
    NoGrant,
    /// Stored but past its 24 hours. Blizzard issues no refresh token, so this means re-consent.
    Expired,
    /// Blizzard rejected the token we hold. Revoked, or invalidated on their side.
    Unauthorized,
    /// Any other non-success HTTP status.
    Http,
    /// The request never completed.
    Network,
    /// A 200 whose body wasn't the shape this endpoint documents.
    Parse,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AccountProfileError {
    pub kind: ErrorKind,
    pub message: String,
}

impl AccountProfileError {
    fn new(kind: ErrorKind, message: impl Into<String>) -> Self {
        AccountProfileError {
            kind,
            message: message.into(),
        }
    }
}

/// One character as Battle.net knows it: who and where, but nothing about what they've done.
///
/// Shallow by nature — there is no gold, vault, lockout or currency here. Those come from the addon,
/// and reconciling the two is the consuming view's job.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AccountCharacter {
    pub name: String,
    pub id: i64,
    /// Which WoW account under the Battle.net account this character belongs to.
    pub wow_account_id: i64,
    pub realm_name: String,
    pub realm_slug: String,
    pub class: Option<String>,
    pub race: Option<String>,
    pub faction: Option<String>,
    pub gender: Option<String>,
    pub level: Option<i64>,
    /// Whether the entry carried a `protected_character` link — characters whose profile is only
    /// readable through the protected endpoint. Recorded, not yet acted on.
    pub protected: bool,
}

/// The account's characters, flattened across its WoW accounts.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AccountProfile {
    pub characters: Vec<AccountCharacter>,
    /// How many WoW accounts the index reported, including any that held no characters. Kept
    /// separately so a view can say "3 accounts" without inferring it from the rows it got.
    pub wow_account_count: usize,
}

/// Read a name that Blizzard may return either flattened (with `locale=en_US`) or as a localized
/// object. We always ask for a locale, so the flat form is what arrives — the object form is handled
/// anyway because falling back to a missing name would silently blank a column.
fn flat_name(value: Option<&Value>) -> Option<String> {
    match value? {
        Value::String(s) if !s.is_empty() => Some(s.clone()),
        Value::Object(map) => map
            .get("en_US")
            .and_then(Value::as_str)
            .map(str::to_string)
            .filter(|s| !s.is_empty()),
        _ => None,
    }
}

/// The display name of a `{ type, name }` enum field, preferring the localized name and falling back
/// to the stable `type` (`HORDE`, `MALE`) so the column is never empty when only one form is present.
fn enum_label(value: Option<&Value>) -> Option<String> {
    let value = value?;
    flat_name(value.get("name")).or_else(|| {
        value
            .get("type")
            .and_then(Value::as_str)
            .filter(|s| !s.is_empty())
            .map(str::to_string)
    })
}

/// Build one character, or `None` if it lacks the fields that make a row meaningful.
///
/// Name, id and realm slug are required: without them a row can neither be displayed nor matched
/// against the addon's records. Everything else is optional and renders as unknown.
fn build_character(entry: &Value, wow_account_id: i64) -> Option<AccountCharacter> {
    let name = flat_name(entry.get("name"))?;
    let id = entry.get("id").and_then(Value::as_i64)?;
    let realm = entry.get("realm")?;
    let realm_slug = realm
        .get("slug")
        .and_then(Value::as_str)
        .filter(|s| !s.is_empty())?
        .to_string();

    Some(AccountCharacter {
        name,
        id,
        wow_account_id,
        realm_name: flat_name(realm.get("name")).unwrap_or_else(|| realm_slug.clone()),
        realm_slug,
        class: flat_name(entry.get("playable_class").and_then(|c| c.get("name"))),
        race: flat_name(entry.get("playable_race").and_then(|r| r.get("name"))),
        faction: enum_label(entry.get("faction")),
        gender: enum_label(entry.get("gender")),
        level: entry.get("level").and_then(Value::as_i64),
        protected: entry.get("protected_character").is_some(),
    })
}

/// Parse an account profile summary body.
///
/// Pure, so the shape this endpoint returns is testable without a keychain, a network, or a consented
/// account — which matters more than usual here, since the shape came from one live call rather than
/// from a published schema.
pub fn parse_account_profile(body: &str) -> Result<AccountProfile, AccountProfileError> {
    let root: Value = serde_json::from_str(body)
        .map_err(|e| AccountProfileError::new(ErrorKind::Parse, format!("invalid JSON: {e}")))?;

    let accounts = root
        .get("wow_accounts")
        .and_then(Value::as_array)
        .ok_or_else(|| {
            AccountProfileError::new(
                ErrorKind::Parse,
                "the response carried no `wow_accounts` list",
            )
        })?;

    let mut characters = Vec::new();
    for account in accounts {
        // A WoW account with no usable id still contributes its characters; grouping just falls back
        // to 0 rather than dropping real rows over a missing grouping key.
        let wow_account_id = account.get("id").and_then(Value::as_i64).unwrap_or(0);
        let entries = account.get("characters").and_then(Value::as_array);
        for entry in entries.into_iter().flatten() {
            if let Some(character) = build_character(entry, wow_account_id) {
                characters.push(character);
            }
        }
    }

    Ok(AccountProfile {
        characters,
        wow_account_count: accounts.len(),
    })
}

/// The regions this endpoint is reachable on.
///
/// An allowlist rather than string interpolation: `region` arrives from the webview, and building a
/// host out of unvalidated input is how a request ends up somewhere it shouldn't — with a bearer
/// token attached.
const REGIONS: [&str; 4] = ["us", "eu", "kr", "tw"];

/// The request URL for a region, or an error for anything not on the allowlist.
pub fn profile_url(region: &str) -> Result<String, AccountProfileError> {
    if !REGIONS.contains(&region) {
        return Err(AccountProfileError::new(
            ErrorKind::Http,
            format!("unsupported region: {region}"),
        ));
    }
    Ok(format!(
        "https://{region}.api.blizzard.com/profile/user/wow?namespace=profile-{region}&locale=en_US"
    ))
}

/// Map a non-success HTTP status onto a kind the frontend can route on.
///
/// 401 and 403 both mean "this grant no longer works": the first is Blizzard rejecting the token, the
/// second the token lacking the scope. Neither is retryable and both recover the same way — consent
/// again — so they share a kind.
pub fn classify_status(status: u16, body: &str) -> AccountProfileError {
    let detail = body.chars().take(200).collect::<String>();
    match status {
        401 | 403 => AccountProfileError::new(
            ErrorKind::Unauthorized,
            "Battle.net rejected the account connection.",
        ),
        _ => AccountProfileError::new(
            ErrorKind::Http,
            format!("Battle.net returned HTTP {status}: {detail}"),
        ),
    }
}

/// Read the stored grant, or say precisely why there isn't a usable one.
fn usable_grant() -> Result<String, AccountProfileError> {
    let payload = account_entry()
        .and_then(|e| e.get_password().map_err(|err| err.to_string()))
        .map_err(|_| {
            AccountProfileError::new(ErrorKind::NoGrant, "No Battle.net account is connected.")
        })?;
    let (token, expires_at) = parse_stored_grant(&payload).ok_or_else(|| {
        AccountProfileError::new(ErrorKind::NoGrant, "No Battle.net account is connected.")
    })?;
    if now_secs() + EXPIRY_SKEW_SECS >= expires_at {
        return Err(AccountProfileError::new(
            ErrorKind::Expired,
            "The Battle.net account connection has expired.",
        ));
    }
    Ok(token.to_string())
}

/// Fetch the account's character index for a region.
///
/// On a rejected grant the stored token is deleted before returning: it cannot be made to work again,
/// and leaving it in place would keep `has_account_grant` reporting a connection that isn't one.
#[tauri::command]
pub async fn get_account_profile(region: String) -> Result<AccountProfile, AccountProfileError> {
    let url = profile_url(&region)?;
    let token = usable_grant()?;

    let resp = reqwest::Client::new()
        .get(url)
        .bearer_auth(&token)
        .send()
        .await
        .map_err(|e| {
            AccountProfileError::new(ErrorKind::Network, format!("request failed: {e}"))
        })?;

    let status = resp.status();
    if !status.is_success() {
        let body = resp.text().await.unwrap_or_default();
        let error = classify_status(status.as_u16(), &body);
        if error.kind == ErrorKind::Unauthorized {
            if let Ok(entry) = account_entry() {
                let _ = entry.delete_credential();
            }
        }
        return Err(error);
    }

    let body = resp.text().await.map_err(|e| {
        AccountProfileError::new(ErrorKind::Network, format!("could not read response: {e}"))
    })?;
    parse_account_profile(&body)
}

#[cfg(test)]
mod tests {
    use super::*;

    /// The real shape, trimmed: three WoW accounts under one Battle.net account.
    const THREE_ACCOUNTS: &str = r#"{
        "id": 1,
        "wow_accounts": [
            {
                "id": 111,
                "characters": [
                    {
                        "character": { "href": "https://…" },
                        "protected_character": { "href": "https://…" },
                        "name": "Nazu",
                        "id": 5001,
                        "realm": { "name": "Area 52", "id": 3676, "slug": "area-52" },
                        "playable_class": { "name": "Mage", "id": 8 },
                        "playable_race": { "name": "Troll", "id": 8 },
                        "gender": { "type": "FEMALE", "name": "Female" },
                        "faction": { "type": "HORDE", "name": "Horde" },
                        "level": 80
                    },
                    {
                        "character": { "href": "https://…" },
                        "name": "Alt",
                        "id": 5002,
                        "realm": { "name": "Area 52", "id": 3676, "slug": "area-52" },
                        "playable_class": { "name": "Priest", "id": 5 },
                        "playable_race": { "name": "Undead", "id": 5 },
                        "gender": { "type": "MALE", "name": "Male" },
                        "faction": { "type": "HORDE", "name": "Horde" },
                        "level": 71
                    }
                ]
            },
            {
                "id": 222,
                "characters": [
                    {
                        "name": "Second",
                        "id": 5003,
                        "realm": { "name": "Stormrage", "id": 60, "slug": "stormrage" },
                        "playable_class": { "name": "Druid", "id": 11 },
                        "playable_race": { "name": "Night Elf", "id": 4 },
                        "faction": { "type": "ALLIANCE", "name": "Alliance" },
                        "level": 45
                    }
                ]
            },
            { "id": 333, "characters": [] }
        ]
    }"#;

    #[test]
    fn flattens_characters_across_every_wow_account() {
        let profile = parse_account_profile(THREE_ACCOUNTS).expect("parse");
        assert_eq!(profile.wow_account_count, 3);
        assert_eq!(profile.characters.len(), 3);
        // Each character remembers which WoW account it came from, so the view can group without
        // the parser having to nest the rows.
        let ids: Vec<i64> = profile
            .characters
            .iter()
            .map(|c| c.wow_account_id)
            .collect();
        assert_eq!(ids, vec![111, 111, 222]);
    }

    #[test]
    fn maps_every_field_the_live_response_carries() {
        let profile = parse_account_profile(THREE_ACCOUNTS).expect("parse");
        let first = &profile.characters[0];
        assert_eq!(first.name, "Nazu");
        assert_eq!(first.id, 5001);
        assert_eq!(first.realm_name, "Area 52");
        assert_eq!(first.realm_slug, "area-52");
        assert_eq!(first.class.as_deref(), Some("Mage"));
        assert_eq!(first.race.as_deref(), Some("Troll"));
        assert_eq!(first.faction.as_deref(), Some("Horde"));
        assert_eq!(first.gender.as_deref(), Some("Female"));
        assert_eq!(first.level, Some(80));
        assert!(
            first.protected,
            "this entry carried a protected_character link"
        );
        // …and an entry without that link is not marked protected.
        assert!(!profile.characters[1].protected);
    }

    #[test]
    fn a_single_wow_account_parses_the_same_way_as_several() {
        // The shape must not be special-cased: one account is a list of one, not a different form.
        let body = r#"{
            "wow_accounts": [
                { "id": 111, "characters": [
                    { "name": "Only", "id": 1, "realm": { "name": "Area 52", "slug": "area-52" } }
                ] }
            ]
        }"#;
        let profile = parse_account_profile(body).expect("parse");
        assert_eq!(profile.wow_account_count, 1);
        assert_eq!(profile.characters.len(), 1);
        assert_eq!(profile.characters[0].wow_account_id, 111);
    }

    #[test]
    fn an_account_with_no_characters_still_counts() {
        let body = r#"{ "wow_accounts": [ { "id": 1, "characters": [] } ] }"#;
        let profile = parse_account_profile(body).expect("parse");
        assert_eq!(profile.wow_account_count, 1);
        assert!(profile.characters.is_empty());
    }

    #[test]
    fn one_malformed_entry_does_not_drop_the_rest() {
        // The field list here came from a single live call, so tolerance matters: an entry shaped
        // differently than expected must cost that row, not the whole index.
        let body = r#"{
            "wow_accounts": [
                { "id": 1, "characters": [
                    { "name": "Good", "id": 1, "realm": { "name": "Area 52", "slug": "area-52" } },
                    { "name": "NoId", "realm": { "slug": "area-52" } },
                    { "id": 3, "realm": { "slug": "area-52" } },
                    { "name": "NoRealm", "id": 4 },
                    { "name": "EmptySlug", "id": 5, "realm": { "slug": "" } },
                    "not-an-object",
                    { "name": "AlsoGood", "id": 6, "realm": { "name": "Stormrage", "slug": "stormrage" } }
                ] }
            ]
        }"#;
        let profile = parse_account_profile(body).expect("parse");
        let names: Vec<&str> = profile.characters.iter().map(|c| c.name.as_str()).collect();
        assert_eq!(names, vec!["Good", "AlsoGood"]);
    }

    #[test]
    fn optional_fields_are_absent_rather_than_blank() {
        let body = r#"{
            "wow_accounts": [ { "id": 1, "characters": [
                { "name": "Sparse", "id": 1, "realm": { "slug": "area-52" } }
            ] } ]
        }"#;
        let c = &parse_account_profile(body).expect("parse").characters[0];
        assert_eq!(c.class, None);
        assert_eq!(c.race, None);
        assert_eq!(c.faction, None);
        assert_eq!(c.level, None);
        // With no display name, the realm falls back to its slug rather than rendering empty.
        assert_eq!(c.realm_name, "area-52");
    }

    #[test]
    fn reads_localized_name_objects_as_well_as_flat_strings() {
        // We always send `locale=en_US`, so names arrive flat — but a localized object must not
        // silently blank the column if that ever changes.
        let body = r#"{
            "wow_accounts": [ { "id": 1, "characters": [
                {
                    "name": { "en_US": "Localized" },
                    "id": 1,
                    "realm": { "name": { "en_US": "Area 52" }, "slug": "area-52" },
                    "playable_class": { "name": { "en_US": "Mage" } }
                }
            ] } ]
        }"#;
        let c = &parse_account_profile(body).expect("parse").characters[0];
        assert_eq!(c.name, "Localized");
        assert_eq!(c.realm_name, "Area 52");
        assert_eq!(c.class.as_deref(), Some("Mage"));
    }

    #[test]
    fn falls_back_to_the_stable_type_when_an_enum_carries_no_name() {
        let body = r#"{
            "wow_accounts": [ { "id": 1, "characters": [
                {
                    "name": "X", "id": 1, "realm": { "slug": "area-52" },
                    "faction": { "type": "ALLIANCE" }
                }
            ] } ]
        }"#;
        let c = &parse_account_profile(body).expect("parse").characters[0];
        assert_eq!(c.faction.as_deref(), Some("ALLIANCE"));
    }

    #[test]
    fn rejects_a_body_that_is_not_this_endpoint() {
        for body in ["not json at all", "{}", r#"{ "wow_accounts": "nope" }"#] {
            let err = parse_account_profile(body).expect_err("should not parse");
            assert_eq!(err.kind, ErrorKind::Parse, "body: {body}");
        }
    }

    #[test]
    fn a_rejected_grant_is_told_apart_from_every_other_failure() {
        // This is the distinction the whole typed-error shape exists for: only these two recover by
        // consenting again.
        assert_eq!(classify_status(401, "").kind, ErrorKind::Unauthorized);
        assert_eq!(classify_status(403, "").kind, ErrorKind::Unauthorized);
        for status in [404, 429, 500, 503] {
            assert_eq!(classify_status(status, "").kind, ErrorKind::Http);
        }
    }

    #[test]
    fn http_errors_carry_the_status_but_not_an_unbounded_body() {
        let err = classify_status(500, &"x".repeat(5000));
        assert!(err.message.contains("500"));
        assert!(err.message.len() < 400, "body detail must stay bounded");
    }

    #[test]
    fn builds_a_region_scoped_url_with_the_profile_namespace() {
        let url = profile_url("eu").expect("url");
        assert_eq!(
            url,
            "https://eu.api.blizzard.com/profile/user/wow?namespace=profile-eu&locale=en_US"
        );
    }

    #[test]
    fn refuses_a_region_that_is_not_on_the_allowlist() {
        // `region` crosses from the webview, and this request carries a bearer token — it must never
        // be pointed at a host the caller chose.
        for region in ["", "evil.example.com", "us.evil", "US", "../us"] {
            assert!(profile_url(region).is_err(), "region: {region:?}");
        }
        for region in REGIONS {
            assert!(profile_url(region).is_ok());
        }
    }

    #[test]
    fn the_error_kind_serializes_as_the_frontend_expects() {
        // The frontend routes on these exact strings.
        let json = serde_json::to_string(&AccountProfileError::new(ErrorKind::Unauthorized, "m"))
            .expect("serialize");
        assert!(json.contains(r#""kind":"unauthorized""#), "got {json}");
        let json =
            serde_json::to_string(&AccountProfileError::new(ErrorKind::NoGrant, "m")).expect("ser");
        assert!(json.contains(r#""kind":"noGrant""#), "got {json}");
    }

    #[test]
    fn characters_serialize_in_the_camel_case_the_typescript_mirror_uses() {
        let profile = parse_account_profile(THREE_ACCOUNTS).expect("parse");
        let json = serde_json::to_string(&profile).expect("serialize");
        assert!(json.contains(r#""wowAccountId":111"#), "got {json}");
        assert!(json.contains(r#""realmSlug":"area-52""#));
        assert!(json.contains(r#""wowAccountCount":3"#));
    }
}
