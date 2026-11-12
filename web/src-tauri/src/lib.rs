//! TechPlug POS desktop app.
//!
//! The window opens the live TechPlug POS web app, so every restaurant always runs the newest version
//! without reinstalling. The web app saves itself on the computer (service worker) and keeps all
//! restaurant data on the computer too, so after the first start it opens and sells with no internet.
use tauri::Manager;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        // Opening the app a second time brings the open window to the front instead of a second till.
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            if let Some(w) = app.get_webview_window("main") {
                let _ = w.unminimize();
                let _ = w.set_focus();
            }
        }))
        .run(tauri::generate_context!())
        .expect("error while running TechPlug POS");
}
