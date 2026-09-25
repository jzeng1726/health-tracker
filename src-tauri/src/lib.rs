//! Health Tracker desktop shell.
//!
//! Security model
//! - Google OAuth 2.0 installed-app flow with PKCE and a 127.0.0.1 loopback redirect.
//! - The refresh token lives only in the OS credential store (macOS Keychain /
//!   Windows Credential Manager). The access token lives only in memory here.
//! - JavaScript never sees a token: it asks `google_request` to call a Google
//!   API URL, and that command refuses any host other than Google's API hosts.
//! - Local cache = SQLite file in the app data folder (sheet snapshots + settings).

use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine};
use rand::{distributions::Alphanumeric, Rng};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::sync::Mutex;
use std::time::{Duration, Instant};
use tauri::{Manager, State};
use tauri_plugin_opener::OpenerExt;
use tokio::io::{AsyncReadExt, AsyncWriteExt};

const AUTH_URL: &str = "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN_URL: &str = "https://oauth2.googleapis.com/token";
/// Minimum scopes: list the folder (Drive read-only), create only the app's own
/// two files (drive.file), read/write sheets for Quick Entry.
const SCOPES: &str = "https://www.googleapis.com/auth/drive.readonly https://www.googleapis.com/auth/drive.file https://www.googleapis.com/auth/spreadsheets";
const KEYRING_SERVICE: &str = "com.jeffreyzeng.healthtracker";
const KEY_REFRESH: &str = "google-refresh-token";
const KEY_EMAIL: &str = "google-account-email";
const KEY_CLIENT_ID: &str = "google-oauth-client-id";
const KEY_CLIENT_SECRET: &str = "google-oauth-client-secret";
const ALLOWED_HOSTS: [&str; 2] = ["https://www.googleapis.com/", "https://sheets.googleapis.com/"];

struct AccessToken {
    token: String,
    expires_at: Instant,
}

pub struct AppState {
    http: reqwest::Client,
    token: tokio::sync::Mutex<Option<AccessToken>>,
    db: Mutex<rusqlite::Connection>,
}

/// Where the OAuth client credentials come from, in priority order:
/// 1. pasted by the user in the app (stored in the OS keychain),
/// 2. baked in at build time (GitHub Actions secrets),
/// 3. runtime env vars (local development).
fn client_credentials() -> Result<(String, String, &'static str), String> {
    if let (Some(i), Some(s)) = (read_secret(KEY_CLIENT_ID), read_secret(KEY_CLIENT_SECRET)) {
        let (i, s) = (i.trim().to_string(), s.trim().to_string());
        if !i.is_empty() && !s.is_empty() {
            return Ok((i, s, "saved in this app"));
        }
    }
    let (i, s) = (env!("HT_GOOGLE_CLIENT_ID").trim(), env!("HT_GOOGLE_CLIENT_SECRET").trim());
    if !i.is_empty() && !s.is_empty() {
        return Ok((i.to_string(), s.to_string(), "built into this version"));
    }
    if let (Ok(i), Ok(s)) = (std::env::var("GOOGLE_CLIENT_ID"), std::env::var("GOOGLE_CLIENT_SECRET")) {
        if !i.trim().is_empty() && !s.trim().is_empty() {
            return Ok((i.trim().to_string(), s.trim().to_string(), "environment"));
        }
    }
    Err("CONFIG: No Google OAuth credentials yet. Paste your Google OAuth JSON under \"Use my Google credentials file\".".into())
}

/// Safe-to-show fingerprint: length and last 4 characters only.
fn fingerprint(s: &str) -> String {
    let tail: String = s.chars().rev().take(4).collect::<Vec<_>>().into_iter().rev().collect();
    format!("{} characters, ending \u{2026}{}", s.chars().count(), tail)
}

fn keyring_entry(name: &str) -> Result<keyring::Entry, String> {
    keyring::Entry::new(KEYRING_SERVICE, name).map_err(|e| format!("UNKNOWN: credential store unavailable: {e}"))
}

fn read_secret(name: &str) -> Option<String> {
    keyring_entry(name).ok()?.get_password().ok()
}

fn random_string(len: usize) -> String {
    rand::thread_rng().sample_iter(&Alphanumeric).take(len).map(char::from).collect()
}

fn net_err(e: reqwest::Error) -> String {
    if e.is_connect() || e.is_timeout() || e.is_request() {
        format!("OFFLINE: {e}")
    } else {
        format!("UNKNOWN: {e}")
    }
}

#[derive(Deserialize)]
struct TokenResponse {
    access_token: String,
    expires_in: Option<u64>,
    refresh_token: Option<String>,
}

#[derive(Serialize)]
pub struct AuthStatus {
    connected: bool,
    email: Option<String>,
}

