// audioEditorController.js
// Owns the entire "Audio Editor (Pro)" panel: DOM references, rendering,
// and event wiring for opening/creating/closing audio documents,
// nonvisual navigation, selection, core editing, cross-document
// copy/paste, and Save/Save As. This mirrors main.js's role for the
// original recording workflow, kept in its own module specifically so
// that workflow is never touched by Pro editing changes.
//
// Screen Reader First rules this file follows throughout (see
// DesignPhilosophyAndStandards):
//  - One concise status announcement per action; nothing continuous.
//  - Focus moves only when it meaningfully advances the workflow, and
//    never back into an unlabeled field — it lands on a heading/status
//    element or the next sensible control.
//  - Visible status text and the live-region announcement are two
//    separate things (as in the rest of this app): the paragraph is
//    always kept in sync for sighted users, the announcement is what a
//    screen reader actually hears.

import { announceStatus, announceAlert } from "./announcer.js";
import { formatTimePrecise, formatDurationNatural } from "./timeFormat.js";
import * as docs from "./documentManager.js";
import * as bufUtil from "./audioBufferUtils.js";
import { encodeWav, encodeMp3, extensionOf } from "./audioCodec.js";
import { BufferPlayer } from "./audioBufferPlayer.js";
import * as clipboard from "./audioClipboard.js";
import { registerAction } from "./shortcutService.js";

const NAV_STEPS = [10, 1, 0.1]; // seconds; matches the Pro roadmap's minimum-increment set

let el = {};
const player = new BufferPlayer();

export function initAudioEditor() {
  cacheElements();
  bindEvents();
  player.onEnded = () => {
    el.editorPlayPauseButton.textContent = "Play";
    el.editorPreviewButton.textContent = "Preview Selection";
  };
  render();
}

export function registerEditorShortcutActions() {
  registerAction("openAudio", () => {
    triggerOpenAudioDialog();
    return { executed: true, resultText: "Open Audio" };
  });

  registerAction("newAudio", () => {
    handleNewAudio();
    return { executed: true, resultText: "New Audio" };
  });

  registerAction("saveAudio", () => {
    const active = docs.getActiveDocument();
    if (!active) return { executed: false, reason: "No audio document is open." };
    handleSave();
    return { executed: true, resultText: "Save" };
  });

  registerAction("saveAudioAs", () => {
    const active = docs.getActiveDocument();
    if (!active) return { executed: false, reason: "No audio document is open." };
    openSaveAsForm();
    return { executed: true, resultText: "Save As" };
  });

  registerAction("copySelection", () => {
    const active = docs.getActiveDocument();
    if (!active) return { executed: false, reason: "No audio document is open." };
    if (!active.hasSelection()) return { executed: false, reason: "There is no selection to copy." };
    handleCopy();
    return { executed: true, resultText: "Copy" };
  });

  registerAction("cutSelection", () => {
    const active = docs.getActiveDocument();
    if (!active) return { executed: false, reason: "No audio document is open." };
    if (!active.hasSelection()) return { executed: false, reason: "There is no selection to cut." };
    handleCut();
    return { executed: true, resultText: "Cut" };
  });

  registerAction("pasteSelection", () => {
    const active = docs.getActiveDocument();
    if (!active) return { executed: false, reason: "No audio document is open." };
    if (!clipboard.clipboardHasContent()) return { executed: false, reason: "Nothing has been copied or cut yet." };
    handlePaste();
    return { executed: true, resultText: "Paste" };
  });

  registerAction("undoEdit", () => {
    const active = docs.getActiveDocument();
    if (!active || !active.canUndo()) return { executed: false, reason: "Nothing to undo." };
    handleUndo();
    return { executed: true, resultText: "Undo" };
  });

  registerAction("redoEdit", () => {
    const active = docs.getActiveDocument();
    if (!active || !active.canRedo()) return { executed: false, reason: "Nothing to redo." };
    handleRedo();
    return { executed: true, resultText: "Redo" };
  });
}

// ---------------------------------------------------------------------
// Elements & events
// ---------------------------------------------------------------------

