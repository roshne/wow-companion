// WoW Companion — Tauri backend.
//
// The Battle.net client SECRET lives only here (in the OS keychain). The webview never sees it:
// the frontend asks Rust for a short-lived bearer token via `get_access_token`, and makes the
// actual data-API calls through the Tauri HTTP plugin (which also sidesteps webview CORS).

use std::sync::Mutex;
use std::time::{SystemTime, UNIX_EPOCH};

use serde::Deserialize;
use tauri::State;

mod botops;
mod warband;

const KEYRING_SERVICE: &str = "wow-companion";
const KEYRING_ACCOUNT: &str = "battlenet-oauth-client";
const TOKEN_URL: &str = "https://oauth.battle.net/token";
/// Refresh this many seconds before expiry to avoid using a token that dies mid-request.
const EXPIRY_SKEW_SECS: u64 = 60;

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

fn now_secs() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0)
}

fn cred_entry() -> Result<keyring::Entry, String> {
    keyring::Entry::new(KEYRING_SERVICE, KEYRING_ACCOUNT).map_err(|e| e.to_string())
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

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
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
            warband::get_warband,
            botops::ops_config,
            botops::bot_status,
            botops::bot_logs,
            botops::bot_restart,
            botops::bot_env_get,
            botops::bot_env_set
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
}
