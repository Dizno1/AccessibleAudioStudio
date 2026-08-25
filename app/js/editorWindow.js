// editorWindow.js
// The controller for one AccessibleAudioStudio Pro editor window — one
// per open audio document, as of the 0.2.0 architectural rebuild. Unlike
// 0.1.x's audioEditorController.js, this file never manages more than one
// document at a time, because it never needs to: this window IS that
// document. There is no document-switching combo box, no close-document
// button (closing this window closes this document — the operating
// system already provides that), and no document list to render.
//
// The actual editing logic below (navigate, select, cut/copy/paste,
// undo/redo, save) is carried over from the proven, previously-tested
// 0.1.x controller with minimal changes: `docs.getActiveDocument()` calls
// became a single `activeDoc` module-level reference, and
// clipboard.setClipboard/getClipboard calls now await, since the
// clipboard itself moved to shared Rust-side state (see
// audioClipboard.js) so Copy in one window and Paste in another can work
// at all. Nothing about how an edit is actually performed on an
// AudioBuffer changed.

import { announceStatus, announceAlert } from "./announcer.js";
import { formatTimePrecise, formatDurationNatural } from "./timeFormat.js";
import * as bufUtil from "./audioBufferUtils.js";
import { encodeWav, encodeMp3, getAudioContext, decodeAudioFile } from "./audioCodec.js";
import { BufferPlayer } from "./audioBufferPlayer.js";
import * as clipboard from "./audioClipboard.js";
import { AudioDocument } from "./audioDocument.js";
import { initShortcutService, registerAction } from "./shortcutService.js";
import { onShortcutEvent, getLastShortcutEvent } from "./shortcutDiagnostics.js";
import { initAnnouncer } from "./announcer.js";

let el = {};
const player = new BufferPlayer();
let activeDoc = null;

function isRunningInTauri() {
  return typeof window !== "undefined" && !!window.__TAURI__;
}

async function main() {
  cacheElements();
  bindEvents();
  initAnnouncer();
  initShortcutService();
  registerShortcutActions();
  initShortcutDiagnosticsPanel();
  player.onEnded = () => {
    el.editorPlayPauseButton.textContent = "Play";
    el.editorPreviewButton.textContent = "Preview Selection";
  };

  await loadDocumentForThisWindow();
}

function initShortcutDiagnosticsPanel() {
  if (!el.diagnosticsLastShortcut) return;

  const render = (event) => {
    if (!event) {
      el.diagnosticsLastShortcut.textContent = "No shortcut received yet.";
      return;
    }
    const time = event.timestamp.toLocaleTimeString();
    if (event.executed) {
      el.diagnosticsLastShortcut.textContent =
        `Last shortcut detected: ${event.label} (${event.description}) at ${time}. ` +
        `Action executed: ${event.resultText}.`;
    } else {
      el.diagnosticsLastShortcut.textContent =
        `Last shortcut detected: ${event.label} (${event.description}) at ${time}. ` +
        `Action ignored: ${event.reason}`;
    }
  };

  render(getLastShortcutEvent());
  onShortcutEvent(render);
}

// ---------------------------------------------------------------------
// Window init: ask Rust what this window is supposed to be editing
// ---------------------------------------------------------------------

async function loadDocumentForThisWindow() {
  if (!isRunningInTauri()) {
    // Browser fallback (e.g. previewing this page directly, with no
    // Tauri runtime): there is no pending source to fetch, so start with
    // a plain empty document rather than failing outright.
    activeDoc = new AudioDocument({
      buffer: bufUtil.createEmptyBuffer(44100, 2),
      baseName: null,
      sourceExtension: "wav",
      isNew: true,
    });
    finishLoadingDocument();
    return;
  }

  try {
    const { invoke } = window.__TAURI__.core;
    const info = await invoke("get_editor_init_info");
    // info: { kind: "file" | "new", name, path, data }

    if (info.kind === "new") {
      activeDoc = new AudioDocument({
        buffer: bufUtil.createEmptyBuffer(44100, 2),
        baseName: null,
        sourceExtension: "wav",
        isNew: true,
      });
    } else {
      const file = new File([new Uint8Array(info.data)], info.name);
      const buffer = await decodeAudioFile(file);
      const extension = (info.name.split(".").pop() || "wav").toLowerCase();
      activeDoc = new AudioDocument({
        buffer,
        baseName: info.name,
        sourceExtension: extension,
        sourceKey: info.path || info.name,
      });
    }

    finishLoadingDocument();
  } catch (err) {
    el.documentHeading.textContent = "This document could not be opened";
    announceAlert(
      "This audio document could not be opened. " + (err && err.message ? err.message : String(err))
    );
  }
}