function cacheElements() {
  el = {
    openAudioButton: document.getElementById("open-audio-button"),
    openAudioInput: document.getElementById("open-audio-input"),
    newAudioButton: document.getElementById("new-audio-button"),
    openStatus: document.getElementById("editor-open-status"),
    openAudioDiagnostics: document.getElementById("open-audio-diagnostics"),

    documentArea: document.getElementById("editor-document-area"),
    documentSelect: document.getElementById("document-select"),
    closeDocumentButton: document.getElementById("close-document-button"),

    positionInfo: document.getElementById("position-info"),
    selectionInfo: document.getElementById("selection-info"),

    navButtons: Array.from(document.querySelectorAll("[data-nav]")),
    jumpBeginningButton: document.getElementById("jump-doc-beginning-button"),
    jumpEndButton: document.getElementById("jump-doc-end-button"),
    announcePositionButton: document.getElementById("announce-doc-position-button"),

    setSelectionStartButton: document.getElementById("set-selection-start-button"),
    setSelectionEndButton: document.getElementById("set-selection-end-button"),
    selectAllButton: document.getElementById("select-all-button"),
    clearSelectionButton: document.getElementById("clear-selection-button"),
    announceSelectionButton: document.getElementById("announce-selection-button"),

    editorPlayPauseButton: document.getElementById("editor-play-pause-button"),
    editorPreviewButton: document.getElementById("editor-preview-selection-button"),

    cutButton: document.getElementById("cut-button"),
    copyButton: document.getElementById("copy-button"),
    pasteButton: document.getElementById("paste-button"),
    deleteSelectionButton: document.getElementById("delete-selection-button"),
    trimButton: document.getElementById("trim-button"),
    undoButton: document.getElementById("undo-button"),
    redoButton: document.getElementById("redo-button"),

    saveButton: document.getElementById("save-audio-button"),
    saveAsButton: document.getElementById("save-audio-as-button"),

    saveAsForm: document.getElementById("save-as-form"),
    saveAsNameInput: document.getElementById("save-as-name-input"),
    saveAsFormatSelect: document.getElementById("save-as-format-select"),
    confirmSaveAsButton: document.getElementById("confirm-save-as-button"),
    cancelSaveAsButton: document.getElementById("cancel-save-as-button"),
  };
}

function bindEvents() {
  el.openAudioButton.addEventListener("click", () => triggerOpenAudioDialog());
  el.openAudioInput.addEventListener("change", handleOpenAudioInputChange);
  el.newAudioButton.addEventListener("click", handleNewAudio);

  el.documentSelect.addEventListener("change", () => {
    docs.setActiveDocument(el.documentSelect.value);
    player.stop();
    render();
  });
  el.closeDocumentButton.addEventListener("click", handleCloseDocument);

  el.navButtons.forEach((button) => {
    button.addEventListener("click", () => handleNavigate(parseFloat(button.dataset.nav)));
  });
  el.jumpBeginningButton.addEventListener("click", () => handleJump(0));
  el.jumpEndButton.addEventListener("click", () => {
    const active = docs.getActiveDocument();
    if (active) handleJump(active.durationSec);
  });
  el.announcePositionButton.addEventListener("click", handleAnnouncePosition);

  el.setSelectionStartButton.addEventListener("click", handleSetSelectionStart);
  el.setSelectionEndButton.addEventListener("click", handleSetSelectionEnd);
  el.selectAllButton.addEventListener("click", handleSelectAll);
  el.clearSelectionButton.addEventListener("click", handleClearSelection);
  el.announceSelectionButton.addEventListener("click", handleAnnounceSelection);

  el.editorPlayPauseButton.addEventListener("click", handleEditorPlayPause);
  el.editorPreviewButton.addEventListener("click", handlePreviewSelection);

  el.cutButton.addEventListener("click", handleCut);
  el.copyButton.addEventListener("click", handleCopy);
  el.pasteButton.addEventListener("click", handlePaste);
  el.deleteSelectionButton.addEventListener("click", handleDeleteSelection);
  el.trimButton.addEventListener("click", handleTrim);
  el.undoButton.addEventListener("click", handleUndo);
  el.redoButton.addEventListener("click", handleRedo);

  el.saveButton.addEventListener("click", handleSave);
  el.saveAsButton.addEventListener("click", openSaveAsForm);
  el.confirmSaveAsButton.addEventListener("click", handleConfirmSaveAs);
  el.cancelSaveAsButton.addEventListener("click", closeSaveAsForm);
}

// ---------------------------------------------------------------------
// Open / New / Close / Switch
// ---------------------------------------------------------------------

/**
 * True when running inside the packaged Tauri desktop app (with
 * app.withGlobalTauri enabled in tauri.conf.json), false in a plain
 * browser (e.g. the GitHub Pages copy of this same app).
 */
function isRunningInTauri() {
  return typeof window !== "undefined" && !!window.__TAURI__;
}

/**
 * Open Audio's single entry point, used by both the button and Ctrl+O.
 *
 * In the desktop build this calls a custom Rust command,
 * pick_and_read_audio_files (see src-tauri/src/main.rs), which shows the
 * native multi-select file dialog AND reads every selected file's bytes,
 * entirely in Rust, in one round trip. Earlier builds (0.1.2/0.1.3) called
 * window.__TAURI__.dialog.open({ multiple: true }) directly from
 * JavaScript instead — real Windows testing with the Open Audio
 * Diagnostics panel proved that path was only ever returning one file to
 * JavaScript regardless of how many were selected, which is why the
 * picking itself moved into Rust for 0.1.4. See that command's doc
 * comment for the full explanation.
 *
 * The HTML `<input type="file" multiple">` fallback below is kept only
 * for when this same app runs as a plain web page with no Tauri runtime
 * present (e.g. GitHub Pages). Both paths converge on the exact same
 * processOpenedFiles() function afterward, so every other rule (extension
 * filtering, duplicate handling, one completion announcement) is
 * identical regardless of which picker was used.
 */
