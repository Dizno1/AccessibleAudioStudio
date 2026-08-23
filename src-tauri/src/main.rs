// Prevents an extra console window from appearing on Windows in release
// builds. In debug builds the console (and devtools) remain available for
// troubleshooting.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    tauri::Builder::default()
        // Restores window size and position from the previous session on
        // launch, and saves it automatically as the user resizes/moves the
        // window or closes the app. This is the "remember previous size and
        // position when practical" requirement — handled entirely by this
        // plugin, no custom persistence code needed.
        .plugin(tauri_plugin_window_state::Builder::default().build())
        // Native "Open Audio" file dialog (see app/js/audioEditorController.js)
        // and the file-read access needed to load whatever the user selected
        // there. Using Tauri's own dialog, rather than relying solely on an
        // HTML <input type="file" multiple">, is what makes genuine
        // multi-file selection reliable in the packaged app — see
        // src-tauri/Cargo.toml for the full explanation.
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .run(tauri::generate_context!())
        .expect("error while running AccessibleAudioStudio Pro");
}
