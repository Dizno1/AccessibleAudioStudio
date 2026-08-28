// audioEditorLauncher.js
// The main Recording Studio window's only involvement with audio editing
// as of 0.2.0: launching editor windows. Every open audio document now
// lives in its own separate window (see editor.html/editorWindow.js) —
// this module never holds document state, never renders per-document
// editing controls, and has no document combo box. It just calls the two
// Rust commands that create editor windows (open_audio_windows,
// open_new_editor_window) and reports what happened in the Open Audio
// Diagnostics panel, which stays in this window since it's about the
// picking process, not about any one document.

import { announceStatus, announceAlert } from "./announcer.js";
import { registerAction } from "./shortcutService.js";

let el = {};

export function initAudioEditorLauncher() {
  cacheElements();
  bindEvents();
  bindMenuEvents();
}

/**
 * Listens for clicks on the Recording Studio's own native menu (0.2.7).
 * "New Audio"/"Open Audio" route to the exact same functions the
 * permanent buttons already call, so there's still one underlying
 * implementation, not a second copy. Help items expand the relevant
 * `<details>` disclosure already in the page.
 */
function bindMenuEvents() {
  if (!isRunningInTauri()) return;
  const { listen } = window.__TAURI__.event;

  listen("menu-action", (event) => {
    switch (event.payload) {
      case "newAudio":
        triggerNewAudio();
        return;
      case "openAudio":
        triggerOpenAudio();
        return;
      case "showKeyboardShortcuts":
      case "showOpenAudioDiagnostics": {
        const wantedSummary = event.payload === "showKeyboardShortcuts" ? "Keyboard Shortcuts" : "Open Audio Diagnostics";
        const target = Array.from(document.querySelectorAll("footer details")).find((d) =>
          d.querySelector("summary")?.textContent.startsWith(wantedSummary)
        );
        if (target) {
          target.open = true;
          target.querySelector("summary")?.focus();
        }
        return;
      }
      default:
        return;
    }
  });
}

export function registerAudioEditorLauncherShortcuts() {
  registerAction("openAudio", () => {
    triggerOpenAudio();
    return { executed: true, resultText: "Open Audio" };
  });
  registerAction("newAudio", () => {
    triggerNewAudio();
    return { executed: true, resultText: "New Audio" };
  });
}

function cacheElements() {
  el = {
    openAudioButton: document.getElementById("open-audio-button"),
    openAudioInput: document.getElementById("open-audio-input"),
    newAudioButton: document.getElementById("new-audio-button"),
    openStatus: document.getElementById("editor-open-status"),
    openAudioDiagnostics: document.getElementById("open-audio-diagnostics"),
  };
}

function bindEvents() {
  el.openAudioButton.addEventListener("click", () => triggerOpenAudio());
  el.newAudioButton.addEventListener("click", () => triggerNewAudio());
  el.openAudioInput.addEventListener("change", handleOpenAudioInputChange);
}

function isRunningInTauri() {
  return typeof window !== "undefined" && !!window.__TAURI__;
}

// A hard ceiling on how long this window will wait for the Rust command
// to return before reporting a probable hang — see the identical pattern
// (and the reasoning behind it) previously used in this app's single-
// window Open Audio flow. GetOpenFileNameW is a modal call that only
// returns when the user closes the dialog, so this stays generous.
const OPEN_AUDIO_INVOKE_TIMEOUT_MS = 5 * 60 * 1000;

class TimeoutError extends Error {}

function withTimeout(promise, ms) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new TimeoutError(`Timed out after ${Math.round(ms / 1000)} seconds waiting for a response.`));
    }, ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (err) => {
        clearTimeout(timer);
        reject(err);
      }
    );
  });
}

async function triggerOpenAudio() {
  if (!isRunningInTauri()) {
    el.openAudioInput.click();
    return;
  }

  markOpenAudioInvoked();

  try {
    const { invoke } = window.__TAURI__.core;
    const result = await withTimeout(invoke("open_audio_windows"), OPEN_AUDIO_INVOKE_TIMEOUT_MS);
    // result: { dialog_launched, win32_multi_select, outer_combo_located, inner_edit_located,
    //           wm_paste_received, open_clipboard_succeeded, open_clipboard_error,
    //           cf_hdrop_available, available_clipboard_formats, get_clipboard_data_succeeded,
    //           drag_query_file_count, paste_hdrop_detected, paste_hdrop_file_count,
    //           paste_hdrop_file_names, quoted_text_written, paths_supplied_to_dialog,
    //           native_dialog_count, windows_opened, skipped_unsupported, window_open_errors }

    updateOpenAudioDiagnostics({ ...result, dialogResult: result.native_dialog_count === 0 ? "canceled" : "opened" });

    if (result.native_dialog_count === 0) {
      return; // cancelled — nothing further to announce
    }

    announceStatus(buildOpenSummary(result));
  } catch (err) {
    const timedOut = err instanceof TimeoutError;
    updateOpenAudioDiagnostics({
      dialogLaunched: null,
      dialogResult: timedOut ? "no response from Rust (timed out)" : "error",
      rustReturnedToJs: !timedOut,
      failureReason: err && err.message ? err.message : String(err),
    });
    announceAlert(
      timedOut
        ? "Open Audio did not respond. See the Open Audio Diagnostics panel for details."
        : "Open Audio could not be opened. See the Open Audio Diagnostics panel for details."
    );
  }
}