// ------------------------------------------------------------------ auth

#[tauri::command]
fn auth_status() -> AuthStatus {
    AuthStatus { connected: read_secret(KEY_REFRESH).is_some(), email: read_secret(KEY_EMAIL) }
}

#[tauri::command]
async fn auth_disconnect(state: State<'_, AppState>) -> Result<(), String> {
    *state.token.lock().await = None;
    if let Ok(e) = keyring_entry(KEY_REFRESH) { let _ = e.delete_credential(); }
    if let Ok(e) = keyring_entry(KEY_EMAIL) { let _ = e.delete_credential(); }
    Ok(())
}

#[tauri::command]
async fn auth_connect(app: tauri::AppHandle, state: State<'_, AppState>) -> Result<AuthStatus, String> {
    let (client_id, client_secret, cred_source) = client_credentials()?;
    let verifier = random_string(64);
    let challenge = URL_SAFE_NO_PAD.encode(Sha256::digest(verifier.as_bytes()));
    let csrf = random_string(24);

    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.map_err(|e| format!("UNKNOWN: loopback: {e}"))?;
    let port = listener.local_addr().map_err(|e| format!("UNKNOWN: {e}"))?.port();
    let redirect = format!("http://127.0.0.1:{port}");

    let mut url = url::Url::parse(AUTH_URL).unwrap();
    url.query_pairs_mut()
        .append_pair("client_id", &client_id)
        .append_pair("redirect_uri", &redirect)
        .append_pair("response_type", "code")
        .append_pair("scope", SCOPES)
        .append_pair("code_challenge", &challenge)
        .append_pair("code_challenge_method", "S256")
        .append_pair("state", &csrf)
        .append_pair("access_type", "offline")
        .append_pair("prompt", "consent");
    app.opener().open_url(url.as_str(), None::<&str>).map_err(|e| format!("UNKNOWN: could not open the browser: {e}"))?;

    // Wait (max 5 minutes) for Google to redirect the browser back to us.
    let code = tokio::time::timeout(Duration::from_secs(300), async {
        loop {
            let (mut sock, _) = listener.accept().await.map_err(|e| format!("UNKNOWN: {e}"))?;
            let mut buf = vec![0u8; 8192];
            let n = sock.read(&mut buf).await.unwrap_or(0);
            let req = String::from_utf8_lossy(&buf[..n]).to_string();
            let path = req.split_whitespace().nth(1).unwrap_or("/").to_string();
            let parsed = url::Url::parse(&format!("http://127.0.0.1{path}")).ok();
            let q = |k: &str| parsed.as_ref().and_then(|u| u.query_pairs().find(|(a, _)| a == k).map(|(_, v)| v.to_string()));
            let (code, err, st) = (q("code"), q("error"), q("state"));
            if code.is_none() && err.is_none() {
                let _ = sock.write_all(b"HTTP/1.1 404 Not Found\r\nContent-Length: 0\r\nConnection: close\r\n\r\n").await;
                continue; // e.g. /favicon.ico
            }
            let ok = code.is_some() && st.as_deref() == Some(csrf.as_str());
            let body = if ok {
                "<html><body style=\"font-family:system-ui;padding:40px\"><h2>Connected to Google.</h2><p>You can close this tab and go back to Health Tracker.</p></body></html>"
            } else {
                "<html><body style=\"font-family:system-ui;padding:40px\"><h2>Google sign-in was not completed.</h2><p>Go back to Health Tracker and click Reconnect Google to try again.</p></body></html>"
            };
            let resp = format!("HTTP/1.1 200 OK\r\nContent-Type: text/html; charset=utf-8\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}", body.len(), body);
            let _ = sock.write_all(resp.as_bytes()).await;
            if !ok {
                return Err(format!("AUTH_REQUIRED: sign-in cancelled or failed ({})", err.unwrap_or_else(|| "state mismatch".into())));
            }
            return Ok(code.unwrap());
        }
    })
    .await
    .map_err(|_| "AUTH_REQUIRED: timed out waiting for Google sign-in".to_string())??;

    let resp = state
        .http
        .post(TOKEN_URL)
        .form(&[
            ("code", code.as_str()),
            ("client_id", client_id.as_str()),
            ("client_secret", client_secret.as_str()),
            ("redirect_uri", redirect.as_str()),
            ("grant_type", "authorization_code"),
            ("code_verifier", verifier.as_str()),
        ])
        .send()
        .await
        .map_err(net_err)?;
    if !resp.status().is_success() {
        let t = resp.text().await.unwrap_or_default();
        if t.contains("invalid_client") {
            return Err(format!(
                "AUTH_REQUIRED: Google rejected the client secret ({cred_source}: {}). Paste your Google OAuth JSON under \"Use my Google credentials file\" and try again.",
                fingerprint(&client_secret)
            ));
        }
        return Err(format!("AUTH_REQUIRED: token exchange failed: {t}"));
    }
    let tok: TokenResponse = resp.json().await.map_err(|e| format!("UNKNOWN: {e}"))?;
    let refresh = tok.refresh_token.ok_or("AUTH_REQUIRED: Google did not return a refresh token — try Reconnect again")?;
    keyring_entry(KEY_REFRESH)?.set_password(&refresh).map_err(|e| format!("UNKNOWN: could not save to the credential store: {e}"))?;
    *state.token.lock().await = Some(AccessToken {
        token: tok.access_token.clone(),
        expires_at: Instant::now() + Duration::from_secs(tok.expires_in.unwrap_or(3600)),
    });

    // account email for display (Drive "about" works with drive.readonly)
    let email = state
        .http
        .get("https://www.googleapis.com/drive/v3/about?fields=user(emailAddress)")
        .bearer_auth(&tok.access_token)
        .send()
        .await
        .ok();
    let email = match email {
        Some(r) => r.json::<serde_json::Value>().await.ok().and_then(|v| v["user"]["emailAddress"].as_str().map(String::from)),
        None => None,
    };
    if let (Some(e), Ok(k)) = (&email, keyring_entry(KEY_EMAIL)) { let _ = k.set_password(e); }
    Ok(AuthStatus { connected: true, email })
}

