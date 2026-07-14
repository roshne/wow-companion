// WoW Companion — Tauri backend.
//
// The Battle.net client SECRET lives only here (in the OS keychain). The webview never sees it:
// the frontend asks Rust for a short-lived bearer token via `get_access_token`, and makes the
// actual data-API calls through the Tauri HTTP plugin (which also sidesteps webview CORS).

use std::sync::Mutex;
use std::time::{SystemTime, UNIX_EPOCH};

use serde::Deserialize;
use tauri::State;

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

/// Return a valid client-credentials access token, fetching and caching as needed.
/// The secret is read from the keychain here and never returned to the frontend.
#[tauri::command]
async fn get_access_token(state: State<'_, AppState>) -> Result<String, String> {
    // 1. Cached and still valid?
    {
        let guard = state.token.lock().unwrap();
        if let Some(t) = guard.as_ref() {
            if now_secs() + EXPIRY_SKEW_SECS < t.expires_at {
                return Ok(t.access_token.clone());
            }
        }
    }

    // 2. Read credentials from the keychain.
    let payload = cred_entry()?
        .get_password()
        .map_err(|_| "No Battle.net credentials saved. Add them in the app first.".to_string())?;
    let (client_id, client_secret) = payload
        .split_once('\n')
        .ok_or_else(|| "Stored credentials are malformed.".to_string())?;

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

    let token = tr.access_token.clone();
    *state.token.lock().unwrap() = Some(CachedToken {
        access_token: tr.access_token,
        expires_at: now_secs() + tr.expires_in,
    });
    Ok(token)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_http::init())
        .manage(AppState::default())
        .invoke_handler(tauri::generate_handler![
            save_credentials,
            has_credentials,
            clear_credentials,
            get_access_token,
            warband::get_warband
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
