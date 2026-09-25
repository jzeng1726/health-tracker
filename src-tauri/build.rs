fn main() {
    // Google OAuth client ID/secret come from GitHub Actions secrets at build time.
    // Re-emitting them as rustc-env from the build script (which re-runs whenever the
    // env var changes) forces a recompile, so a cached build can never keep an old secret.
    // Values are trimmed so a stray space or newline pasted into the secret can't break sign-in.
    println!("cargo:rerun-if-env-changed=GOOGLE_CLIENT_ID");
    println!("cargo:rerun-if-env-changed=GOOGLE_CLIENT_SECRET");
    let id = std::env::var("GOOGLE_CLIENT_ID").unwrap_or_default();
    let secret = std::env::var("GOOGLE_CLIENT_SECRET").unwrap_or_default();
    println!("cargo:rustc-env=HT_GOOGLE_CLIENT_ID={}", id.trim());
    println!("cargo:rustc-env=HT_GOOGLE_CLIENT_SECRET={}", secret.trim());
    tauri_build::build()
}
