// Prevents an extra console window from appearing on Windows in release
// builds. In debug builds the console (and devtools) remain available for
// troubleshooting.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::fs;
use std::path::PathBuf;

use serde::Serialize;

/// One file the native picker returned and that this command successfully
/// read from disk. `data` is the raw file bytes; the frontend wraps this
/// directly in a `File` object (see app/js/audioEditorController.js),
/// exactly as it already does for files picked through the browser-only
/// `<input type="file">` fallback, so nothing downstream of that needs to
/// know which picker was used.
#[derive(Serialize)]
struct PickedAudioFile {
    name: String,
    path: String,
    data: Vec<u8>,
}

/// Everything the frontend's Open Audio Diagnostics panel needs to show
/// exactly how many files survived each stage.
#[derive(Serialize)]
struct PickAudioFilesResult {
    windows_native_multi_select: bool,
    native_dialog_count: usize,
    files: Vec<PickedAudioFile>,
    read_errors: Vec<String>,
}

/// Shows Windows' own native multi-select "Open" dialog — IFileOpenDialog
/// with FOS_ALLOWMULTISELECT — via the small, Windows-only `wfd` crate,
/// and returns every selected path.
///
/// Why this exists: 0.1.2 called tauri-plugin-dialog from JavaScript;
/// 0.1.3 added diagnostics that proved only one file was ever returned;
/// 0.1.4 moved the same tauri-plugin-dialog call into Rust directly
/// (bypassing the JS-binding layer entirely), and real Windows testing
/// still reported exactly one file — "Multi-select requested: yes. Native
/// dialog returned: 1 file." — with every stage after that processing
/// that one file correctly. That is conclusive evidence the loss is
/// inside tauri-plugin-dialog's own Windows dialog backend, not anywhere
/// in this app's code, which is why this build stops calling
/// tauri-plugin-dialog for this function at all and instead calls the
/// same underlying Windows COM API (IFileOpenDialog) that Explorer and
/// Audacity themselves use, through `wfd` — a small, Windows-only crate
/// built specifically around that one API, rather than a large
/// cross-platform abstraction layered on top of it.
///
/// Returns an empty Vec if the user cancels — that is not an error.
#[cfg(windows)]
fn pick_files_native() -> Result<Vec<PathBuf>, String> {
    let params = wfd::DialogParams {
        options: wfd::FOS_ALLOWMULTISELECT | wfd::FOS_FORCEFILESYSTEM,
        file_types: vec![
            ("Audio", "*.wav;*.mp3;*.m4a;*.flac;*.ogg"),
            ("All Files", "*.*"),
        ],
        ..Default::default()
    };

    match wfd::open_dialog(params) {
        Ok(result) => Ok(result.selected_file_paths),
        Err(wfd::DialogError::UserCancelled) => Ok(Vec::new()),
        Err(err) => Err(format!("{:?}", err)),
    }
}

/// Non-Windows builds have no native multi-select picker wired up here —
/// this app currently only ships as a Windows desktop application (see
/// README.md, "Application identity"), and the browser build already has
/// its own separate fallback (the HTML `<input type="file" multiple>` in
/// index.html, used automatically whenever no Tauri runtime is present —
/// see app/js/audioEditorController.js, isRunningInTauri). This stub only
/// exists so the crate still compiles if it's ever built for another
/// desktop target; it is not expected to run in practice.
#[cfg(not(windows))]
fn pick_files_native() -> Result<Vec<PathBuf>, String> {
    Err("Windows-native multi-select is only available on Windows.".to_string())
}

/// Picks files with the native Windows multi-select dialog and reads
/// every selected file's bytes, entirely on the Rust side, in one round
/// trip. A file that fails to read (permissions, the file having moved,
/// etc.) is recorded in `read_errors` rather than aborting the whole
/// selection — one bad file must never cost the user every other file
/// they picked.
#[tauri::command]
async fn pick_and_read_audio_files() -> Result<PickAudioFilesResult, String> {
    let paths = pick_files_native()?;
    let native_dialog_count = paths.len();

    let mut files = Vec::with_capacity(native_dialog_count);
    let mut read_errors = Vec::new();

    for path in paths {
        let path_string = path.to_string_lossy().to_string();
        match fs::read(&path) {
            Ok(data) => {
                let name = path
                    .file_name()
                    .map(|n| n.to_string_lossy().to_string())
                    .unwrap_or_else(|| path_string.clone());
                files.push(PickedAudioFile {
                    name,
                    path: path_string,
                    data,
                });
            }
            Err(err) => {
                read_errors.push(format!("{}: {}", path_string, err));
            }
        }
    }

    Ok(PickAudioFilesResult {
        windows_native_multi_select: cfg!(windows),
        native_dialog_count,
        files,
        read_errors,
    })
}

fn main() {
    tauri::Builder::default()
        // Restores window size and position from the previous session on
        // launch, and saves it automatically as the user resizes/moves the
        // window or closes the app. This is the "remember previous size and
        // position when practical" requirement — handled entirely by this
        // plugin, no custom persistence code needed.
        .plugin(tauri_plugin_window_state::Builder::default().build())
        .invoke_handler(tauri::generate_handler![pick_and_read_audio_files])
        .run(tauri::generate_context!())
        .expect("error while running AccessibleAudioStudio Pro");
}
