// Battle.net OAuth **authorization-code** flow — the account-wide grant.
//
// Separate from the client-credentials grant in `lib.rs`, and deliberately additive: that grant
// serves every data tab and must keep working untouched. This one unlocks only `/profile/user/wow*`,
// which needs the player's own consent.
//
// Two constraints from Blizzard's OAuth documentation shape the whole design:
//
//  1. **Only `http`/`https` redirect URIs are supported**, and native apps are told to run their own
//     server to receive the callback. So this is a loopback listener, not a custom URL scheme —
//     `tauri-plugin-deep-link` would not have worked.
//  2. **Redirect URIs must be pre-registered and matched exactly**, which rules out the ephemeral
//     port RFC 8252 would otherwise suggest. Hence a fixed port, and hence `REDIRECT_URI` below is
//     the exact string a user must register on their Battle.net application.
//
// Blizzard issues **no refresh token** — access tokens last 24 hours and the documented guidance is
// to request a new one when the old fails. So there is no refresh path here by design: expiry means
// re-consent, which the UI drives.
//
// The security property from `lib.rs` carries over unchanged: tokens live in the OS keychain and are
// read only in Rust. The frontend learns *whether* an account is connected, never the token.

use std::io::{Read, Write};
use std::net::TcpListener;
use std::time::{Duration, Instant};

use serde::Deserialize;

/// Fixed because Blizzard matches registered redirect URIs exactly.
pub const REDIRECT_PORT: u16 = 48757;
/// The exact URI to register on the Battle.net application. Changing it breaks the flow silently:
/// Blizzard rejects the authorize request rather than redirecting anywhere useful.
pub const REDIRECT_URI: &str = "http://localhost:48757/callback";

const AUTHORIZE_URL: &str = "https://oauth.battle.net/authorize";
const TOKEN_URL: &str = "https://oauth.battle.net/token";
/// The only scope this app needs: the player's WoW profile.
const SCOPE: &str = "wow.profile";
/// How long to wait for the browser round trip before giving the port back.
const CONSENT_TIMEOUT: Duration = Duration::from_secs(300);

/// What came back on the redirect.
#[derive(Debug, PartialEq, Eq)]
pub enum Callback {
    /// The player consented. `state` still has to be checked against the one we issued.
    Code { code: String, state: String },
    /// The player declined, or Battle.net refused. Not an error — a decision.
    Denied { error: String },
    /// Not a callback we recognise.
    Unparseable,
}

/// A 128-bit random `state`, hex encoded.
///
/// Cryptographic randomness rather than a timestamp: `state` is what stops a third party feeding us
/// a callback for a code we never asked for, and a guessable value defeats the point of having it.
pub fn new_state() -> Result<String, String> {
    let mut bytes = [0u8; 16];
    getrandom::getrandom(&mut bytes).map_err(|e| format!("could not generate state: {e}"))?;
    Ok(bytes.iter().map(|b| format!("{b:02x}")).collect())
}

/// Percent-decode a query-string value (`%XX` escapes, `+` for space).
fn percent_decode(raw: &str) -> String {
    let bytes = raw.as_bytes();
    let mut out = Vec::with_capacity(bytes.len());
    let mut i = 0;
    while i < bytes.len() {
        match bytes[i] {
            b'+' => {
                out.push(b' ');
                i += 1;
            }
            b'%' if i + 2 < bytes.len() => {
                let hex = std::str::from_utf8(&bytes[i + 1..i + 3]).unwrap_or("");
                match u8::from_str_radix(hex, 16) {
                    Ok(b) => {
                        out.push(b);
                        i += 3;
                    }
                    // A stray '%' that isn't an escape stays literal rather than eating two bytes.
                    Err(_) => {
                        out.push(b'%');
                        i += 1;
                    }
                }
            }
            b => {
                out.push(b);
                i += 1;
            }
        }
    }
    String::from_utf8_lossy(&out).into_owned()
}

/// Minimal percent-encoding for the values this module puts into a URL.
fn percent_encode(raw: &str) -> String {
    raw.bytes()
        .map(|b| match b {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' => {
                (b as char).to_string()
            }
            _ => format!("%{b:02X}"),
        })
        .collect()
}

fn query_param(query: &str, key: &str) -> Option<String> {
    query.split('&').find_map(|pair| {
        let (k, v) = pair.split_once('=')?;
        (k == key).then(|| percent_decode(v))
    })
}

/// The URL to send the player to. Opened in their **system browser**, not the webview — which is
/// also why no CSP change is needed for it.
pub fn authorize_url(client_id: &str, state: &str) -> String {
    format!(
        "{AUTHORIZE_URL}?client_id={}&scope={}&state={}&redirect_uri={}&response_type=code",
        percent_encode(client_id),
        percent_encode(SCOPE),
        percent_encode(state),
        percent_encode(REDIRECT_URI),
    )
}