async function triggerOpenAudioDialog() {
  if (isRunningInTauri()) {
    await openAudioViaTauriCommand();
  } else {
    el.openAudioInput.click();
  }
}

async function openAudioViaTauriCommand() {
  try {
    const { invoke } = window.__TAURI__.core;
    const result = await invoke("pick_and_read_audio_files");
    // result: { dialog_launched, win32_multi_select, wm_paste_received, open_clipboard_succeeded,
    //           open_clipboard_error, cf_hdrop_available, available_clipboard_formats,
    //           get_clipboard_data_succeeded, drag_query_file_count, paste_hdrop_detected,
    //           paste_hdrop_file_count, paste_hdrop_file_names, paths_supplied_to_dialog,
    //           native_dialog_count, files: [{ name, path, data }], read_errors: [...] }

    if (result.native_dialog_count === 0 && result.files.length === 0 && result.read_errors.length === 0) {
      return; // user cancelled the dialog
    }

    const files = result.files.map((picked) => {
      const file = new File([new Uint8Array(picked.data)], picked.name);
      file.__sourcePath = picked.path;
      return file;
    });

    await processOpenedFiles(files, {
      pathway: "windows-native",
      dialogLaunched: result.dialog_launched,
      win32MultiSelect: result.win32_multi_select,
      wmPasteReceived: result.wm_paste_received,
      openClipboardSucceeded: result.open_clipboard_succeeded,
      openClipboardError: result.open_clipboard_error,
      cfHdropAvailable: result.cf_hdrop_available,
      availableClipboardFormats: result.available_clipboard_formats,
      getClipboardDataSucceeded: result.get_clipboard_data_succeeded,
      dragQueryFileCount: result.drag_query_file_count,
      pasteHdropDetected: result.paste_hdrop_detected,
      pasteHdropFileCount: result.paste_hdrop_file_count,
      pasteHdropFileNames: result.paste_hdrop_file_names,
      pathsSuppliedToDialog: result.paths_supplied_to_dialog,
      nativeDialogCount: result.native_dialog_count,
      boundaryCount: result.files.length + result.read_errors.length,
      readFailedCount: result.read_errors.length,
    });
  } catch (err) {
    // Never silently pretend this worked — a failed invoke means no
    // picker was ever shown, so the diagnostics panel needs to say that
    // plainly rather than staying on whatever it last reported.
    updateOpenAudioDiagnostics({
      pathway: "windows-native",
      dialogLaunched: false,
      win32MultiSelect: true,
      wmPasteReceived: false,
      openClipboardSucceeded: false,
      openClipboardError: 0,
      cfHdropAvailable: false,
      availableClipboardFormats: [],
      getClipboardDataSucceeded: false,
      dragQueryFileCount: 0,
      pasteHdropDetected: false,
      pasteHdropFileCount: 0,
      pasteHdropFileNames: [],
      pathsSuppliedToDialog: 0,
      nativeDialogCount: 0,
      boundaryCount: 0,
      jsReceivedCount: 0,
      readFailedCount: 0,
      supportedCount: 0,
      decodedCount: 0,
      failedDecodeCount: 0,
      skippedUnsupportedCount: 0,
      alreadyOpenCount: 0,
      reopenedCount: 0,
      declinedCount: 0,
      openedCount: 0,
      failureReason: err && err.message ? err.message : String(err),
    });
    announceAlert("Open Audio could not be opened. See the Open Audio Diagnostics panel for details.");
  }
}

async function handleOpenAudioInputChange() {
  const files = el.openAudioInput.files;
  if (!files || files.length === 0) return;
  await processOpenedFiles(Array.from(files), {
    pathway: "browser-input",
    dialogLaunched: false,
    win32MultiSelect: false,
    wmPasteReceived: false,
    openClipboardSucceeded: false,
    openClipboardError: 0,
    cfHdropAvailable: false,
    availableClipboardFormats: [],
    getClipboardDataSucceeded: false,
    dragQueryFileCount: 0,
    pasteHdropDetected: false,
    pasteHdropFileCount: 0,
    pasteHdropFileNames: [],
    pathsSuppliedToDialog: null,
    nativeDialogCount: null,
    boundaryCount: null,
    readFailedCount: 0,
  });
  el.openAudioInput.value = ""; // allow selecting the same file again later
}

/**
 * Shared by both the Tauri dialog path and the browser `<input>` fallback.
 * Opens every new file, and for any file that matches a document already
 * open, asks once (not per file) whether to open another copy — see
 * confirmReopenDuplicates. Ends with exactly one completion announcement
 * covering the whole operation, and records the full pipeline stage
 * counts to the on-demand Open Audio Diagnostics panel (never announced —
 * see updateOpenAudioDiagnostics).
 */