async fn access_token(state: &AppState, force: bool) -> Result<String, String> {
    let mut guard = state.token.lock().await;
    if !force {
        if let Some(t) = guard.as_ref() {
            if t.expires_at > Instant::now() + Duration::from_secs(60) {
                return Ok(t.token.clone());
            }
        }
    }
    let refresh = read_secret(KEY_REFRESH).ok_or("AUTH_REQUIRED: not connected to Google")?;
    let (client_id, client_secret, _) = client_credentials()?;
    let resp = state
        .http
        .post(TOKEN_URL)
        .form(&[
            ("refresh_token", refresh.as_str()),
            ("client_id", client_id.as_str()),
            ("client_secret", client_secret.as_str()),
            ("grant_type", "refresh_token"),
        ])
        .send()
        .await
        .map_err(net_err)?;
    if !resp.status().is_success() {
        // invalid_grant = Testing-mode 7-day expiry or revoked access
        *guard = None;
        return Err("AUTH_EXPIRED: Google sign-in expired".into());
    }
    let tok: TokenResponse = resp.json().await.map_err(|e| format!("UNKNOWN: {e}"))?;
    let token = tok.access_token.clone();
    *guard = Some(AccessToken { token: tok.access_token, expires_at: Instant::now() + Duration::from_secs(tok.expires_in.unwrap_or(3600)) });
    Ok(token)
}

#[derive(Serialize)]
pub struct CredentialsInfo {
    source: Option<String>,
    client_id_end: Option<String>,
    secret: Option<String>,
}

#[tauri::command]
fn credentials_info() -> CredentialsInfo {
    match client_credentials() {
        Ok((id, secret, source)) => CredentialsInfo {
            source: Some(source.into()),
            client_id_end: Some(id.split('-').next().unwrap_or("").chars().take(12).collect()),
            secret: Some(fingerprint(&secret)),
        },
        Err(_) => CredentialsInfo { source: None, client_id_end: None, secret: None },
    }
}

/// Accepts the whole downloaded OAuth JSON file ({"installed":{...}}) or just its inner object.
#[tauri::command]
async fn set_client_credentials(state: State<'_, AppState>, json: String) -> Result<CredentialsInfo, String> {
    let v: serde_json::Value = serde_json::from_str(json.trim())
        .map_err(|_| "CONFIG: That doesn't look like the Google JSON file — paste its entire contents, starting with {".to_string())?;
    let inner = v.get("installed").or_else(|| v.get("web")).unwrap_or(&v);
    let id = inner["client_id"].as_str().unwrap_or("").trim().to_string();
    let secret = inner["client_secret"].as_str().unwrap_or("").trim().to_string();
    if !id.ends_with(".apps.googleusercontent.com") || secret.is_empty() {
        return Err("CONFIG: The JSON needs both client_id (ending in .apps.googleusercontent.com) and client_secret.".into());
    }
    keyring_entry(KEY_CLIENT_ID)?.set_password(&id).map_err(|e| format!("UNKNOWN: {e}"))?;
    keyring_entry(KEY_CLIENT_SECRET)?.set_password(&secret).map_err(|e| format!("UNKNOWN: {e}"))?;
    *state.token.lock().await = None;
    Ok(credentials_info())
}