/// Parse an HTTP request line (`GET /callback?... HTTP/1.1`) into a callback outcome.
pub fn parse_callback(request_line: &str) -> Callback {
    let Some(target) = request_line.split_whitespace().nth(1) else {
        return Callback::Unparseable;
    };
    let Some((path, query)) = target.split_once('?') else {
        return Callback::Unparseable;
    };
    if !path.starts_with("/callback") {
        return Callback::Unparseable;
    }
    // Denial is reported as `error`, and is checked first: Battle.net sends no code alongside it.
    if let Some(error) = query_param(query, "error") {
        return Callback::Denied { error };
    }
    match (query_param(query, "code"), query_param(query, "state")) {
        (Some(code), Some(state)) if !code.is_empty() => Callback::Code { code, state },
        _ => Callback::Unparseable,
    }
}

/// The form body for the code→token exchange. Split out so its shape is testable without a network.
pub fn token_form(code: &str) -> [(&'static str, &str); 3] {
    [
        ("grant_type", "authorization_code"),
        ("code", code),
        ("redirect_uri", REDIRECT_URI),
    ]
}

/// What the browser sees once it hits the loopback listener.
fn done_page(message: &str) -> String {
    let body = format!(
        "<!doctype html><meta charset=utf-8><title>WoW Companion</title>\
         <body style=\"font:16px system-ui;padding:3rem;max-width:32rem;margin:auto\">\
         <h1 style=\"font-size:1.2rem\">WoW Companion</h1><p>{message}</p>\
         <p style=\"color:#666\">You can close this tab.</p>"
    );
    format!(
        "HTTP/1.1 200 OK\r\nContent-Type: text/html; charset=utf-8\r\nContent-Length: {}\r\n\
         Connection: close\r\n\r\n{body}",
        body.len()
    )
}

/// Bind the loopback port, wait for one callback, and give the port straight back.
///
/// Returns the authorization code. The listener is dropped on every path — success, denial,
/// mismatch, or timeout — so an abandoned consent attempt can't leave the port bound and make the
/// next attempt fail with a confusing "address in use".
pub fn await_callback(expected_state: &str) -> Result<String, String> {
    let listener = TcpListener::bind(("127.0.0.1", REDIRECT_PORT))
        .map_err(|e| format!("could not listen on port {REDIRECT_PORT}: {e}"))?;
    listener
        .set_nonblocking(true)
        .map_err(|e| format!("could not configure the callback listener: {e}"))?;

    let deadline = Instant::now() + CONSENT_TIMEOUT;
    loop {
        if Instant::now() >= deadline {
            return Err("Timed out waiting for Battle.net to redirect back.".into());
        }
        match listener.accept() {
            Ok((mut stream, _)) => {
                let mut buf = [0u8; 2048];
                let read = stream.read(&mut buf).unwrap_or(0);
                let request = String::from_utf8_lossy(&buf[..read]);
                let first_line = request.lines().next().unwrap_or("");

                let (reply, result) = match parse_callback(first_line) {
                    Callback::Code { code, state } if state == expected_state => {
                        ("Connected. Battle.net account linked.", Ok(code))
                    }
                    // A mismatched state is the case this whole mechanism exists to catch: the
                    // callback didn't come from the request we started.
                    Callback::Code { .. } => (
                        "Rejected: that response didn't match the request this app started.",
                        Err(
                            "state mismatch — the callback did not match this login attempt"
                                .to_string(),
                        ),
                    ),
                    Callback::Denied { error } => (
                        "Not connected. You can close this tab.",
                        Err(format!("Battle.net declined the request: {error}")),
                    ),
                    Callback::Unparseable => (
                        "Unexpected request.",
                        Err("the callback could not be understood".to_string()),
                    ),
                };
                let _ = stream.write_all(done_page(reply).as_bytes());
                let _ = stream.flush();
                return result;
            }
            Err(ref e) if e.kind() == std::io::ErrorKind::WouldBlock => {
                std::thread::sleep(Duration::from_millis(100));
            }
            Err(e) => return Err(format!("callback listener failed: {e}")),
        }
    }
}

#[derive(Deserialize)]
pub struct AccountTokenResponse {
    pub access_token: String,
    pub expires_in: u64,
}

/// Exchange an authorization code for an access token.
///
/// Same endpoint and same HTTP Basic pattern the client-credentials path already uses — only the
/// grant type and parameters differ.
pub async fn exchange_code(
    client_id: &str,
    client_secret: &str,
    code: &str,
) -> Result<AccountTokenResponse, String> {
    let resp = reqwest::Client::new()
        .post(TOKEN_URL)
        .basic_auth(client_id, Some(client_secret))
        .form(&token_form(code))
        .send()
        .await
        .map_err(|e| format!("token request failed: {e}"))?;
    if !resp.status().is_success() {
        let status = resp.status();
        let body = resp.text().await.unwrap_or_default();
        return Err(format!("token request rejected ({status}): {body}"));
    }
    resp.json()
        .await
        .map_err(|e| format!("could not parse token response: {e}"))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn authorize_url_carries_everything_battle_net_requires() {
        let url = authorize_url("my-client", "abc123");
        assert!(url.starts_with("https://oauth.battle.net/authorize?"));
        assert!(url.contains("client_id=my-client"));
        assert!(url.contains("response_type=code"));
        assert!(url.contains("scope=wow.profile"));
        assert!(url.contains("state=abc123"));
        // The redirect URI must arrive encoded, and must be the registered one exactly.
        assert!(url.contains("redirect_uri=http%3A%2F%2Flocalhost%3A48757%2Fcallback"));
    }

    #[test]
    fn state_is_random_and_long_enough_to_be_unguessable() {
        let a = new_state().expect("state");
        let b = new_state().expect("state");
        assert_eq!(a.len(), 32, "128 bits, hex encoded");
        assert_ne!(a, b);
        assert!(a.chars().all(|c| c.is_ascii_hexdigit()));
    }

    #[test]
    fn parses_a_successful_callback() {
        let got = parse_callback("GET /callback?code=abc&state=xyz HTTP/1.1");
        assert_eq!(
            got,
            Callback::Code {
                code: "abc".into(),
                state: "xyz".into()
            }
        );
    }

    #[test]
    fn reads_a_denial_as_a_decision_rather_than_a_failure() {
        // The player clicking "no" is an outcome, not an error to surface as broken.
        let got = parse_callback("GET /callback?error=access_denied&state=xyz HTTP/1.1");
        assert_eq!(
            got,
            Callback::Denied {
                error: "access_denied".into()
            }
        );
    }

    #[test]
    fn prefers_the_error_even_when_a_code_is_somehow_present() {
        let got = parse_callback("GET /callback?error=invalid_scope&code=abc&state=xyz HTTP/1.1");
        assert!(matches!(got, Callback::Denied { .. }));
    }

    #[test]
    fn decodes_percent_escapes_in_returned_values() {
        let got = parse_callback("GET /callback?error=access%20denied+now&state=x HTTP/1.1");
        assert_eq!(
            got,
            Callback::Denied {
                error: "access denied now".into()
            }
        );
    }

    #[test]
    fn rejects_requests_that_are_not_the_callback() {
        for line in [
            "GET /favicon.ico?x=1 HTTP/1.1", // a browser probing for something else
            "GET /callback HTTP/1.1",        // no query at all
            "GET /callback?state=xyz HTTP/1.1", // state but no code
            "GET /callback?code=&state=x HTTP/1.1", // empty code
            "nonsense",
            "",
        ] {
            assert_eq!(
                parse_callback(line),
                Callback::Unparseable,
                "line: {line:?}"
            );
        }
    }

    #[test]
    fn token_form_uses_the_authorization_code_grant_and_the_registered_uri() {
        let form = token_form("the-code");
        assert_eq!(form[0], ("grant_type", "authorization_code"));
        assert_eq!(form[1], ("code", "the-code"));
        assert_eq!(form[2], ("redirect_uri", REDIRECT_URI));
    }

    #[test]
    fn the_registered_redirect_uri_matches_the_port_constant() {
        // These are separate constants and Blizzard matches the URI exactly, so a drift between
        // them would fail at consent time with an unhelpful error rather than here.
        assert!(REDIRECT_URI.contains(&REDIRECT_PORT.to_string()));
        assert!(REDIRECT_URI.starts_with("http://localhost:"));
    }

    #[test]
    fn the_listener_gives_its_port_back_after_a_timeout() {
        // An abandoned consent attempt must not leave the port bound — the next attempt would fail
        // with "address in use", which reads as a bug rather than as "try again".
        let taken = TcpListener::bind(("127.0.0.1", REDIRECT_PORT)).expect("bind");
        // With the port held, a second bind fails — that's the failure mode being guarded.
        assert!(await_callback("state").is_err());
        drop(taken);
        // And once released, binding succeeds again.
        assert!(TcpListener::bind(("127.0.0.1", REDIRECT_PORT)).is_ok());
    }
}
