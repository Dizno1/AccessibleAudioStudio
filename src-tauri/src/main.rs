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
    win32_multi_select: bool,
    native_dialog_count: usize,
    files: Vec<PickedAudioFile>,
    read_errors: Vec<String>,
}

// A generous buffer for the Explorer-style multi-select return value.
// GetOpenFileNameW writes the current directory followed by every
// selected filename into one buffer, each NULL-separated — a small
// buffer is the classic way this API silently truncates a large
// selection, so this is sized for hundreds of long filenames rather than
// the handful used in earlier testing.
#[cfg(windows)]
const FILE_BUFFER_LEN: usize = 65536;

/// Shows Windows' classic Explorer-style multi-select "Open" dialog —
/// `GetOpenFileNameW` with `OFN_EXPLORER | OFN_ALLOWMULTISELECT` — the
/// same class of API Audacity's own Windows build uses for this dialog.
///
/// Why this exists: 0.1.2 through 0.1.4 called `tauri-plugin-dialog`
/// (first from JavaScript, then from Rust directly); 0.1.5 replaced that
/// with a direct call to the modern `IFileOpenDialog` COM interface via
/// the `wfd` crate. Both are legitimate, independently-implemented
/// multi-select APIs, and real Windows testing reported the exact same
/// symptom for both — "returned: 1 file" regardless of selection size —
/// which is what makes the classic, non-COM `GetOpenFileNameW` mechanism
/// worth trying as a genuinely different code path, not a variation on
/// the same one.
///
/// Returns an empty Vec if the user cancels — that is not an error,
/// detected via `CommDlgExtendedError()` returning 0.
#[cfg(windows)]
fn pick_files_native() -> Result<Vec<PathBuf>, String> {
    use windows::core::PWSTR;
    use windows::Win32::Foundation::HWND;
    use windows::Win32::UI::Controls::Dialogs::{
        CommDlgExtendedError, GetOpenFileNameW, OFN_ALLOWMULTISELECT, OFN_EXPLORER,
        OFN_FILEMUSTEXIST, OFN_HIDEREADONLY, OFN_PATHMUSTEXIST, OPENFILENAMEW,
    };

    fn to_wide(s: &str) -> Vec<u16> {
        s.encode_utf16().chain(std::iter::once(0)).collect()
    }

    // Filter pairs are NULL-separated, with a final extra NULL to
    // terminate the whole list: "Display Name\0*.pattern\0" repeated,
    // then one more \0.
    let filter = to_wide("Audio\0*.wav;*.mp3;*.m4a;*.flac;*.ogg\0All Files\0*.*\0\0");
    let title = to_wide("Open Audio");
    let mut file_buffer: Vec<u16> = vec![0u16; FILE_BUFFER_LEN];

    let mut ofn = OPENFILENAMEW::default();
    ofn.lStructSize = std::mem::size_of::<OPENFILENAMEW>() as u32;
    ofn.hwndOwner = HWND::default();
    ofn.lpstrFilter = windows::core::PCWSTR(filter.as_ptr());
    ofn.lpstrFile = PWSTR(file_buffer.as_mut_ptr());
    ofn.nMaxFile = file_buffer.len() as u32;
    ofn.lpstrTitle = windows::core::PCWSTR(title.as_ptr());
    ofn.Flags = OFN_EXPLORER
        | OFN_ALLOWMULTISELECT
        | OFN_FILEMUSTEXIST
        | OFN_PATHMUSTEXIST
        | OFN_HIDEREADONLY;

    let succeeded = unsafe { GetOpenFileNameW(&mut ofn) };

    if !succeeded.as_bool() {
        let error_code = unsafe { CommDlgExtendedError() };
        if error_code.0 == 0 {
            // User cancelled the dialog — not an error.
            return Ok(Vec::new());
        }
        return Err(format!(
            "GetOpenFileNameW failed (CommDlgExtendedError code {}).",
            error_code.0
        ));
    }

    Ok(parse_multi_select_buffer(&file_buffer))
}

/// Parses the Explorer-style multi-select return buffer into a list of
/// complete file paths.
///
/// The buffer contains a sequence of NULL-terminated UTF-16 strings,
/// itself terminated by an extra NULL (i.e. a double-NULL after the last
/// string) — see MSDN, OPENFILENAMEW.lpstrFile. Two distinct shapes are
/// possible, per Microsoft's own documented behavior, and both are
/// handled explicitly rather than assumed:
///   - Exactly one file selected: the buffer holds a single string, and
///     it is already the complete path (there is no separate directory
///     entry in this case).
///   - Two or more files selected: the first string is the directory,
///     and every string after it is one filename to be joined onto that
///     directory to form a complete path.
#[cfg(windows)]
fn parse_multi_select_buffer(buffer: &[u16]) -> Vec<PathBuf> {
    // Split the buffer into NULL-terminated segments, stopping at the
    // first empty segment (the double-NULL terminator) rather than
    // trusting the buffer's full allocated length.
    let mut strings: Vec<String> = Vec::new();
    let mut start = 0usize;
    for i in 0..buffer.len() {
        if buffer[i] == 0 {
            if i == start {
                // Empty segment: this is the terminating double-NULL.
                break;
            }
            strings.push(String::from_utf16_lossy(&buffer[start..i]));
            start = i + 1;
        }
    }

    match strings.len() {
        0 => Vec::new(),
        1 => vec![PathBuf::from(&strings[0])],
        _ => {
            let dir = PathBuf::from(&strings[0]);
            strings[1..].iter().map(|name| dir.join(name)).collect()
        }
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
        win32_multi_select: cfg!(windows),
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