async function triggerNewAudio() {
  if (!isRunningInTauri()) {
    announceAlert("New Audio requires the AccessibleAudioStudio Pro desktop app.");
    return;
  }
  try {
    const { invoke } = window.__TAURI__.core;
    await invoke("open_new_editor_window");
    announceStatus("New audio editor window opened.");
  } catch (err) {
    announceAlert(
      "A new audio editor window could not be opened. " + (err && err.message ? err.message : String(err))
    );
  }
}

/** Browser-only fallback (no Tauri runtime): the old file-input flow, kept only so this page still does something reasonable outside the desktop app. */
async function handleOpenAudioInputChange() {
  const files = el.openAudioInput.files;
  el.openAudioInput.value = "";
  if (!files || files.length === 0) return;
  announceAlert(
    `${files.length} file${files.length === 1 ? "" : "s"} selected. Opening audio files in separate windows requires the AccessibleAudioStudio Pro desktop app.`
  );
}

function buildOpenSummary(result) {
  const parts = [];
  parts.push(
    result.windows_opened === 0
      ? "No editor windows opened."
      : result.windows_opened === 1
      ? "1 audio editor window opened."
      : `${result.windows_opened} audio editor windows opened.`
  );
  if (result.skipped_unsupported > 0) {
    parts.push(
      result.skipped_unsupported === 1
        ? "1 unsupported file skipped."
        : `${result.skipped_unsupported} unsupported files skipped.`
    );
  }
  if (result.window_open_errors && result.window_open_errors.length > 0) {
    parts.push(
      result.window_open_errors.length === 1
        ? "1 editor window could not be opened."
        : `${result.window_open_errors.length} editor windows could not be opened.`
    );
  }
  return parts.join(" ");
}

function markOpenAudioInvoked() {
  if (!el.openAudioDiagnostics) return;
  el.openAudioDiagnostics.textContent = `Open Audio invoked: yes, at ${new Date().toLocaleTimeString()}. Waiting for the native dialog to return...`;
}

function updateOpenAudioDiagnostics(stats) {
  if (!el.openAudioDiagnostics) return;

  const invokedLine = "Open Audio invoked: yes.";
  const rustReturnedLine =
    stats.rustReturnedToJs === undefined
      ? "Rust command returned to JavaScript: yes."
      : `Rust command returned to JavaScript: ${stats.rustReturnedToJs ? "yes" : "no"}.`;
  const dialogResultLine = stats.dialogResult ? `Native dialog result: ${stats.dialogResult}.` : null;
  const multiSelectLine =
    stats.win32_multi_select !== undefined ? `Multi-select enabled: ${stats.win32_multi_select ? "yes" : "no"}.` : null;

  const wmPasteLine =
    stats.wm_paste_received !== undefined ? `WM_PASTE received by subclass: ${stats.wm_paste_received ? "yes" : "no"}.` : null;

  const outerComboLine =
    stats.outer_combo_located !== undefined ? `Outer File name combo located: ${stats.outer_combo_located ? "yes" : "no"}.` : null;
  const innerEditLine =
    stats.inner_edit_located !== undefined ? `Inner editable child located: ${stats.inner_edit_located ? "yes" : "no"}.` : null;

  const clipboardLines = [];
  if (stats.wm_paste_received) {
    clipboardLines.push(
      stats.open_clipboard_succeeded
        ? "OpenClipboard: succeeded."
        : `OpenClipboard: failed (Windows error code ${stats.open_clipboard_error}).`
    );
    if (stats.open_clipboard_succeeded) {
      clipboardLines.push(
        `Clipboard formats available: ${
          stats.available_clipboard_formats && stats.available_clipboard_formats.length
            ? stats.available_clipboard_formats.join(", ")
            : "none"
        }.`
      );
      clipboardLines.push(`CF_HDROP available: ${stats.cf_hdrop_available ? "yes" : "no"}.`);
      if (stats.cf_hdrop_available) {
        clipboardLines.push(`GetClipboardData(CF_HDROP): ${stats.get_clipboard_data_succeeded ? "succeeded" : "failed"}.`);
        if (stats.get_clipboard_data_succeeded) {
          clipboardLines.push(`DragQueryFileW file count: ${stats.drag_query_file_count}.`);
          clipboardLines.push(
            `Quoted filenames written to File name edit: ${stats.paste_hdrop_detected ? stats.paste_hdrop_file_count : 0}.`
          );
          if (stats.quoted_text_written) {
            clipboardLines.push(`Text written: ${stats.quoted_text_written}`);
          }
        }
      }
    }
  }

  const nativeReturnedLine =
    stats.native_dialog_count !== undefined ? `Native dialog returned: ${stats.native_dialog_count} file${stats.native_dialog_count === 1 ? "" : "s"}.` : null;
  const windowsOpenedLine =
    stats.windows_opened !== undefined ? `Editor windows opened: ${stats.windows_opened}.` : null;
  const skippedLine =
    stats.skipped_unsupported !== undefined ? `Unsupported files skipped: ${stats.skipped_unsupported}.` : null;
  const errorsLine =
    stats.window_open_errors && stats.window_open_errors.length > 0
      ? `Editor windows that failed to open: ${stats.window_open_errors.join("; ")}.`
      : null;

  el.openAudioDiagnostics.textContent = [
    `Last Open Audio operation, ${new Date().toLocaleTimeString()}:`,
    stats.failureReason ? `Open Audio could not be completed: ${stats.failureReason}.` : null,
    invokedLine,
    rustReturnedLine,
    dialogResultLine,
    multiSelectLine,
    wmPasteLine,
    outerComboLine,
    innerEditLine,
    ...clipboardLines,
    nativeReturnedLine,
    windowsOpenedLine,
    skippedLine,
    errorsLine,
  ]
    .filter(Boolean)
    .join(" ");
}