async function processOpenedFiles(fileArray, meta) {
  const jsReceivedCount = fileArray.length;

  const first = await docs.openFiles(fileArray);
  let opened = first.opened;
  let failed = first.failed;
  const skipped = first.skipped;
  let reopenedCount = 0;
  let declinedCount = 0;

  if (first.alreadyOpen.length > 0) {
    if (confirmReopenDuplicates(first.alreadyOpen)) {
      const second = await docs.openFiles(first.alreadyOpen, { allowDuplicates: true });
      opened = opened.concat(second.opened);
      failed = failed.concat(second.failed);
      reopenedCount = second.opened.length;
    } else {
      declinedCount = first.alreadyOpen.length;
    }
  }

  updateOpenAudioDiagnostics({
    pathway: meta.pathway,
    dialogLaunched: meta.dialogLaunched,
    win32MultiSelect: meta.win32MultiSelect,
    wmPasteReceived: meta.wmPasteReceived,
    openClipboardSucceeded: meta.openClipboardSucceeded,
    openClipboardError: meta.openClipboardError,
    cfHdropAvailable: meta.cfHdropAvailable,
    availableClipboardFormats: meta.availableClipboardFormats,
    getClipboardDataSucceeded: meta.getClipboardDataSucceeded,
    dragQueryFileCount: meta.dragQueryFileCount,
    pasteHdropDetected: meta.pasteHdropDetected,
    pasteHdropFileCount: meta.pasteHdropFileCount,
    pasteHdropFileNames: meta.pasteHdropFileNames,
    pathsSuppliedToDialog: meta.pathsSuppliedToDialog,
    nativeDialogCount: meta.nativeDialogCount,
    boundaryCount: meta.boundaryCount,
    jsReceivedCount,
    readFailedCount: meta.readFailedCount,
    supportedCount: opened.length + failed.length + first.alreadyOpen.length,
    decodedCount: opened.length,
    failedDecodeCount: failed.length,
    skippedUnsupportedCount: skipped.length,
    alreadyOpenCount: first.alreadyOpen.length,
    reopenedCount,
    declinedCount,
    openedCount: opened.length,
  });

  announceStatus(
    buildOpenSummary({
      openedCount: opened.length,
      skippedCount: skipped.length,
      failedCount: failed.length,
      declinedCount,
    })
  );

  render();
  if (opened.length > 0) {
    focusElement(el.documentSelect);
  } else {
    focusElement(el.openStatus);
  }
}

/**
 * One native confirm for the whole set of already-open files found in
 * this Open operation — never one dialog per duplicate file, which would
 * turn a single Open into a string of interruptions. Uses window.confirm,
 * consistent with this app's existing, already-documented convention for
 * infrequent, deliberate confirmations (Rename, Delete, Record Again).
 */
function confirmReopenDuplicates(duplicateFiles) {
  if (duplicateFiles.length === 1) {
    return window.confirm(`"${duplicateFiles[0].name}" is already open. Open another copy?`);
  }
  const names = duplicateFiles.map((f) => f.name).join(", ");
  return window.confirm(
    `${duplicateFiles.length} of the selected files are already open: ${names}. Open another copy of each?`
  );
}

/**
 * Build the single completion announcement for an Open Audio operation,
 * e.g. "10 audio files opened." or "10 audio files opened. 5 unsupported
 * files skipped." or "8 audio files opened. 1 already-open file not
 * reopened."
 */
function buildOpenSummary({ openedCount, skippedCount, failedCount, declinedCount = 0 }) {
  const parts = [];

  parts.push(
    openedCount === 0
      ? "No audio files opened."
      : openedCount === 1
      ? "1 audio file opened."
      : `${openedCount} audio files opened.`
  );

  if (skippedCount > 0) {
    parts.push(skippedCount === 1 ? "1 unsupported file skipped." : `${skippedCount} unsupported files skipped.`);
  }

  if (failedCount > 0) {
    parts.push(failedCount === 1 ? "1 file could not be opened." : `${failedCount} files could not be opened.`);
  }

  if (declinedCount > 0) {
    parts.push(
      declinedCount === 1
        ? "1 already-open file not reopened."
        : `${declinedCount} already-open files not reopened.`
    );
  }

  return parts.join(" ");
}

function handleNewAudio() {
  docs.createNewDocument();
  render();
  announceStatus("New audio document created.");
  focusElement(el.documentSelect);
}

function handleCloseDocument() {
  const active = docs.getActiveDocument();
  if (!active) return;

  if (active.dirty) {
    const confirmed = window.confirm(
      `"${active.title}" has unsaved changes. Close it anyway and lose those changes?`
    );
    if (!confirmed) return;
  }

  player.stop();
  docs.closeDocument(active.id, { force: true });
  render();

  if (docs.documentCount() > 0) {
    announceStatus("Audio document closed.");
    focusElement(el.documentSelect);
  } else {
    announceStatus("Audio document closed. No audio documents are open.");
    focusElement(el.openStatus);
  }
}

// ---------------------------------------------------------------------
// Navigation
// ---------------------------------------------------------------------

