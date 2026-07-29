// WoW Companion — Tauri backend.
//
// The Battle.net client SECRET lives only here (in the OS keychain). The webview never sees it:
// the frontend asks Rust for a short-lived bearer token via `get_access_token`, and makes the
// actual data-API calls through the Tauri HTTP plugin (which also sidesteps webview CORS).

use std::sync::Mutex;
use std::time::{SystemTime, UNIX_EPOCH};

use serde::Deserialize;
use tauri::State;

mod account_auth;
mod account_profile;
mod warband;

const KEYRING_SERVICE: &str = "wow-companion";
const KEYRING_ACCOUNT: &str = "battlenet-oauth-client";
/// The account-wide grant, stored **beside** the client credentials rather than replacing them.
/// The two authorisations are independent: client credentials serve every data tab, this one only
/// `/profile/user/wow*`, and losing either must not affect the other.
const KEYRING_ACCOUNT_GRANT: &str = "battlenet-account-grant";
const TOKEN_URL: &str = "https://oauth.battle.net/token";
/// Refresh this many seconds before expiry to avoid using a token that dies mid-request.
pub(crate) const EXPIRY_SKEW_SECS: u64 = 60;

#[derive(Default)]
struct AppState {
    token: Mutex<Option<CachedToken>>,
}

struct CachedToken {
    access_token: String,
    expires_at: u64, // unix seconds
}

#[derive(Deserialize)]
struct TokenResponse {
    access_token: String,
    expires_in: u64,
}

pub(crate) fn now_secs() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0)
}

fn cred_entry() -> Result<keyring::Entry, String> {
    keyring::Entry::new(KEYRING_SERVICE, KEYRING_ACCOUNT).map_err(|e| e.to_string())
}

pub(crate) fn account_entry() -> Result<keyring::Entry, String> {
    keyring::Entry::new(KEYRING_SERVICE, KEYRING_ACCOUNT_GRANT).map_err(|e| e.to_string())
}

/// Split a stored `"<access_token>\n<expires_at>"` account grant.
///
/// Kept as a pure function so the storage format is testable without a keychain.
pub(crate) fn parse_stored_grant(payload: &str) -> Option<(&str, u64)> {
    let (token, expiry) = payload.split_once('\n')?;
    let expires_at = expiry.trim().parse::<u64>().ok()?;
    (!token.is_empty()).then_some((token, expires_at))
}

/// Store the Battle.net client id/secret in the OS keychain (overwrites any existing pair).
#[tauri::command]
fn save_credentials(
    state: State<AppState>,
    client_id: String,
    client_secret: String,
) -> Result<(), String> {
    if client_id.trim().is_empty() || client_secret.trim().is_empty() {
        return Err("Client ID and secret are both required.".into());
    }
    cred_entry()?
        .set_password(&format!("{client_id}\n{client_secret}"))
        .map_err(|e| e.to_string())?;
    *state.token.lock().unwrap() = None; // invalidate any cached token
    Ok(())
}

/// Whether credentials are currently stored.
#[tauri::command]
fn has_credentials() -> bool {
    cred_entry()
        .and_then(|e| e.get_password().map_err(|err| err.to_string()))
        .is_ok()
}

/// Remove stored credentials and drop the cached token.
#[tauri::command]
fn clear_credentials(state: State<AppState>) -> Result<(), String> {
    if let Ok(entry) = cred_entry() {
        let _ = entry.delete_credential();
    }
    *state.token.lock().unwrap() = None;
    Ok(())
}

impl CachedToken {
    /// Whether this cached token is still safe to use at `now` (unix seconds). Keeps a refresh
    /// skew so we never hand out a token that could die mid-request.
    fn is_valid_at(&self, now: u64) -> bool {
        now + EXPIRY_SKEW_SECS < self.expires_at
    }

    /// Build a cached token from a fresh exchange response, stamping its absolute expiry off `now`.
    fn from_response(tr: TokenResponse, now: u64) -> Self {
        CachedToken {
            access_token: tr.access_token,
            expires_at: now + tr.expires_in,
        }
    }
}

/// Split a stored `"<id>\n<secret>"` credential blob into its two halves.
fn parse_stored_credentials(payload: &str) -> Result<(&str, &str), String> {
    payload
        .split_once('\n')
        .ok_or_else(|| "Stored credentials are malformed.".to_string())
}