#[tauri::command]
fn clear_client_credentials() -> CredentialsInfo {
    if let Ok(e) = keyring_entry(KEY_CLIENT_ID) { let _ = e.delete_credential(); }
    if let Ok(e) = keyring_entry(KEY_CLIENT_SECRET) { let _ = e.delete_credential(); }
    credentials_info()
}

// ------------------------------------------------------------------ Google API proxy

#[tauri::command]
async fn google_request(state: State<'_, AppState>, method: String, url: String, body: Option<String>) -> Result<String, String> {
    if !ALLOWED_HOSTS.iter().any(|h| url.starts_with(h)) {
        return Err("UNKNOWN: refused to send the Google token to a non-Google URL".into());
    }
    let m = reqwest::Method::from_bytes(method.as_bytes()).map_err(|_| "UNKNOWN: bad method".to_string())?;
    for attempt in 0..2 {
        let token = access_token(&state, attempt == 1).await?;
        let mut req = state.http.request(m.clone(), &url).bearer_auth(&token).timeout(Duration::from_secs(60));
        if let Some(b) = &body {
            req = req.header("Content-Type", "application/json").body(b.clone());
        }
        let resp = req.send().await.map_err(net_err)?;
        let status = resp.status();
        let text = resp.text().await.map_err(net_err)?;
        if status.is_success() {
            return Ok(text);
        }
        if status.as_u16() == 401 && attempt == 0 {
            continue; // access token expired early: refresh once and retry
        }
        let msg = serde_json::from_str::<serde_json::Value>(&text)
            .ok()
            .and_then(|v| v["error"]["message"].as_str().map(String::from))
            .unwrap_or_else(|| text.chars().take(300).collect());
        if status.as_u16() == 401 || (status.as_u16() == 403 && msg.to_lowercase().contains("insufficient")) {
            return Err(format!("AUTH_EXPIRED: {msg}"));
        }
        return Err(format!("HTTP:{}: {}", status.as_u16(), msg));
    }
    Err("AUTH_EXPIRED: Google rejected the sign-in".into())
}

// ------------------------------------------------------------------ SQLite cache

#[tauri::command]
fn cache_get(state: State<'_, AppState>, key: String) -> Result<Option<String>, String> {
    let db = state.db.lock().map_err(|e| e.to_string())?;
    let mut stmt = db.prepare_cached("SELECT value FROM kv WHERE key = ?1").map_err(|e| e.to_string())?;
    let mut rows = stmt.query([key]).map_err(|e| e.to_string())?;
    Ok(match rows.next().map_err(|e| e.to_string())? {
        Some(r) => Some(r.get(0).map_err(|e| e.to_string())?),
        None => None,
    })
}

#[tauri::command]
fn cache_put(state: State<'_, AppState>, key: String, value: String) -> Result<(), String> {
    let db = state.db.lock().map_err(|e| e.to_string())?;
    db.execute(
        "INSERT INTO kv(key, value, updated_at) VALUES(?1, ?2, strftime('%s','now')) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at",
        [key, value],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
fn cache_clear(state: State<'_, AppState>) -> Result<(), String> {
    let db = state.db.lock().map_err(|e| e.to_string())?;
    db.execute("DELETE FROM kv", []).map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
fn device_name() -> String {
    hostname::get().ok().and_then(|h| h.into_string().ok()).unwrap_or_else(|| "this computer".into())
}

fn open_db(app: &tauri::AppHandle) -> rusqlite::Connection {
    let dir = app.path().app_data_dir().expect("app data dir");
    std::fs::create_dir_all(&dir).ok();
    let path = dir.join("cache.sqlite");
    let conn = rusqlite::Connection::open(&path).unwrap_or_else(|_| rusqlite::Connection::open_in_memory().unwrap());
    conn.execute_batch(
        "PRAGMA journal_mode=WAL; CREATE TABLE IF NOT EXISTS kv(key TEXT PRIMARY KEY, value TEXT NOT NULL, updated_at INTEGER NOT NULL DEFAULT 0);",
    )
    .ok();
    conn
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .setup(|app| {
            let db = open_db(app.handle());
            app.manage(AppState {
                http: reqwest::Client::builder().user_agent("HealthTracker/desktop").build().expect("http client"),
                token: tokio::sync::Mutex::new(None),
                db: Mutex::new(db),
            });
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            auth_status,
            auth_connect,
            auth_disconnect,
            google_request,
            cache_get,
            cache_put,
            cache_clear,
            device_name,
            credentials_info,
            set_client_credentials,
            clear_client_credentials
        ])
        .run(tauri::generate_context!())
        .expect("error while running Health Tracker");
}