function finishLoadingDocument() {
  updateWindowTitle();
  render();
  announceStatus(`${activeDoc.baseName || activeDoc.title.replace(" - AccessibleAudioStudio Pro", "")} opened.`);
  focusElement(el.documentHeading);
}

/**
 * Keeps the real OS window title in sync with the document's own title
 * (including its "(unsaved changes)" marker) — this is the single most
 * important accessibility surface in the whole 0.2.0 architecture, since
 * Alt+Tab and a screen reader's window list both read directly from it,
 * with no in-page combo box standing in as a fallback anymore.
 */
async function updateWindowTitle() {
  if (!isRunningInTauri()) return;
  try {
    const { getCurrentWindow } = window.__TAURI__.window;
    await getCurrentWindow().setTitle(activeDoc.title);
  } catch (err) {
    // A window-title update failing is not worth interrupting the user
    // over — the in-page heading (updated separately, see render()) still
    // carries the same information for anyone reading the page itself.
  }
}

// ---------------------------------------------------------------------
// Elements & events
// ---------------------------------------------------------------------

function cacheElements() {
  el = {
    documentHeading: document.getElementById("document-heading"),
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

    diagnosticsLastShortcut: document.getElementById("diagnostics-last-shortcut"),
  };
}

function bindEvents() {
  el.navButtons.forEach((button) => {
    button.addEventListener("click", () => handleNavigate(parseFloat(button.dataset.nav)));
  });
  el.jumpBeginningButton.addEventListener("click", () => handleJump(0));
  el.jumpEndButton.addEventListener("click", () => {
    if (activeDoc) handleJump(activeDoc.durationSec);
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

function registerShortcutActions() {
  registerAction("copySelection", () => {
    if (!activeDoc || !activeDoc.hasSelection()) return { executed: false, reason: "There is no selection to copy." };
    handleCopy();
    return { executed: true, resultText: "Copy" };
  });
  registerAction("cutSelection", () => {
    if (!activeDoc || !activeDoc.hasSelection()) return { executed: false, reason: "There is no selection to cut." };
    handleCut();
    return { executed: true, resultText: "Cut" };
  });
  registerAction("pasteSelection", () => {
    if (!activeDoc) return { executed: false, reason: "No audio document is open." };
    handlePaste();
    return { executed: true, resultText: "Paste" };
  });
  registerAction("undoEdit", () => {
    if (!activeDoc || !activeDoc.canUndo()) return { executed: false, reason: "Nothing to undo." };
    handleUndo();
    return { executed: true, resultText: "Undo" };
  });
  registerAction("redoEdit", () => {
    if (!activeDoc || !activeDoc.canRedo()) return { executed: false, reason: "Nothing to redo." };
    handleRedo();
    return { executed: true, resultText: "Redo" };
  });
  registerAction("saveAudio", () => {
    if (!activeDoc) return { executed: false, reason: "No audio document is open." };
    handleSave();
    return { executed: true, resultText: "Save" };
  });
  registerAction("saveAudioAs", () => {
    if (!activeDoc) return { executed: false, reason: "No audio document is open." };
    openSaveAsForm();
    return { executed: true, resultText: "Save As" };
  });
}

// ---------------------------------------------------------------------
// Navigation
// ---------------------------------------------------------------------

function handleNavigate(deltaSec) {
  if (!activeDoc) return;
  activeDoc.moveCursor(deltaSec);
  updatePositionDisplay();
  announceStatus(formatTimePrecise(activeDoc.cursorSec));
}

function handleJump(toSec) {
  if (!activeDoc) return;
  activeDoc.cursorSec = Math.max(0, Math.min(activeDoc.durationSec, toSec));
  updatePositionDisplay();
  announceStatus(formatTimePrecise(activeDoc.cursorSec));
}

function handleAnnouncePosition() {
  if (!activeDoc) return;
  announceStatus(formatTimePrecise(activeDoc.cursorSec));
}

// ---------------------------------------------------------------------
// Selection
// ---------------------------------------------------------------------

function handleSetSelectionStart() {
  if (!activeDoc) return;
  activeDoc.setSelectionStart(activeDoc.cursorSec);
  updateSelectionDisplay();
  announceStatus(`Selection start set. ${formatTimePrecise(activeDoc.selection.startSec)}.`);
}

function handleSetSelectionEnd() {
  if (!activeDoc) return;
  activeDoc.setSelectionEnd(activeDoc.cursorSec);
  updateSelectionDisplay();
  announceStatus(`Selection end set. ${formatTimePrecise(activeDoc.selection.endSec)}.`);
}

function handleSelectAll() {
  if (!activeDoc) return;
  activeDoc.selectAll();
  updateSelectionDisplay();
  announceStatus(`All selected. ${formatTimePrecise(activeDoc.selectionDurationSec())} selected.`);
}

function handleClearSelection() {
  if (!activeDoc) return;
  activeDoc.clearSelection();
  updateSelectionDisplay();
  announceStatus("Selection cleared.");
}

function handleAnnounceSelection() {
  if (!activeDoc) return;
  if (!activeDoc.hasSelection()) {
    announceStatus("No selection.");
    return;
  }
  announceStatus(
    `Selection start: ${formatTimePrecise(activeDoc.selection.startSec)}. ` +
      `Selection end: ${formatTimePrecise(activeDoc.selection.endSec)}. ` +
      `Selection duration: ${formatTimePrecise(activeDoc.selectionDurationSec())}.`
  );
}

// ---------------------------------------------------------------------
// Play / Preview
// ---------------------------------------------------------------------

function handleEditorPlayPause() {
  if (!activeDoc) return;

  if (player.isPlaying()) {
    activeDoc.cursorSec = player.getPositionSec();
    player.stop();
    el.editorPlayPauseButton.textContent = "Play";
    updatePositionDisplay();
    announceStatus("Playback paused.");
    return;
  }

  player.play(activeDoc.buffer, activeDoc.cursorSec, activeDoc.durationSec);
  el.editorPlayPauseButton.textContent = "Pause";
  announceStatus("Playback started.");
}

function handlePreviewSelection() {
  if (!activeDoc) return;
  if (!activeDoc.hasSelection()) {
    announceAlert("There is no selection to preview.");
    return;
  }
  player.play(activeDoc.buffer, activeDoc.selection.startSec, activeDoc.selection.endSec);
  el.editorPreviewButton.textContent = "Stop Preview";
  announceStatus("Previewing selection.");
}

// ---------------------------------------------------------------------
// Editing
// ---------------------------------------------------------------------

async function handleCut() {
  if (!activeDoc) return;
  if (!activeDoc.hasSelection()) {
    announceAlert("There is no selection to cut.");
    return;
  }
  const { startSec, endSec } = activeDoc.selection;
  const cutPiece = bufUtil.sliceBuffer(activeDoc.buffer, startSec, endSec);
  await clipboard.setClipboard(cutPiece);

  const newBuffer = bufUtil.deleteRange(activeDoc.buffer, startSec, endSec);
  activeDoc.applyEdit(newBuffer);

  refreshAfterEdit();
  announceStatus("Selection cut.");
}

async function handleCopy() {
  if (!activeDoc) return;
  if (!activeDoc.hasSelection()) {
    announceAlert("There is no selection to copy.");
    return;
  }
  const { startSec, endSec } = activeDoc.selection;
  await clipboard.setClipboard(bufUtil.sliceBuffer(activeDoc.buffer, startSec, endSec));
  announceStatus("Selection copied.");
}

async function handlePaste() {
  if (!activeDoc) return;
  const clip = await clipboard.getClipboard(getAudioContext());
  if (!clip) {
    announceAlert("Nothing has been copied or cut yet.");
    return;
  }

  try {
    const { buffer: reconciled, converted } = await bufUtil.reconcileToDestination(
      clip,
      activeDoc.sampleRate,
      activeDoc.numChannels
    );

    const insertAt = activeDoc.hasSelection() ? activeDoc.selection.startSec : activeDoc.cursorSec;
    const newBuffer = bufUtil.insertBufferAt(activeDoc.buffer, reconciled, insertAt);
    activeDoc.applyEdit(newBuffer);
    activeDoc.cursorSec = insertAt + reconciled.length / reconciled.sampleRate;

    refreshAfterEdit();
    announceStatus(converted ? "Audio converted to match destination. Audio pasted." : "Audio pasted.");
  } catch (err) {
    announceAlert(
      "Paste failed. The copied audio could not be converted to match this document. " +
        (err && err.message ? err.message : "")
    );
  }
}

function handleDeleteSelection() {
  if (!activeDoc) return;
  if (!activeDoc.hasSelection()) {
    announceAlert("There is no selection to delete.");
    return;
  }
  const { startSec, endSec } = activeDoc.selection;
  const newBuffer = bufUtil.deleteRange(activeDoc.buffer, startSec, endSec);
  activeDoc.applyEdit(newBuffer);
  activeDoc.cursorSec = startSec;

  refreshAfterEdit();
  announceStatus("Selection deleted.");
}

function handleTrim() {
  if (!activeDoc) return;
  if (!activeDoc.hasSelection()) {
    announceAlert("There is no selection to trim to.");
    return;
  }
  const { startSec, endSec } = activeDoc.selection;
  const newBuffer = bufUtil.sliceBuffer(activeDoc.buffer, startSec, endSec);
  activeDoc.applyEdit(newBuffer);
  activeDoc.cursorSec = 0;

  refreshAfterEdit();
  announceStatus("Trimmed to selection.");
}

function handleUndo() {
  if (!activeDoc) return;
  if (!activeDoc.canUndo()) {
    announceAlert("Nothing to undo.");
    return;
  }
  activeDoc.undo();
  refreshAfterEdit();
  announceStatus("Edit undone.");
}

function handleRedo() {
  if (!activeDoc) return;
  if (!activeDoc.canRedo()) {
    announceAlert("Nothing to redo.");
    return;
  }
  activeDoc.redo();
  refreshAfterEdit();
  announceStatus("Edit redone.");
}

function refreshAfterEdit() {
  player.stop();
  el.editorPlayPauseButton.textContent = "Play";
  el.editorPreviewButton.textContent = "Preview Selection";
  updateWindowTitle(); // title's "(unsaved changes)" marker is the only per-document status surface now
  updatePositionDisplay();
  updateSelectionDisplay();
  updateButtonStates();
}

// ---------------------------------------------------------------------
// Save / Save As
// ---------------------------------------------------------------------

async function handleSave() {
  if (!activeDoc) return;
  const canKeepFormat = activeDoc.sourceExtension === "mp3" || activeDoc.sourceExtension === "wav";
  const format = canKeepFormat ? activeDoc.sourceExtension : "wav";
  const name = (activeDoc.baseName ? stripExtension(activeDoc.baseName) : "Untitled Audio") + "." + format;
  await saveAs(name, format, {
    formatSubstituted: !canKeepFormat,
    originalExtension: activeDoc.sourceExtension,
  });
}

function openSaveAsForm() {
  if (!activeDoc) return;
  el.saveAsNameInput.value = activeDoc.baseName ? stripExtension(activeDoc.baseName) : "Untitled Audio";
  el.saveAsFormatSelect.value = activeDoc.sourceExtension === "mp3" ? "mp3" : "wav";
  el.saveAsForm.hidden = false;
  el.saveAsNameInput.focus();
}

function closeSaveAsForm() {
  el.saveAsForm.hidden = true;
}

async function handleConfirmSaveAs() {
  if (!activeDoc) return;
  const rawName = el.saveAsNameInput.value.trim();
  if (!rawName) {
    announceAlert("Enter a file name before saving.");
    return;
  }
  const format = el.saveAsFormatSelect.value;
  el.saveAsForm.hidden = true;
  await saveAs(rawName + "." + format, format);
}

async function saveAs(filename, format, { formatSubstituted = false, originalExtension = "" } = {}) {
  try {
    const blob = format === "mp3" ? encodeMp3(activeDoc.buffer) : encodeWav(activeDoc.buffer);
    downloadBlob(blob, filename);

    activeDoc.baseName = filename;
    activeDoc.sourceExtension = format;
    activeDoc.markSaved();

    updateWindowTitle();
    updateButtonStates();
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
  if (!activeDoc) return;
  el.documentHeading.textContent = activeDoc.title;
  updatePositionDisplay();
  updateSelectionDisplay();
  updateButtonStates();
}

function updatePositionDisplay() {
  el.positionInfo.textContent = activeDoc
    ? `Position: ${formatTimePrecise(activeDoc.cursorSec)}. Total duration: ${formatDurationNatural(activeDoc.durationSec)}.`
    : "";
}

function updateSelectionDisplay() {
  if (!activeDoc) {
    el.selectionInfo.textContent = "";
    return;
  }
  el.selectionInfo.textContent = activeDoc.hasSelection()
    ? `Selection start: ${formatTimePrecise(activeDoc.selection.startSec)}. ` +
      `Selection end: ${formatTimePrecise(activeDoc.selection.endSec)}. ` +
      `Selection duration: ${formatTimePrecise(activeDoc.selectionDurationSec())}.`
    : "No selection.";
}

function updateButtonStates() {
  const has = !!activeDoc;
  const hasSelection = has && activeDoc.hasSelection();

  [
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
  el.pasteButton.disabled = !has;
  el.undoButton.disabled = !has || !activeDoc.canUndo();
  el.redoButton.disabled = !has || !activeDoc.canRedo();
}

// ---------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------

function focusElement(target) {
  if (!target) return;
  if (!target.hasAttribute("tabindex")) target.setAttribute("tabindex", "-1");
  target.focus();
}

main();