/// Return a valid client-credentials access token, fetching and caching as needed.
/// The secret is read from the keychain here and never returned to the frontend.
#[tauri::command]
async fn get_access_token(state: State<'_, AppState>) -> Result<String, String> {
    // 1. Cached and still valid?
    {
        let guard = state.token.lock().unwrap();
        if let Some(t) = guard.as_ref() {
            if t.is_valid_at(now_secs()) {
                return Ok(t.access_token.clone());
            }
        }
    }

    // 2. Read credentials from the keychain.
    let payload = cred_entry()?
        .get_password()
        .map_err(|_| "No Battle.net credentials saved. Add them in the app first.".to_string())?;
    let (client_id, client_secret) = parse_stored_credentials(&payload)?;

    // 3. Exchange for a token.
    let resp = reqwest::Client::new()
        .post(TOKEN_URL)
        .basic_auth(client_id, Some(client_secret))
        .form(&[("grant_type", "client_credentials")])
        .send()
        .await
        .map_err(|e| format!("token request failed: {e}"))?;
    if !resp.status().is_success() {
        let status = resp.status();
        let body = resp.text().await.unwrap_or_default();
        return Err(format!("token request rejected ({status}): {body}"));
    }
    let tr: TokenResponse = resp
        .json()
        .await
        .map_err(|e| format!("could not parse token response: {e}"))?;

    let cached = CachedToken::from_response(tr, now_secs());
    let token = cached.access_token.clone();
    *state.token.lock().unwrap() = Some(cached);
    Ok(token)
}

/// Run the consent flow: open Battle.net in the system browser, wait for the loopback callback,
/// exchange the code, and store the resulting token in the keychain.
///
/// Resolves only once the round trip finishes, so the UI can drive it with a single call and show a
/// pending state meanwhile. The client secret is read here and never leaves Rust — the same rule the
/// client-credentials path follows.
#[tauri::command]
async fn begin_account_login(app: tauri::AppHandle) -> Result<(), String> {
    let payload = cred_entry()?
        .get_password()
        .map_err(|_| "No Battle.net credentials saved. Add them in the app first.".to_string())?;
    let (client_id, client_secret) = parse_stored_credentials(&payload)?;

    let state = account_auth::new_state()?;
    let url = account_auth::authorize_url(client_id, &state);

    // Bind the port *before* sending the browser anywhere: if the port is unavailable, failing here
    // is far clearer than sending the user through a consent screen that then dead-ends.
    let expected = state.clone();
    let waiting =
        tauri::async_runtime::spawn_blocking(move || account_auth::await_callback(&expected));

    tauri_plugin_opener::OpenerExt::opener(&app)
        .open_url(url, None::<&str>)
        .map_err(|e| format!("could not open the browser: {e}"))?;

    let code = waiting
        .await
        .map_err(|e| format!("callback listener stopped unexpectedly: {e}"))??;

    let token = account_auth::exchange_code(client_id, client_secret, &code).await?;
    let expires_at = now_secs() + token.expires_in;
    account_entry()?
        .set_password(&format!("{}\n{}", token.access_token, expires_at))
        .map_err(|e| e.to_string())?;
    Ok(())
}

/// Whether a usable account grant is stored.
///
/// Expiry counts as not-connected: Blizzard issues no refresh token, so a stale grant can only be
/// replaced by consenting again, and reporting it as connected would strand the UI.
#[tauri::command]
fn has_account_grant() -> bool {
    account_entry()
        .and_then(|e| e.get_password().map_err(|err| err.to_string()))
        .ok()
        .and_then(|p| parse_stored_grant(&p).map(|(_, expires_at)| expires_at))
        .is_some_and(|expires_at| now_secs() + EXPIRY_SKEW_SECS < expires_at)
}

