// Prevents an extra console window from appearing on Windows in release
// builds. In debug builds the console (and devtools) remain available for
// troubleshooting.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::fs;
use std::path::Path;

use serde::Serialize;
use tauri_plugin_dialog::DialogExt;

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
/// exactly how many files survived each stage, per the 0.1.4 diagnostic
/// requirement — `native_dialog_count` in particular is the ground-truth
/// "how many paths did the Windows picker actually hand back" number,
/// which 0.1.3's version of this feature could not answer with certainty.
#[derive(Serialize)]
struct PickAudioFilesResult {
    native_dialog_count: usize,
    files: Vec<PickedAudioFile>,
    read_errors: Vec<String>,
}

/// Shows the native multi-select "Open Audio" file dialog and reads every
/// selected file's bytes, entirely on the Rust side, in a single command.
///
/// Why this replaced the 0.1.2/0.1.3 approach (calling
/// window.__TAURI__.dialog.open({ multiple: true }) directly from
/// JavaScript, via the auto-injected withGlobalTauri bindings): real
/// Windows testing of that approach, with the Open Audio Diagnostics panel
/// this build's predecessor introduced, proved conclusively that only one
/// path was ever reaching JavaScript — "Native dialog returned: 1 file."
/// even when several files were selected in the picker. That diagnostic
/// evidence pointed at the dialog call itself (or the JS-global-binding
/// layer between it and this app), not at anything downstream — this
/// app's own file-processing pipeline was separately confirmed correct
/// via unit tests before that.
///
/// This command sidesteps that entire layer: it calls
/// tauri_plugin_dialog's Rust API (`DialogExt`) directly —
/// `blocking_pick_files()`, documented as the variant meant for use
/// inside a command rather than the main event loop — and reads each
/// resulting path with `std::fs::read`, entirely in Rust. The frontend
/// gets one plain array of `{ name, path, data }` objects back over a
/// single, ordinary command invocation. No JS-side dialog/fs plugin
/// bindings are involved in this path at all anymore.
///
/// A file that fails to read (permissions, the file having moved, etc.)
/// is recorded in `read_errors` rather than aborting the whole selection
/// — one bad file must never cost the user every other file they picked.
#[tauri::command]
async fn pick_and_read_audio_files(app: tauri::AppHandle) -> Result<PickAudioFilesResult, String> {
    let picked = app
        .dialog()
        .file()
        .add_filter("Audio", &["wav", "mp3", "m4a", "flac", "ogg"])
        .add_filter("All Files", &["*"])
        .blocking_pick_files();

    let paths = match picked {
        Some(paths) => paths,
        None => {
            // User cancelled the dialog. Not an error — an empty result.
            return Ok(PickAudioFilesResult {
                native_dialog_count: 0,
                files: Vec::new(),
                read_errors: Vec::new(),
            });
        }
    };

    let native_dialog_count = paths.len();
    let mut files = Vec::with_capacity(native_dialog_count);
    let mut read_errors = Vec::new();

    for file_path in paths {
        let path_string = file_path.to_string();
        match fs::read(&path_string) {
            Ok(data) => {
                let name = Path::new(&path_string)
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
        // Registers the dialog plugin so the DialogExt trait used by
        // pick_and_read_audio_files above works. Its own JS-exposed
        // commands (plugin:dialog|open, etc.) are no longer called from
        // the frontend as of 0.1.4 — see that command's doc comment — so
        // no dialog:* capability grant is needed anymore either.
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![pick_and_read_audio_files])
        .run(tauri::generate_context!())
        .expect("error while running AccessibleAudioStudio Pro");
}