function handleNavigate(deltaSec) {
  const active = docs.getActiveDocument();
  if (!active) return;
  active.moveCursor(deltaSec);
  updatePositionDisplay();
  announceStatus(formatTimePrecise(active.cursorSec));
}

function handleJump(toSec) {
  const active = docs.getActiveDocument();
  if (!active) return;
  active.cursorSec = Math.max(0, Math.min(active.durationSec, toSec));
  updatePositionDisplay();
  announceStatus(formatTimePrecise(active.cursorSec));
}

function handleAnnouncePosition() {
  const active = docs.getActiveDocument();
  if (!active) return;
  announceStatus(formatTimePrecise(active.cursorSec));
}

// ---------------------------------------------------------------------
// Selection
// ---------------------------------------------------------------------

function handleSetSelectionStart() {
  const active = docs.getActiveDocument();
  if (!active) return;
  active.setSelectionStart(active.cursorSec);
  updateSelectionDisplay();
  announceStatus(`Selection start set. ${formatTimePrecise(active.selection.startSec)}.`);
}

function handleSetSelectionEnd() {
  const active = docs.getActiveDocument();
  if (!active) return;
  active.setSelectionEnd(active.cursorSec);
  updateSelectionDisplay();
  announceStatus(`Selection end set. ${formatTimePrecise(active.selection.endSec)}.`);
}

function handleSelectAll() {
  const active = docs.getActiveDocument();
  if (!active) return;
  active.selectAll();
  updateSelectionDisplay();
  announceStatus(`All selected. ${formatTimePrecise(active.selectionDurationSec())} selected.`);
}

function handleClearSelection() {
  const active = docs.getActiveDocument();
  if (!active) return;
  active.clearSelection();
  updateSelectionDisplay();
  announceStatus("Selection cleared.");
}

function handleAnnounceSelection() {
  const active = docs.getActiveDocument();
  if (!active) return;
  if (!active.hasSelection()) {
    announceStatus("No selection.");
    return;
  }
  announceStatus(
    `Selection start: ${formatTimePrecise(active.selection.startSec)}. ` +
      `Selection end: ${formatTimePrecise(active.selection.endSec)}. ` +
      `Selection duration: ${formatTimePrecise(active.selectionDurationSec())}.`
  );
}

// ---------------------------------------------------------------------
// Play / Preview
// ---------------------------------------------------------------------

function handleEditorPlayPause() {
  const active = docs.getActiveDocument();
  if (!active) return;

  if (player.isPlaying()) {
    active.cursorSec = player.getPositionSec();
    player.stop();
    el.editorPlayPauseButton.textContent = "Play";
    updatePositionDisplay();
    announceStatus("Playback paused.");
    return;
  }

  player.play(active.buffer, active.cursorSec, active.durationSec);
  el.editorPlayPauseButton.textContent = "Pause";
  announceStatus("Playback started.");
}

function handlePreviewSelection() {
  const active = docs.getActiveDocument();
  if (!active) return;
  if (!active.hasSelection()) {
    announceAlert("There is no selection to preview.");
    return;
  }
  player.play(active.buffer, active.selection.startSec, active.selection.endSec);
  el.editorPreviewButton.textContent = "Stop Preview";
  announceStatus("Previewing selection.");
}

// ---------------------------------------------------------------------
// Editing
// ---------------------------------------------------------------------

function handleCut() {
  const active = docs.getActiveDocument();
  if (!active) return;
  if (!active.hasSelection()) {
    announceAlert("There is no selection to cut.");
    return;
  }
  const { startSec, endSec } = active.selection;
  const cutPiece = bufUtil.sliceBuffer(active.buffer, startSec, endSec);
  clipboard.setClipboard(cutPiece);

  const newBuffer = bufUtil.deleteRange(active.buffer, startSec, endSec);
  active.applyEdit(newBuffer);

  refreshAfterEdit(active);
  announceStatus("Selection cut.");
}

function handleCopy() {
  const active = docs.getActiveDocument();
  if (!active) return;
  if (!active.hasSelection()) {
    announceAlert("There is no selection to copy.");
    return;
  }
  const { startSec, endSec } = active.selection;
  clipboard.setClipboard(bufUtil.sliceBuffer(active.buffer, startSec, endSec));
  announceStatus("Selection copied.");
}

async function handlePaste() {
  const active = docs.getActiveDocument();
  if (!active) return;
  const clip = clipboard.getClipboard();
  if (!clip) {
    announceAlert("Nothing has been copied or cut yet.");
    return;
  }

  try {
    const { buffer: reconciled, converted } = await bufUtil.reconcileToDestination(
      clip,
      active.sampleRate,
      active.numChannels
    );

    const insertAt = active.hasSelection() ? active.selection.startSec : active.cursorSec;
    const newBuffer = bufUtil.insertBufferAt(active.buffer, reconciled, insertAt);
    active.applyEdit(newBuffer);
    active.cursorSec = insertAt + reconciled.length / reconciled.sampleRate;

    refreshAfterEdit(active);
    announceStatus(converted ? "Audio converted to match destination. Audio pasted." : "Audio pasted.");
  } catch (err) {
    announceAlert(
      "Paste failed. The copied audio could not be converted to match this document. " +
        (err && err.message ? err.message : "")
    );
  }
}

