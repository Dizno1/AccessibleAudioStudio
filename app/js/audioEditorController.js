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
    el.openAudioInput.click();
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
  el.openAudioButton.addEventListener("click", () => el.openAudioInput.click());
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

async function handleOpenAudioInputChange() {
  const files = el.openAudioInput.files;
  if (!files || files.length === 0) return;

  const { opened, failed, skipped } = await docs.openFiles(files);
  el.openAudioInput.value = ""; // allow selecting the same file again later

  // One concise announcement for the entire selection, never one per file
  // — whether that selection was 1 file or 15.
  announceStatus(buildOpenSummary(opened.length, skipped.length, failed.length));

  render();
  if (opened.length > 0) {
    focusElement(el.documentSelect);
  } else {
    focusElement(el.openStatus);
  }
}

/**
 * Build the single completion announcement for an Open Audio operation,
 * e.g. "10 audio files opened." or "10 audio files opened. 5 unsupported
 * files skipped."
 */
function buildOpenSummary(openedCount, skippedCount, failedCount) {
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
  const active = docs.getActiveDocument();
  window.document.title = active ? active.title : "Audio Recording - AccessibleAudioStudio";

  updatePositionDisplay();
  updateSelectionDisplay();
  updateButtonStates(active);
}

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
  window.document.title = active ? active.title : "Audio Recording - AccessibleAudioStudio";
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


