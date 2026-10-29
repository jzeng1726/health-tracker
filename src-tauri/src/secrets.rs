//! Where the app keeps its secrets (Google refresh token, account email, optional OAuth client).
//!
//! macOS: a private file, `secrets.json`, in the app data folder, readable only by your
//!   macOS user (permissions 0600). The app is unsigned, so macOS treats every update as a
//!   new app and the Keychain asked for your password once per item after each update.
//!   On first launch of v0.1.7 the old Keychain items are copied into the file once; after
//!   that the Keychain is never touched again.
//! Windows / Linux: the OS credential store, as before (no prompts there).

use std::collections::BTreeMap;
use std::path::{Path, PathBuf};
use std::sync::{Mutex, OnceLock};

pub const SERVICE: &str = "com.jeffreyzeng.healthtracker";

static FILE_STORE: OnceLock<FileStore> = OnceLock::new();

fn use_file() -> bool {
    cfg!(target_os = "macos")
}

/// Call once at startup with the app data folder and every secret name the app uses.
pub fn init(app_data_dir: &Path, legacy_keys: &[&str]) {
    if !use_file() {
        return;
    }
    let store = FileStore::open(app_data_dir.join("secrets.json"));
    if !store.migrated() {
        let mut found = BTreeMap::new();
        for k in legacy_keys {
            if let Some(v) = keychain_get(k) {
                found.insert(k.to_string(), v);
            }
        }
        store.finish_migration(found);
    }
    let _ = FILE_STORE.set(store);
}

pub fn get(name: &str) -> Option<String> {
    if use_file() {
        return FILE_STORE.get()?.get(name);
    }
    keychain_get(name)
}

pub fn set(name: &str, value: &str) -> Result<(), String> {
    if use_file() {
        return FILE_STORE.get().ok_or("UNKNOWN: secret store not ready")?.set(name, value);
    }
    keyring::Entry::new(SERVICE, name)
        .and_then(|e| e.set_password(value))
        .map_err(|e| format!("UNKNOWN: could not save to the credential store: {e}"))
}

pub fn delete(name: &str) {
    if use_file() {
        if let Some(s) = FILE_STORE.get() {
            s.delete(name);
        }
        return;
    }
    if let Ok(e) = keyring::Entry::new(SERVICE, name) {
        let _ = e.delete_credential();
    }
}

fn keychain_get(name: &str) -> Option<String> {
    keyring::Entry::new(SERVICE, name).ok()?.get_password().ok()
}

// ------------------------------------------------------------------ file store

#[derive(serde::Serialize, serde::Deserialize, Default, Clone)]
struct FileData {
    #[serde(default)]
    migrated_from_keychain: bool,
    #[serde(default)]
    secrets: BTreeMap<String, String>,
}

pub struct FileStore {
    path: PathBuf,
    data: Mutex<FileData>,
}

impl FileStore {
    pub fn open(path: PathBuf) -> Self {
        let data = std::fs::read_to_string(&path)
            .ok()
            .and_then(|s| serde_json::from_str::<FileData>(&s).ok())
            .unwrap_or_default();
        FileStore { path, data: Mutex::new(data) }
    }

    pub fn migrated(&self) -> bool {
        self.data.lock().unwrap().migrated_from_keychain
    }

    /// Adds secrets copied from the old Keychain (never overwriting newer file values) and marks
    /// the migration done so the Keychain is not read again.
    pub fn finish_migration(&self, found: BTreeMap<String, String>) {
        let mut d = self.data.lock().unwrap();
        for (k, v) in found {
            d.secrets.entry(k).or_insert(v);
        }
        d.migrated_from_keychain = true;
        let _ = write_private(&self.path, &d);
    }

    pub fn get(&self, name: &str) -> Option<String> {
        self.data.lock().unwrap().secrets.get(name).cloned()
    }

    pub fn set(&self, name: &str, value: &str) -> Result<(), String> {
        let mut d = self.data.lock().unwrap();
        d.secrets.insert(name.to_string(), value.to_string());
        write_private(&self.path, &d).map_err(|e| format!("UNKNOWN: could not save the sign-in file: {e}"))
    }

    pub fn delete(&self, name: &str) {
        let mut d = self.data.lock().unwrap();
        if d.secrets.remove(name).is_some() {
            let _ = write_private(&self.path, &d);
        }
    }
}

/// Write via a temp file + rename so a crash never leaves half a file; owner-only permissions.
fn write_private(path: &Path, data: &FileData) -> std::io::Result<()> {
    use std::io::Write;
    if let Some(dir) = path.parent() {
        std::fs::create_dir_all(dir)?;
    }
    let tmp = path.with_extension("json.tmp");
    let _ = std::fs::remove_file(&tmp);
    let mut opts = std::fs::OpenOptions::new();
    opts.write(true).create_new(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        opts.mode(0o600);
    }
    let mut f = opts.open(&tmp)?;
    f.write_all(serde_json::to_string_pretty(data).unwrap_or_default().as_bytes())?;
    f.sync_all()?;
    drop(f);
    std::fs::rename(&tmp, path)?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        std::fs::set_permissions(path, std::fs::Permissions::from_mode(0o600))?;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn tmp_path(tag: &str) -> PathBuf {
        let d = std::env::temp_dir().join(format!("ht-secrets-{tag}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&d);
        d.join("secrets.json")
    }

    #[test]
    fn set_get_delete_survive_reopen() {
        let p = tmp_path("roundtrip");
        let s = FileStore::open(p.clone());
        assert_eq!(s.get("google-refresh-token"), None);
        s.set("google-refresh-token", "1//abc").unwrap();
        s.set("google-account-email", "me@example.com").unwrap();
        let s2 = FileStore::open(p.clone());
        assert_eq!(s2.get("google-refresh-token").as_deref(), Some("1//abc"));
        s2.delete("google-refresh-token");
        assert_eq!(FileStore::open(p.clone()).get("google-refresh-token"), None);
        assert_eq!(FileStore::open(p).get("google-account-email").as_deref(), Some("me@example.com"));
    }

    #[test]
    fn migration_runs_once_and_keeps_newer_values() {
        let p = tmp_path("migrate");
        let s = FileStore::open(p.clone());
        assert!(!s.migrated());
        s.set("google-account-email", "new@example.com").unwrap();
        let mut old = BTreeMap::new();
        old.insert("google-refresh-token".to_string(), "1//old".to_string());
        old.insert("google-account-email".to_string(), "old@example.com".to_string());
        s.finish_migration(old);
        let s2 = FileStore::open(p);
        assert!(s2.migrated());
        assert_eq!(s2.get("google-refresh-token").as_deref(), Some("1//old"));
        assert_eq!(s2.get("google-account-email").as_deref(), Some("new@example.com"));
    }

    #[cfg(unix)]
    #[test]
    fn file_is_private() {
        use std::os::unix::fs::PermissionsExt;
        let p = tmp_path("perms");
        FileStore::open(p.clone()).set("k", "v").unwrap();
        assert_eq!(std::fs::metadata(&p).unwrap().permissions().mode() & 0o777, 0o600);
    }

    #[test]
    fn corrupt_file_starts_empty() {
        let p = tmp_path("corrupt");
        std::fs::create_dir_all(p.parent().unwrap()).unwrap();
        std::fs::write(&p, "not json").unwrap();
        let s = FileStore::open(p);
        assert!(!s.migrated());
        assert_eq!(s.get("x"), None);
    }
}
