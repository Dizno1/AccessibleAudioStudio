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
/// exactly how many files survived each stage.
#[derive(Serialize)]
struct PickAudioFilesResult {
    dialog_launched: bool,
    win32_multi_select: bool,
    paste_hdrop_detected: bool,
    paste_hdrop_file_count: usize,
    paths_supplied_to_dialog: usize,
    native_dialog_count: usize,
    files: Vec<PickedAudioFile>,
    read_errors: Vec<String>,
}

// A generous buffer for the Explorer-style multi-select return value.
#[cfg(windows)]
const FILE_BUFFER_LEN: usize = 65536;

/// ---------------------------------------------------------------------
/// 0.1.8: what changed, and why, read this before the code below
/// ---------------------------------------------------------------------
///
/// 0.1.7 made Ctrl+O check the clipboard first and skip the dialog
/// entirely when it found a multi-file copy — real testing found this
/// produced no dialog, no files, and no announcement of any kind. That
/// behavior is removed in 0.1.8. Ctrl+O and the Open Audio button now
/// always call `pick_files_native()` and always show the native dialog,
/// full stop, no exceptions, no clipboard inspection before it. (The
/// most likely cause of 0.1.7's silent failure: a Rust panic inside the
/// clipboard-reading path, before the dialog was ever shown, would
/// abort that command invocation without ever resolving or rejecting the
/// frontend's `invoke()` promise — matching "nothing happened, no
/// announcement" exactly. Whether that specific theory is correct or
/// not, removing the bypass removes the failure mode entirely rather
/// than trying to patch around it.)
///
/// What 0.1.8 adds instead is a live interception *inside* the dialog:
/// when the user presses Ctrl+V in the File Name field, and the
/// clipboard holds a copied multi-file Explorer selection (CF_HDROP,
/// 2+ paths), that paste is intercepted and replaced with the complete
/// list, expressed as a quoted, space-separated multi-name string —
/// `"C:\path\a.mp3" "C:\path\b.wav"` — which is GetOpenFileNameW's own
/// long-documented syntax for typing more than one filename directly
/// into that field. The user stays in the dialog and activates Open
/// normally; the existing, already-unit-tested
/// `parse_multi_select_buffer` (unchanged since 0.1.6) then reads the
/// result exactly as it would for any other multi-selection. If nothing
/// relevant is on the clipboard, Ctrl+V behaves completely normally
/// (default single-item paste).
///
/// ### How this works, mechanically
///
/// 1. `pick_files_native()` sets `OFN_ENABLEHOOK` and `lpfnHook` to
///    `open_dialog_hook_proc`, an Explorer-style OFNHookProc.
/// 2. That hook does nothing for every message except one: on the
///    `CDN_INITDONE` notification (sent once, when the dialog has
///    finished laying itself out), it locates the File Name
///    ComboBoxEx32 control — control ID `0x47C` (`cmb13` in Microsoft's
///    own dialog-template naming, confirmed independently against a
///    Microsoft MVP's description of this exact control hierarchy) —
///    tries several plausible parent-window candidates defensively
///    (the hook's own `hdlg` parameter, its `GetParent`, and the
///    notification's `hwndFrom`, since which one is "correct" for this
///    specific hook type could not be verified here), and if found,
///    installs a window subclass (`SetWindowSubclass`) on it.
/// 3. The subclass procedure (`paste_subclass_proc`) does nothing for
///    every message except `WM_PASTE`. On that one message: if the
///    clipboard holds 2+ files (via the same CF_HDROP reading logic
///    0.1.7 introduced, factored out below as
///    `read_clipboard_file_list`), it builds the quoted multi-name
///    string and calls `SetWindowTextW` on the control directly instead
///    of letting the default paste happen. Otherwise, it calls
///    `DefSubclassProc` — ordinary default paste behavior, unchanged.
///
/// Every one of those steps is written to fail *silently and safely*:
/// if the control can't be found, if subclassing fails, if the
/// clipboard read fails, the code always falls through to leaving the
/// dialog exactly as it would behave with no hook installed at all. The
/// one thing this code must never do is turn a failure into a hang or a
/// crash of the dialog itself — every branch that isn't the one
/// deliberately-handled case returns control to Windows' own default
/// processing immediately.
///
/// ### What is and is not verified — read this before trusting this build
///
/// This is the deepest, least-verifiable Windows-specific code shipped
/// in this project so far, and that should be stated plainly rather than
/// smoothed over. Confirmed directly against Microsoft's own generated
/// Rust API documentation: the `LPOFNHOOKPROC` function signature, the
/// `OFNOTIFY`/`NMHDR` structure shapes, the `CDN_INITDONE` notification
/// code, and the `SetWindowSubclass`/`DefSubclassProc` function
/// signatures. Corroborated from an independent, real-world source (a
/// Microsoft MVP's public description of the exact control nesting):
/// the `0x47C` control ID and its three-level
/// ComboBoxEx32→ComboBox→Edit structure. **Not verified, and not
/// verifiable in this environment:** whether `GetOpenFileNameW`'s own
/// multi-name text parser accepts a *pasted* quoted multi-path string
/// identically to how it accepts list-view-driven multi-selection —
/// this is the single largest remaining assumption, since it's the step
/// that actually determines whether this feature does anything useful
/// even if every mechanical piece above works exactly as designed. This
/// environment cannot compile or run any Windows-specific code at all,
/// confirmed directly across every build since 0.1.4 — that has not
/// changed for 0.1.8.