function handleDeleteSelection() {
  const active = docs.getActiveDocument();
  if (!active) return;
  if (!active.hasSelection()) {
    announceAlert("There is no selection to delete.");
    return;
  }
  const { startSec, endSec } = active.selection;
  const newBuffer = bufUtil.deleteRange(active.buffer, startSec, endSec);
  active.applyEdit(newBuffer);
  active.cursorSec = startSec;

  refreshAfterEdit(active);
  announceStatus("Selection deleted.");
}

function handleTrim() {
  const active = docs.getActiveDocument();
  if (!active) return;
  if (!active.hasSelection()) {
    announceAlert("There is no selection to trim to.");
    return;
  }
  const { startSec, endSec } = active.selection;
  const newBuffer = bufUtil.sliceBuffer(active.buffer, startSec, endSec);
  active.applyEdit(newBuffer);
  active.cursorSec = 0;

  refreshAfterEdit(active);
  announceStatus("Trimmed to selection.");
}

function handleUndo() {
  const active = docs.getActiveDocument();
  if (!active) return;
  if (!active.canUndo()) {
    announceAlert("Nothing to undo.");
    return;
  }
  active.undo();
  refreshAfterEdit(active);
  announceStatus("Edit undone.");
}

function handleRedo() {
  const active = docs.getActiveDocument();
  if (!active) return;
  if (!active.canRedo()) {
    announceAlert("Nothing to redo.");
    return;
  }
  active.redo();
  refreshAfterEdit(active);
  announceStatus("Edit redone.");
}

function refreshAfterEdit(active) {
  player.stop();
  el.editorPlayPauseButton.textContent = "Play";
  el.editorPreviewButton.textContent = "Preview Selection";
  renderDocumentOptions(); // titles include an "(unsaved changes)" marker
  updatePositionDisplay();
  updateSelectionDisplay();
  updateButtonStates(active);
}

// ---------------------------------------------------------------------
// Save / Save As
// ---------------------------------------------------------------------

async function handleSave() {
  const active = docs.getActiveDocument();
  if (!active) return;
  // WAV and MP3 are the two formats this app can write (see audioCodec.js).
  // A document opened from some other supported format (M4A/FLAC/OGG)
  // saves as WAV instead of silently failing — the user is told so, since
  // that changes the file extension they'll see.
  const canKeepFormat = active.sourceExtension === "mp3" || active.sourceExtension === "wav";
  const format = canKeepFormat ? active.sourceExtension : "wav";
  const name = (active.baseName ? stripExtension(active.baseName) : "Untitled Audio") + "." + format;
  await saveAs(active, name, format, {
    formatSubstituted: !canKeepFormat,
    originalExtension: active.sourceExtension,
  });
}

function openSaveAsForm() {
  const active = docs.getActiveDocument();
  if (!active) return;
  el.saveAsNameInput.value = active.baseName ? stripExtension(active.baseName) : "Untitled Audio";
  el.saveAsFormatSelect.value = active.sourceExtension === "mp3" ? "mp3" : "wav";
  el.saveAsForm.hidden = false;
  el.saveAsNameInput.focus();
}

function closeSaveAsForm() {
  el.saveAsForm.hidden = true;
}

async function handleConfirmSaveAs() {
  const active = docs.getActiveDocument();
  if (!active) return;
  const rawName = el.saveAsNameInput.value.trim();
  if (!rawName) {
    announceAlert("Enter a file name before saving.");
    return;
  }
  const format = el.saveAsFormatSelect.value;
  el.saveAsForm.hidden = true;
  await saveAs(active, rawName + "." + format, format);
}

async function saveAs(document_, filename, format, { formatSubstituted = false, originalExtension = "" } = {}) {
  try {
    const blob = format === "mp3" ? encodeMp3(document_.buffer) : encodeWav(document_.buffer);
    downloadBlob(blob, filename);

    document_.baseName = filename;
    document_.sourceExtension = format;
    document_.markSaved();

    renderDocumentOptions();
    updateButtonStates(document_);
    announceStatus(
      formatSubstituted
        ? `Audio saved as ${format.toUpperCase()}. AccessibleAudioStudio Pro cannot write .${originalExtension} files, so it saved as ${format.toUpperCase()} instead.`
        : "Audio saved."
    );
  } catch (err) {
    announceAlert(
      `Save failed. ${err && err.message ? err.message : "The audio could not be encoded."} ` +
        "Try saving as WAV instead."
    );
  }
}

function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function stripExtension(filename) {
  const i = filename.lastIndexOf(".");
  return i > -1 ? filename.slice(0, i) : filename;
}

// ---------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------

