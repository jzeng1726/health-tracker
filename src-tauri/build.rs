fn main() {
    // GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET are baked in at build time (GitHub Actions secrets)
    println!("cargo:rerun-if-env-changed=GOOGLE_CLIENT_ID");
    println!("cargo:rerun-if-env-changed=GOOGLE_CLIENT_SECRET");
    tauri_build::build()
}
