// Prevents an extra console window from appearing on Windows in release
// builds. In debug builds the console (and devtools) remain available for
// troubleshooting.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::fs;
use std::path::PathBuf;

use serde::Serialize;

/// One file the picker returned and that this command successfully read
/// from disk. `data` is the raw file bytes; the frontend wraps this
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
/// exactly how many files survived each stage, and — as of 0.1.7 —
/// whether a copied Explorer selection was found on the clipboard and
/// used directly, as distinct from the native dialog's own return value.
#[derive(Serialize)]
struct PickAudioFilesResult {
    clipboard_file_list_detected: bool,
    clipboard_file_count: usize,
    win32_multi_select: bool,
    dialog_returned_count: usize,
    native_dialog_count: usize,
    files: Vec<PickedAudioFile>,
    read_errors: Vec<String>,
}

// A generous buffer for the Explorer-style multi-select return value.
#[cfg(windows)]
const FILE_BUFFER_LEN: usize = 65536;

/// ---------------------------------------------------------------------
/// Why 0.1.7 exists, and what it does and does not attempt
/// ---------------------------------------------------------------------
///
/// 0.1.6's diagnostics were read correctly, but the workflow that was
/// actually tested was different from what every build through 0.1.6 had
/// addressed: not "select multiple files directly inside the Open
/// dialog," but "copy files in File Explorer (Ctrl+C), open the Open
/// Audio dialog, paste into its File Name field (Ctrl+V), accept."
///
/// That workflow cannot work by pasting text into the File Name field,
/// as a matter of how Windows itself works, not as a bug in this app.
/// Per Microsoft's own account of this exact question (Raymond Chen,
/// "Windows Explorer Doesn't Do Text," Microsoft TechNet/Windows
/// Confidential): when Explorer copies files to the clipboard, the data
/// object it places there offers HDROP, file contents, and a file group
/// descriptor — but never a text format. Pasting into any plain text
/// field (which is what WM_PASTE — the message an edit control or combo
/// box uses to handle Ctrl+V — requires: "Data is inserted only if the
/// clipboard contains data in CF_UNICODETEXT format," per the WM_PASTE
/// reference) cannot recover a multi-file list this way, because that
/// list only ever exists on the clipboard as CF_HDROP, a binary format,
/// never as text. This isn't specific to this app's dialog; it's true of
/// any ordinary text field on Windows.
///
/// So the fix implemented here is not "make paste work inside the
/// dialog" (which would require intercepting or subclassing a live
/// native dialog window to catch WM_PASTE/paste-notification and read
/// CF_HDROP at that moment — deliberately not attempted, see "What was
/// deliberately not attempted" below). Instead: when Open Audio is
/// activated, the Windows clipboard is checked first for a CF_HDROP
/// file list (i.e., "did the user just copy files in Explorer?"). If
/// two or more files are found there, they are used directly — the
/// native dialog is never shown for that activation, so there's no
/// paste step needed at all. If nothing usable is on the clipboard, the
/// 0.1.6 GetOpenFileNameW dialog opens exactly as before, unchanged, for
/// ordinary manual browsing and selection.
///
/// The end-to-end user gesture that now works is: Explorer Ctrl+C,
/// switch to AccessibleAudioStudio Pro, Ctrl+O — every copied file
/// opens, with no dialog and no paste step at all. That is a different
/// keystroke sequence than "open the dialog, then paste inside it," but
/// it reaches the same result (the whole copied group opens) with fewer
/// steps, through a mechanism this environment could reason about with
/// real confidence rather than one that could not be attempted safely.
///
/// ### What was deliberately not attempted, and why
///
/// Intercepting Ctrl+V *inside* the live native Open dialog (via
/// OFN_ENABLEHOOK / lpfnHook, subclassing the File Name combo box, and
/// reading CF_HDROP at the moment of paste) would reproduce the exact
/// keystroke sequence originally described. It was not attempted here.
/// Dialog hook procedures are widely documented as one of the more
/// failure-prone corners of Win32 UI programming — a hook procedure that
/// mishandles a message, deadlocks, or crashes can hang or corrupt the
/// entire native dialog, not just fail to add the feature. Given this
/// environment cannot compile, run, or test any of this app's
/// Windows-specific code at all (confirmed directly, not assumed — see
/// docs/Pro Roadmap.md for the details), shipping a hand-written dialog
/// hook with zero ability to verify it wouldn't hang the dialog was
/// judged too risky relative to the clipboard-on-activate approach
/// above, which is simpler, uses well-documented standalone Win32 APIs
/// (OpenClipboard/GetClipboardData/DragQueryFileW — the same functions
/// any ordinary clipboard-reading utility uses), and cannot break the
/// existing, working dialog path even if it has a bug: if clipboard
/// reading fails or finds nothing, the code falls through to the
/// unchanged 0.1.6 dialog behavior.