function render() {
  const count = docs.documentCount();
  el.documentArea.hidden = count === 0;
  el.openStatus.textContent =
    count === 0
      ? "No audio documents are open."
      : `${count} audio document${count === 1 ? "" : "s"} open.`;

  renderDocumentOptions();

  updatePositionDisplay();
  updateSelectionDisplay();
  updateButtonStates(docs.getActiveDocument());
}

// The page's title is the app's one authoritative "which document/app is
// this" signal for a screen reader (and the OS window/taskbar title in the
// desktop build) — it must always say "AccessibleAudioStudio Pro" or a
// specific document's own Pro-branded title, never the free edition's
// title. This is the single place that sets document.title, specifically
// so there's only one string to keep correct instead of several that can
// drift out of sync with each other (as happened before: the static
// <title> in index.html was corrected for 0.1.2, but this fallback string
// was not, and silently overwrote it on the very first render).
const DEFAULT_DOCUMENT_TITLE = "Audio Recording - AccessibleAudioStudio Pro";

function renderDocumentOptions() {
  const active = docs.getActiveDocument();
  el.documentSelect.innerHTML = "";
  docs.getDocuments().forEach((doc) => {
    const option = document.createElement("option");
    option.value = doc.id;
    option.textContent = doc.title;
    el.documentSelect.appendChild(option);
  });
  if (active) el.documentSelect.value = active.id;
  window.document.title = active ? active.title : DEFAULT_DOCUMENT_TITLE;
}

function updatePositionDisplay() {
  const active = docs.getActiveDocument();
  el.positionInfo.textContent = active
    ? `Position: ${formatTimePrecise(active.cursorSec)}. Total duration: ${formatDurationNatural(active.durationSec)}.`
    : "";
}

function updateSelectionDisplay() {
  const active = docs.getActiveDocument();
  if (!active) {
    el.selectionInfo.textContent = "";
    return;
  }
  el.selectionInfo.textContent = active.hasSelection()
    ? `Selection start: ${formatTimePrecise(active.selection.startSec)}. ` +
      `Selection end: ${formatTimePrecise(active.selection.endSec)}. ` +
      `Selection duration: ${formatTimePrecise(active.selectionDurationSec())}.`
    : "No selection.";
}

function updateButtonStates(active) {
  const has = !!active;
  const hasSelection = has && active.hasSelection();
  const hasClipboard = clipboard.clipboardHasContent();

  [
    el.closeDocumentButton,
    ...el.navButtons,
    el.jumpBeginningButton,
    el.jumpEndButton,
    el.announcePositionButton,
    el.setSelectionStartButton,
    el.setSelectionEndButton,
    el.selectAllButton,
    el.editorPlayPauseButton,
    el.saveButton,
    el.saveAsButton,
  ].forEach((button) => (button.disabled = !has));

  el.clearSelectionButton.disabled = !hasSelection;
  el.announceSelectionButton.disabled = !hasSelection;
  el.editorPreviewButton.disabled = !hasSelection;
  el.cutButton.disabled = !hasSelection;
  el.copyButton.disabled = !hasSelection;
  el.deleteSelectionButton.disabled = !hasSelection;
  el.trimButton.disabled = !hasSelection;
  el.pasteButton.disabled = !has || !hasClipboard;
  el.undoButton.disabled = !has || !active.canUndo();
  el.redoButton.disabled = !has || !active.canRedo();
}

// ---------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------

function focusElement(target) {
  if (!target) return;
  if (!target.hasAttribute("tabindex")) target.setAttribute("tabindex", "-1");
  target.focus();
}

// ---------------------------------------------------------------------
// Open Audio Diagnostics
// ---------------------------------------------------------------------
// An on-demand, collapsed panel (mirrors the existing Keyboard Shortcut
// Diagnostics pattern in main.js) reporting exactly where files are lost
// between "the user selected N files in the native dialog" and "N
// documents opened" — for diagnosing a report like "I selected 15 files
// and only 1 opened" without guessing which stage is actually at fault.
// This is deliberately NOT announced automatically; it only updates
// visible text, exactly like the shortcut diagnostics panel, so it never
// adds unsolicited screen reader speech to an ordinary Open Audio.