/// Forget the account grant. Deliberately leaves the client credentials alone.
#[tauri::command]
fn clear_account_grant() -> Result<(), String> {
    if let Ok(entry) = account_entry() {
        let _ = entry.delete_credential();
    }
    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    // Keeps the pre-extraction override working now that the Bot Ops backend is the vendored
    // `bot-ops` crate; it also honours the crate's own `BOT_OPS_CONFIG`.
    bot_ops::set_config_env_var("WOW_COMPANION_OPS_CONFIG");

    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_http::init())
        // In-app updater (+ process, for the relaunch after an update installs).
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        .manage(AppState::default())
        .invoke_handler(tauri::generate_handler![
            save_credentials,
            has_credentials,
            clear_credentials,
            get_access_token,
            begin_account_login,
            has_account_grant,
            clear_account_grant,
            account_profile::get_account_profile,
            warband::get_warband,
            bot_ops::commands::ops_config,
            bot_ops::commands::bot_status,
            bot_ops::commands::bot_logs,
            bot_ops::commands::bot_restart,
            bot_ops::commands::bot_env_get,
            bot_ops::commands::bot_env_set
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

#[cfg(test)]
mod tests {
    use super::*;

    fn token(expires_at: u64) -> CachedToken {
        CachedToken {
            access_token: "abc".into(),
            expires_at,
        }
    }

    #[test]
    fn cache_hit_while_outside_the_skew_window() {
        let t = token(1000);
        // now + EXPIRY_SKEW_SECS (60) < 1000 while now < 940.
        assert!(t.is_valid_at(0));
        assert!(t.is_valid_at(900));
        assert!(t.is_valid_at(939));
    }

    #[test]
    fn cache_miss_at_the_skew_boundary_and_after_expiry() {
        let t = token(1000);
        // Exactly at the boundary (now + 60 == 1000) is a miss — the check is strict `<`.
        assert!(!t.is_valid_at(940));
        // Inside the refresh window.
        assert!(!t.is_valid_at(970));
        // Past the real expiry.
        assert!(!t.is_valid_at(1000));
        assert!(!t.is_valid_at(1200));
    }

    #[test]
    fn from_response_stamps_absolute_expiry_and_is_immediately_valid() {
        let tr = TokenResponse {
            access_token: "tok".into(),
            expires_in: 3600,
        };
        let cached = CachedToken::from_response(tr, 1_000);
        assert_eq!(cached.access_token, "tok");
        assert_eq!(cached.expires_at, 4_600);
        // Fresh token is usable right away: 1000 + 60 < 4600.
        assert!(cached.is_valid_at(1_000));
    }

    #[test]
    fn token_response_parses_and_ignores_extra_battlenet_fields() {
        // Battle.net returns `token_type`/`scope`/`sub` too; we deserialize only what we use.
        let json = r#"{"access_token":"xyz","token_type":"bearer","expires_in":86399,"sub":"..."}"#;
        let tr: TokenResponse = serde_json::from_str(json).expect("parse token response");
        assert_eq!(tr.access_token, "xyz");
        assert_eq!(tr.expires_in, 86399);
    }

    #[test]
    fn parse_stored_credentials_splits_on_the_first_newline() {
        assert_eq!(
            parse_stored_credentials("id123\nsecret456").unwrap(),
            ("id123", "secret456")
        );
        // A secret containing a newline keeps everything after the first split point.
        assert_eq!(
            parse_stored_credentials("id\nsec\nret").unwrap(),
            ("id", "sec\nret")
        );
    }

    #[test]
    fn parse_stored_credentials_rejects_a_blob_with_no_newline() {
        assert!(parse_stored_credentials("no-newline-here").is_err());
    }

    #[test]
    fn parse_stored_grant_reads_the_token_and_its_absolute_expiry() {
        assert_eq!(
            parse_stored_grant("tok-abc\n1785200000"),
            Some(("tok-abc", 1785200000))
        );
    }

    #[test]
    fn parse_stored_grant_rejects_anything_it_cannot_trust() {
        // Each of these would otherwise be reported as a usable grant and strand the UI on a token
        // that can't work — with no refresh path to recover through.
        for payload in [
            "tok-abc",               // no expiry at all
            "tok-abc\nnot-a-number", // unparseable expiry
            "\n1785200000",          // empty token
            "",
        ] {
            assert_eq!(parse_stored_grant(payload), None, "payload: {payload:?}");
        }
    }

    #[test]
    fn the_account_grant_is_stored_separately_from_the_client_credentials() {
        // The two authorisations are independent: disconnecting an account must not disturb the
        // credentials every data tab depends on.
        assert_ne!(KEYRING_ACCOUNT, KEYRING_ACCOUNT_GRANT);
    }
}