/// Reads a Windows Shell copied-file list (CF_HDROP) from the clipboard,
/// if one is present. Returns None if the clipboard couldn't be opened,
/// contains no CF_HDROP data, or the file list is empty — none of those
/// are treated as errors, since "nothing usable on the clipboard" is the
/// ordinary case whenever the user hasn't just copied files in Explorer.
#[cfg(windows)]
fn read_clipboard_file_list() -> Option<Vec<PathBuf>> {
    use windows::Win32::Foundation::HWND;
    use windows::Win32::System::DataExchange::{
        CloseClipboard, GetClipboardData, IsClipboardFormatAvailable, OpenClipboard,
    };
    use windows::Win32::System::Ole::CF_HDROP;
    use windows::Win32::UI::Shell::DragQueryFileW;

    unsafe {
        if IsClipboardFormatAvailable(CF_HDROP.0 as u32).is_err() {
            return None;
        }
        if OpenClipboard(HWND::default()).is_err() {
            return None;
        }

        // Always close the clipboard before returning, on every path —
        // an application that leaves the clipboard open blocks every
        // other program's clipboard access until it's closed.
        let result = (|| -> Option<Vec<PathBuf>> {
            let handle = GetClipboardData(CF_HDROP.0 as u32).ok()?;
            // HANDLE and HDROP are both thin wrappers around *mut c_void
            // (per the windows crate's own generated definitions) — the
            // fix here is passing that raw pointer through directly,
            // rather than the `as isize` cast this line previously used,
            // which tried to construct HDROP from an integer instead of
            // the pointer type its single field actually holds.
            let hdrop = windows::Win32::UI::Shell::HDROP(handle.0);

            let count = DragQueryFileW(hdrop, 0xFFFFFFFF, None);
            if count == 0 {
                return None;
            }

            let mut paths = Vec::with_capacity(count as usize);
            for i in 0..count {
                let needed_len = DragQueryFileW(hdrop, i, None);
                if needed_len == 0 {
                    continue;
                }
                let mut buffer = vec![0u16; (needed_len + 1) as usize];
                let written = DragQueryFileW(hdrop, i, Some(&mut buffer));
                if written == 0 {
                    continue;
                }
                buffer.truncate(written as usize);
                paths.push(PathBuf::from(String::from_utf16_lossy(&buffer)));
            }

            if paths.is_empty() {
                None
            } else {
                Some(paths)
            }
        })();

        let _ = CloseClipboard();
        result
    }
}

#[cfg(not(windows))]
fn read_clipboard_file_list() -> Option<Vec<PathBuf>> {
    None
}

/// Shows Windows' classic Explorer-style multi-select "Open" dialog —
/// `GetOpenFileNameW` with `OFN_EXPLORER | OFN_ALLOWMULTISELECT` — for
/// ordinary manual file browsing and selection. Unchanged from 0.1.6.
/// Returns an empty Vec if the user cancels — that is not an error.
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
/// complete file paths. See 0.1.6's changelog entry in
/// docs/Pro Roadmap.md for the unit tests this exact logic was run
/// against (real rustc, including the exact 15-file case from real
/// testing) before being included in that build; unchanged since.
#[cfg(windows)]
fn parse_multi_select_buffer(buffer: &[u16]) -> Vec<PathBuf> {
    let mut strings: Vec<String> = Vec::new();
    let mut start = 0usize;
    for i in 0..buffer.len() {
        if buffer[i] == 0 {
            if i == start {
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

#[cfg(not(windows))]
fn pick_files_native() -> Result<Vec<PathBuf>, String> {
    Err("Windows-native multi-select is only available on Windows.".to_string())
}

/// Checks the clipboard for a copied Explorer file list first; if two or
/// more files are found there, uses them directly and never shows the
/// dialog. Otherwise shows the native multi-select Open dialog exactly
/// as in 0.1.6. Either way, reads every resulting file's bytes on the
/// Rust side in one round trip. A file that fails to read is recorded in
/// `read_errors` rather than aborting the whole selection.
#[tauri::command]
async fn pick_and_read_audio_files() -> Result<PickAudioFilesResult, String> {
    let clipboard_files = read_clipboard_file_list();
    let clipboard_file_count = clipboard_files.as_ref().map(|v| v.len()).unwrap_or(0);

    // Only take the clipboard path for a genuine multi-file copy. A
    // single copied file is not meaningfully faster via this path than
    // just using the dialog, and treating single and multi differently
    // here keeps the common case (nothing relevant copied, or one file
    // copied) from ever silently skipping the dialog the user expects.
    let (paths, used_clipboard, dialog_returned_count) =
        if clipboard_file_count >= 2 {
            (clipboard_files.unwrap(), true, 0usize)
        } else {
            let dialog_paths = pick_files_native()?;
            let count = dialog_paths.len();
            (dialog_paths, false, count)
        };

    let native_dialog_count = if used_clipboard {
        clipboard_file_count
    } else {
        dialog_returned_count
    };

    let mut files = Vec::with_capacity(paths.len());
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
        clipboard_file_list_detected: used_clipboard,
        clipboard_file_count,
        win32_multi_select: cfg!(windows),
        dialog_returned_count,
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