/// Reads a Windows Shell copied-file list (CF_HDROP) from the clipboard,
/// if one is present. Returns None if the clipboard couldn't be opened,
/// contains no CF_HDROP data, or the file list is empty.
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

        let result = (|| -> Option<Vec<PathBuf>> {
            let handle = GetClipboardData(CF_HDROP.0 as u32).ok()?;
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

// Thread-local, not global, because GetOpenFileNameW blocks the calling
// thread until the dialog closes, and its hook/subclass callbacks always
// run on that same thread (window procedures never run cross-thread) —
// so a plain thread-local cell is enough to pass diagnostics out of
// callbacks that can't otherwise return data to pick_files_native().
#[cfg(windows)]
thread_local! {
    static PASTE_DIAGNOSTICS: std::cell::RefCell<PasteDiagnostics> =
        std::cell::RefCell::new(PasteDiagnostics::default());
}

#[cfg(windows)]
#[derive(Default, Clone, Copy)]
struct PasteDiagnostics {
    hdrop_detected: bool,
    hdrop_file_count: usize,
}

/// The File Name ComboBoxEx32 control's ID in an Explorer-style
/// GetOpenFileName(W) dialog. Not officially documented by Microsoft,
/// but consistently reported (including by a Microsoft MVP, describing
/// the exact ComboBoxEx32 → ComboBox → Edit nesting used here) as
/// `0x47C`, matching the classic dialog-template name `cmb13`.
#[cfg(windows)]
const FILENAME_COMBO_ID: i32 = 0x47C;

#[cfg(windows)]
const SUBCLASS_ID: usize = 0xAA51;

/// Builds the quoted, space-separated multi-name string
/// GetOpenFileNameW's own File Name field accepts for typing (or, as
/// used here, pasting) more than one filename at once:
/// `"C:\path\a.mp3" "C:\path\b.wav"`.
#[cfg(windows)]
fn build_quoted_multi_name(paths: &[PathBuf]) -> String {
    paths
        .iter()
        .map(|p| format!("\"{}\"", p.to_string_lossy()))
        .collect::<Vec<_>>()
        .join(" ")
}

/// Window subclass procedure installed on the File Name control. Handles
/// exactly one message, WM_PASTE; every other message goes straight to
/// `DefSubclassProc`, unmodified default behavior.
#[cfg(windows)]
unsafe extern "system" fn paste_subclass_proc(
    hwnd: windows::Win32::Foundation::HWND,
    msg: u32,
    wparam: windows::Win32::Foundation::WPARAM,
    lparam: windows::Win32::Foundation::LPARAM,
    _subclass_id: usize,
    _ref_data: usize,
) -> windows::Win32::Foundation::LRESULT {
    use windows::Win32::UI::Controls::DefSubclassProc;
    use windows::Win32::UI::WindowsAndMessaging::WM_PASTE;

    if msg == WM_PASTE {
        if let Some(paths) = read_clipboard_file_list() {
            if paths.len() >= 2 {
                PASTE_DIAGNOSTICS.with(|d| {
                    let mut d = d.borrow_mut();
                    d.hdrop_detected = true;
                    d.hdrop_file_count = paths.len();
                });

                let text = build_quoted_multi_name(&paths);
                let wide: Vec<u16> = text.encode_utf16().chain(std::iter::once(0)).collect();
                use windows::Win32::UI::WindowsAndMessaging::SetWindowTextW;
                let _ = SetWindowTextW(hwnd, windows::core::PCWSTR(wide.as_ptr()));

                // Handled — do not also run default paste behavior,
                // which would otherwise insert the clipboard's own
                // (single-name-at-best) text representation afterward.
                return windows::Win32::Foundation::LRESULT(0);
            }
        }
    }

    DefSubclassProc(hwnd, msg, wparam, lparam)
}

/// OFNHookProc installed on the Open dialog. Handles exactly one
/// notification, CDN_INITDONE (sent once, after the dialog has finished
/// laying itself out); every other message returns 0 immediately,
/// meaning "not handled, use default processing" — the standard,
/// conservative return for an Explorer-style OFN hook.
#[cfg(windows)]
unsafe extern "system" fn open_dialog_hook_proc(
    hdlg: windows::Win32::Foundation::HWND,
    msg: u32,
    _wparam: windows::Win32::Foundation::WPARAM,
    lparam: windows::Win32::Foundation::LPARAM,
) -> usize {
    use windows::Win32::UI::Controls::Dialogs::{CDN_INITDONE, OFNOTIFYW};
    use windows::Win32::UI::Controls::SetWindowSubclass;
    use windows::Win32::UI::WindowsAndMessaging::{GetDlgItem, GetParent, WM_NOTIFY};

    if msg != WM_NOTIFY {
        return 0;
    }

    let notify = &*(lparam.0 as *const OFNOTIFYW);
    if notify.hdr.code != CDN_INITDONE.0 as isize {
        return 0;
    }

    // Try every plausible "real dialog window" candidate defensively —
    // which one is correct for this specific hook type was not possible
    // to confirm in this environment. GetDlgItem simply returns a null
    // handle for a wrong candidate; trying more than one costs nothing
    // and only improves the odds of finding the real control.
    let candidates = [hdlg, GetParent(hdlg).unwrap_or_default(), notify.hdr.hwndFrom];

    for parent in candidates {
        if parent == windows::Win32::Foundation::HWND::default() {
            continue;
        }
        // windows 0.58 resolves this parameter through the windows_core
        // Param<HWND> trait, which takes the HWND value directly rather
        // than an Option-wrapped one (unlike GetParent's return type,
        // which genuinely is optional and stays Option-handled above via
        // unwrap_or_default()) — GetDlgItem's own "control not found"
        // case is expressed through its Result, not through Option on
        // the input. The previous `Some(parent)` here was exactly that
        // mix-up, caught by the real Windows compiler.
        if let Ok(combo) = GetDlgItem(parent, FILENAME_COMBO_ID) {
            if combo != windows::Win32::Foundation::HWND::default() {
                let _ = SetWindowSubclass(combo, Some(paste_subclass_proc), SUBCLASS_ID, 0);
                break;
            }
        }
    }

    0
}

/// Shows Windows' classic Explorer-style multi-select "Open" dialog —
/// `GetOpenFileNameW` with `OFN_EXPLORER | OFN_ALLOWMULTISELECT` — always,
/// every time Open Audio is activated. See the module-level doc comment
/// above for what the hook installed here does and why.
#[cfg(windows)]
fn pick_files_native() -> Result<(Vec<PathBuf>, PasteDiagnostics), String> {
    use windows::core::PWSTR;
    use windows::Win32::Foundation::HWND;
    use windows::Win32::UI::Controls::Dialogs::{
        CommDlgExtendedError, GetOpenFileNameW, OFN_ALLOWMULTISELECT, OFN_ENABLEHOOK,
        OFN_EXPLORER, OFN_FILEMUSTEXIST, OFN_HIDEREADONLY, OFN_PATHMUSTEXIST, OPENFILENAMEW,
    };

    fn to_wide(s: &str) -> Vec<u16> {
        s.encode_utf16().chain(std::iter::once(0)).collect()
    }

    PASTE_DIAGNOSTICS.with(|d| *d.borrow_mut() = PasteDiagnostics::default());

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
        | OFN_HIDEREADONLY
        | OFN_ENABLEHOOK;
    ofn.lpfnHook = Some(open_dialog_hook_proc);

    let succeeded = unsafe { GetOpenFileNameW(&mut ofn) };

    let diagnostics = PASTE_DIAGNOSTICS.with(|d| *d.borrow());

    if !succeeded.as_bool() {
        let error_code = unsafe { CommDlgExtendedError() };
        if error_code.0 == 0 {
            return Ok((Vec::new(), diagnostics));
        }
        return Err(format!(
            "GetOpenFileNameW failed (CommDlgExtendedError code {}).",
            error_code.0
        ));
    }

    Ok((parse_multi_select_buffer(&file_buffer), diagnostics))
}

/// Parses the Explorer-style multi-select return buffer into a list of
/// complete file paths. Unit-tested (real rustc, not simulated) since
/// 0.1.6 — see docs/Pro Roadmap.md — and unchanged since.
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
fn pick_files_native() -> Result<(Vec<PathBuf>, PasteDiagnostics), String> {
    Err("Windows-native multi-select is only available on Windows.".to_string())
}

#[cfg(not(windows))]
#[derive(Default, Clone, Copy)]
struct PasteDiagnostics {
    hdrop_detected: bool,
    hdrop_file_count: usize,
}

/// Always shows the native multi-select Open dialog, then reads every
/// resulting file's bytes on the Rust side in one round trip. A file
/// that fails to read is recorded in `read_errors` rather than aborting
/// the whole selection.
#[tauri::command]
async fn pick_and_read_audio_files() -> Result<PickAudioFilesResult, String> {
    let (paths, paste_diagnostics) = pick_files_native()?;
    let native_dialog_count = paths.len();

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
        dialog_launched: true,
        win32_multi_select: cfg!(windows),
        paste_hdrop_detected: paste_diagnostics.hdrop_detected,
        paste_hdrop_file_count: paste_diagnostics.hdrop_file_count,
        paths_supplied_to_dialog: paste_diagnostics.hdrop_file_count,
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