function updateOpenAudioDiagnostics(stats) {
  if (!el.openAudioDiagnostics) return;

  const isWindowsNativePathway = stats.pathway === "windows-native";

  const dialogLaunchedLine = isWindowsNativePathway
    ? `Open dialog launched: ${stats.dialogLaunched ? "yes" : "no"}.`
    : "Open dialog launched: not applicable (browser file picker used).";

  const multiSelectLine = isWindowsNativePathway
    ? `Multi-select enabled: ${stats.win32MultiSelect ? "yes" : "no"}.`
    : "Multi-select enabled: not applicable (browser file picker used).";

  // The full clipboard-boundary breakdown, stage by stage, so a "no"
  // never collapses several genuinely different failures into one
  // undifferentiated answer: the subclass not receiving WM_PASTE at all
  // is a different finding than OpenClipboard failing, which is
  // different from CF_HDROP genuinely not being available, which is
  // different from CF_HDROP being available but GetClipboardData
  // failing, which is different from GetClipboardData succeeding but
  // DragQueryFileW returning nothing. Each stage below only fires if
  // WM_PASTE actually reached the subclass at all — if it didn't, that
  // is itself the answer, and every stage after it is reported as
  // not reached rather than a misleading "no".
  const wmPasteLine = isWindowsNativePathway
    ? `WM_PASTE received by subclass: ${stats.wmPasteReceived ? "yes" : "no"}.`
    : "WM_PASTE received by subclass: not applicable (browser file picker used).";

  const clipboardLines = [];
  if (isWindowsNativePathway) {
    if (!stats.wmPasteReceived) {
      clipboardLines.push("Clipboard was never read: WM_PASTE was not received.");
    } else {
      clipboardLines.push(
        stats.openClipboardSucceeded
          ? "OpenClipboard: succeeded."
          : `OpenClipboard: failed (Windows error code ${stats.openClipboardError}).`
      );
      if (stats.openClipboardSucceeded) {
        clipboardLines.push(
          `Clipboard formats available: ${
            stats.availableClipboardFormats && stats.availableClipboardFormats.length
              ? stats.availableClipboardFormats.join(", ")
              : "none"
          }.`
        );
        clipboardLines.push(`CF_HDROP available: ${stats.cfHdropAvailable ? "yes" : "no"}.`);
        if (stats.cfHdropAvailable) {
          clipboardLines.push(
            `GetClipboardData(CF_HDROP): ${stats.getClipboardDataSucceeded ? "succeeded" : "failed"}.`
          );
          if (stats.getClipboardDataSucceeded) {
            clipboardLines.push(`DragQueryFileW file count: ${stats.dragQueryFileCount}.`);
            clipboardLines.push(
              stats.pasteHdropFileNames && stats.pasteHdropFileNames.length
                ? `Paths obtained: ${stats.pasteHdropFileNames.join(", ")}.`
                : "Paths obtained: none."
            );
          }
        }
      }
    }
  }

  const pasteHdropLine = isWindowsNativePathway
    ? `Multi-file paste used (2+ files): ${stats.pasteHdropDetected ? "yes" : "no"}.`
    : "Multi-file paste used: not applicable (browser file picker used).";

  const pathsSuppliedLine = isWindowsNativePathway
    ? `File paths inserted/communicated to dialog: ${stats.pathsSuppliedToDialog}.`
    : null;

  const nativeReturnedLine = isWindowsNativePathway
    ? `Native dialog returned: ${stats.nativeDialogCount} file${stats.nativeDialogCount === 1 ? "" : "s"}.`
    : "Native dialog: not applicable.";

  // Picking and reading both happen in one Rust command before anything
  // crosses back to JavaScript — so "passed across the Rust/Tauri
  // boundary" and "read successfully" are reported from the same single
  // IPC response, not from two separate round trips a different
  // architecture might use. Both are still reported as distinct numbers
  // so a mismatch between them stays visible either way.
  const boundaryLine = isWindowsNativePathway
    ? `Passed across Rust/Tauri boundary: ${stats.boundaryCount} file${stats.boundaryCount === 1 ? "" : "s"}.`
    : "Rust/Tauri boundary: not applicable.";

  const readLine = isWindowsNativePathway
    ? `Files read successfully: ${stats.jsReceivedCount} of ${stats.boundaryCount}${stats.readFailedCount ? ` (${stats.readFailedCount} failed to read)` : ""}.`
    : `Files read successfully: ${stats.jsReceivedCount} (browser file picker already provides file data directly).`;

  el.openAudioDiagnostics.textContent = [
    `Last Open Audio operation, ${new Date().toLocaleTimeString()}:`,
    stats.failureReason ? `Open Audio could not be completed: ${stats.failureReason}.` : null,
    dialogLaunchedLine,
    multiSelectLine,
    wmPasteLine,
    ...clipboardLines,
    pasteHdropLine,
    pathsSuppliedLine,
    nativeReturnedLine,
    boundaryLine,
    readLine,
    `Received in JavaScript: ${stats.jsReceivedCount} file${stats.jsReceivedCount === 1 ? "" : "s"}.`,
    `Supported audio files: ${stats.supportedCount}.`,
    `Unsupported files skipped: ${stats.skippedUnsupportedCount}.`,
    `Files decoded: ${stats.decodedCount}${stats.failedDecodeCount ? ` (${stats.failedDecodeCount} failed to decode)` : ""}.`,
    stats.alreadyOpenCount > 0
      ? `Already-open files found: ${stats.alreadyOpenCount} (${stats.reopenedCount} reopened as a copy, ${stats.declinedCount} declined).`
      : null,
    `Documents opened: ${stats.openedCount}.`,
  ]
    .filter(Boolean)
    .join(" ");
}

