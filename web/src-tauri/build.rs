fn main() {
    // The printing commands are allowed for the live web app (see capabilities/default.json).
    tauri_build::try_build(
        tauri_build::Attributes::new()
            .app_manifest(tauri_build::AppManifest::new().commands(&["list_printers", "print_raw", "print_tcp"])),
    )
    .expect("failed to run tauri-build");
}
