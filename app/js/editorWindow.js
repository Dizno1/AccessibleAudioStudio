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
import { initShortcutService, registerAction, triggerAction } from "./shortcutService.js";
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
  // Playback ending on its own (reaching the end of the document,
  // selection, or preview range) is handled the same as an explicit
  // stop for landing purposes: if X (locate-and-land) was playing, the
  // playhead lands at the natural end position; if Space (audition) or
  // Preview Selection was playing, it does not move. `player.rangeEndSec`
  // is read directly here rather than via getPositionSec(), since by the
  // time this callback runs the player has already marked itself as not
  // playing, and getPositionSec() reports the range *start* in that case.
  player.onEnded = () => {
    if (playbackMode === "locate" && activeDoc) {
      setPlayhead(player.rangeEndSec);
    }
    playbackMode = null;
    updateTransportButtonLabels();
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

    playheadSlider: document.getElementById("playhead-slider"),
    timelineCanvas: document.getElementById("timeline-canvas"),

    setSelectionStartButton: document.getElementById("set-selection-start-button"),
    setSelectionEndButton: document.getElementById("set-selection-end-button"),

    auditionButton: document.getElementById("audition-button"),
    editorPlayPauseButton: document.getElementById("editor-play-pause-button"),
    editorPreviewButton: document.getElementById("editor-preview-selection-button"),

    saveAsForm: document.getElementById("save-as-form"),
    saveAsNameInput: document.getElementById("save-as-name-input"),
    saveAsFormatSelect: document.getElementById("save-as-format-select"),
    confirmSaveAsButton: document.getElementById("confirm-save-as-button"),
    cancelSaveAsButton: document.getElementById("cancel-save-as-button"),

    diagnosticsLastShortcut: document.getElementById("diagnostics-last-shortcut"),
  };
}

function bindEvents() {
  bindPlayheadSlider();
  bindTimelineClick();
  bindMenuEvents();

  // Keeps the visual timeline correctly sized and drawn as the window is
  // resized or the OS zoom/magnification level changes — directly
  // relevant to this app's low-vision/magnification requirements, since
  // the canvas's internal pixel buffer is matched to its rendered CSS
  // size at draw time (see drawTimeline), which only happens when
  // something explicitly triggers a redraw.
  window.addEventListener("resize", () => {
    if (activeDoc) drawTimeline();
  });

  el.setSelectionStartButton.addEventListener("click", handleSetSelectionStart);
  el.setSelectionEndButton.addEventListener("click", handleSetSelectionEnd);

  el.auditionButton.addEventListener("click", handleAuditionPlayback);
  el.editorPlayPauseButton.addEventListener("click", handleLocateAndLand);
  el.editorPreviewButton.addEventListener("click", handlePreviewSelection);

  el.confirmSaveAsButton.addEventListener("click", handleConfirmSaveAs);
  el.cancelSaveAsButton.addEventListener("click", closeSaveAsForm);
}

/**
 * Listens for clicks on this window's own native menu (0.2.7). Every
 * item's Rust-side id is the SAME action-name string
 * `registerShortcutActions()` already registered for the keyboard path
 * — `triggerAction` (shortcutService.js) is the one shared dispatch
 * point both paths call into, so a menu click never runs a second,
 * separately-maintained copy of a command's logic. "Save"/"Save As" are
 * the one exception worth naming: they have no dedicated permanent
 * button anymore (see the correction directive — "do not devote an
 * entire permanent region to two conventional file commands"), so the
 * menu, Ctrl+S/Ctrl+Shift+S, and this listener are now their only
 * trigger paths, which is exactly the intended reduction.
 */
function bindMenuEvents() {
  if (!isRunningInTauri()) return;
  const { listen } = window.__TAURI__.event;

  listen("menu-action", (event) => {
    const id = event.payload;
    if (id === "showKeyboardShortcuts" || id === "showShortcutDiagnostics") {
      const wantedSummary = id === "showKeyboardShortcuts" ? "Keyboard Shortcuts" : "Keyboard Shortcut Diagnostics";
      const details = Array.from(document.querySelectorAll("footer details")).find((d) =>
        d.querySelector("summary")?.textContent.startsWith(wantedSummary)
      );
      if (details) {
        details.open = true;
        details.querySelector("summary")?.focus();
      }
      return;
    }
    triggerAction(id);
  });

  listen("menu-action-unavailable", (event) => {
    if (event.payload === "goToPrimaryEditor") {
      announceAlert("No Primary Editor is currently set. Use Make This Editor Primary on another editor window first.");
    }
  });

  listen("primary-editor-changed", (event) => {
    if (event.payload === (window.__TAURI__.window ? window.__TAURI__.window.getCurrentWindow().label : null)) {
      announceStatus("This editor is now the Primary Editor.");
    }
  });
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

  // Stage 1: playhead navigation and audible scrubbing (see docs/Pro Roadmap.md).
  registerAction("navBack10", () => {
    if (!activeDoc) return { executed: false, reason: "No audio document is open." };
    handleNavigate(-10);
    return { executed: true, resultText: "Moved playhead back 10 seconds" };
  });
  registerAction("navForward10", () => {
    if (!activeDoc) return { executed: false, reason: "No audio document is open." };
    handleNavigate(10);
    return { executed: true, resultText: "Moved playhead forward 10 seconds" };
  });
  registerAction("navBack30", () => {
    if (!activeDoc) return { executed: false, reason: "No audio document is open." };
    handleNavigate(-30);
    return { executed: true, resultText: "Moved playhead back 30 seconds" };
  });
  registerAction("navForward30", () => {
    if (!activeDoc) return { executed: false, reason: "No audio document is open." };
    handleNavigate(30);
    return { executed: true, resultText: "Moved playhead forward 30 seconds" };
  });
  registerAction("jumpBeginning", () => {
    if (!activeDoc) return { executed: false, reason: "No audio document is open." };
    handleJump(0);
    return { executed: true, resultText: "Jumped to beginning" };
  });
  registerAction("jumpEnd", () => {
    if (!activeDoc) return { executed: false, reason: "No audio document is open." };
    handleJump(activeDoc.durationSec);
    return { executed: true, resultText: "Jumped to end" };
  });
  registerAction("scrubBack1", () => {
    if (!activeDoc) return { executed: false, reason: "No audio document is open." };
    handleScrub(-1);
    return { executed: true, resultText: "Scrubbed back 1 second" };
  });
  registerAction("scrubForward1", () => {
    if (!activeDoc) return { executed: false, reason: "No audio document is open." };
    handleScrub(1);
    return { executed: true, resultText: "Scrubbed forward 1 second" };
  });
  registerAction("scrubBack100ms", () => {
    if (!activeDoc) return { executed: false, reason: "No audio document is open." };
    handleScrub(-0.1);
    return { executed: true, resultText: "Scrubbed back 100 milliseconds" };
  });
  registerAction("scrubForward100ms", () => {
    if (!activeDoc) return { executed: false, reason: "No audio document is open." };
    handleScrub(0.1);
    return { executed: true, resultText: "Scrubbed forward 100 milliseconds" };
  });
  registerAction("scrubBack10ms", () => {
    if (!activeDoc) return { executed: false, reason: "No audio document is open." };
    handleScrub(-0.01);
    return { executed: true, resultText: "Scrubbed back 10 milliseconds" };
  });
  registerAction("scrubForward10ms", () => {
    if (!activeDoc) return { executed: false, reason: "No audio document is open." };
    handleScrub(0.01);
    return { executed: true, resultText: "Scrubbed forward 10 milliseconds" };
  });
  registerAction("auditionPlayback", () => {
    if (!activeDoc) return { executed: false, reason: "No audio document is open." };
    handleAuditionPlayback();
    return { executed: true, resultText: "Audition" };
  });
  registerAction("locateAndLand", () => {
    if (!activeDoc) return { executed: false, reason: "No audio document is open." };
    handleLocateAndLand();
    return { executed: true, resultText: "Play and Land" };
  });
  registerAction("setMarkStart", () => {
    if (!activeDoc) return { executed: false, reason: "No audio document is open." };
    handleSetSelectionStart();
    return { executed: true, resultText: "Mark start set" };
  });
  registerAction("setMarkEnd", () => {
    if (!activeDoc) return { executed: false, reason: "No audio document is open." };
    handleSetSelectionEnd();
    return { executed: true, resultText: "Mark end set" };
  });

  // 0.2.7: menu-only actions (no dedicated keyboard shortcut of their own
  // yet) — registered here so the native menu's "one underlying command"
  // requirement holds for these too, via the same triggerAction() bridge.
  registerAction("deleteSelection", () => {
    if (!activeDoc) return { executed: false, reason: "No audio document is open." };
    handleDeleteSelection();
    return { executed: true, resultText: "Delete Selection" };
  });
  registerAction("selectAll", () => {
    if (!activeDoc) return { executed: false, reason: "No audio document is open." };
    handleSelectAll();
    return { executed: true, resultText: "Select All" };
  });
  registerAction("clearSelection", () => {
    if (!activeDoc) return { executed: false, reason: "No audio document is open." };
    handleClearSelection();
    return { executed: true, resultText: "Clear Selection" };
  });
  registerAction("announceSelection", () => {
    if (!activeDoc) return { executed: false, reason: "No audio document is open." };
    handleAnnounceSelection();
    return { executed: true, resultText: "Announce Selection" };
  });
  registerAction("trimToSelection", () => {
    if (!activeDoc) return { executed: false, reason: "No audio document is open." };
    handleTrim();
    return { executed: true, resultText: "Trim to Selection" };
  });
  registerAction("previewSelection", () => {
    if (!activeDoc) return { executed: false, reason: "No audio document is open." };
    handlePreviewSelection();
    return { executed: true, resultText: "Preview Selection" };
  });
  registerAction("announcePosition", () => {
    if (!activeDoc) return { executed: false, reason: "No audio document is open." };
    handleAnnouncePosition();
    return { executed: true, resultText: "Announce Current Position" };
  });
}

// ---------------------------------------------------------------------
// The authoritative playhead (0.2.5, Pro Roadmap)
//
// ONE AUDIO DOCUMENT → ONE TIMELINE → ONE AUTHORITATIVE EDITING PLAYHEAD
// → MULTIPLE EQUIVALENT WAYS TO OPERATE IT.
//
// setPlayhead() is the only place activeDoc.cursorSec is ever assigned
// from this point on in this file — every navigation button, the
// playhead slider, the visual timeline's click-to-seek, X's landing
// behavior, and Mark placement all funnel through it, so none of those
// interfaces can ever drift out of sync with each other. It does not
// itself announce anything; callers keep their own, already-existing,
// context-specific announcements (see the 0.1.x baseline this format
// carries over from) — this stays purely about state and visual sync,
// not speech, so nothing here changes what JAWS already announces
// correctly per the 0.2.3/0.2.4 real-world test.
//
// Live playback position (while X or Space audition is actually
// playing) is a DIFFERENT, separate, continuously-changing value —
// player.getPositionSec() — that the slider and timeline visually track
// via startPlaybackTicker() below for sighted/low-vision feedback, but
// which never itself writes to activeDoc.cursorSec. Only X's own
// landing logic (stopActivePlayback) calls setPlayhead when playback
// actually stops — this is the concrete implementation of "playback may
// have a continuously changing cursor, but that is not automatically
// the authoritative editing playhead."
// ---------------------------------------------------------------------

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function setPlayhead(newSec) {
  if (!activeDoc) return;
  activeDoc.cursorSec = clamp(newSec, 0, activeDoc.durationSec);
  syncPlayheadUI();
}

/** Keeps the slider's value/accessible text and the visual timeline in sync with the authoritative playhead. Called by setPlayhead() and after any edit that could change duration/selection. */
function syncPlayheadUI() {
  if (!activeDoc) return;
  if (el.playheadSlider) {
    el.playheadSlider.max = String(activeDoc.durationSec);
    el.playheadSlider.value = String(activeDoc.cursorSec);
    // aria-valuetext, not the raw numeric value, is what a screen reader
    // announces for this slider — this is what turns "50.4" into
    // "50.400 seconds" using the same formatter already confirmed
    // correct in real JAWS testing. Deliberately only updated here (a
    // real editing-position change), never from the live playback
    // ticker below, so continuous playback doesn't turn into continuous
    // announcements.
    el.playheadSlider.setAttribute("aria-valuetext", formatTimePrecise(activeDoc.cursorSec));
  }
  updatePositionDisplay();
  drawTimeline();
}

/**
 * The playhead slider is a real, native <input type="range"> specifically
 * so Left/Right/Home/End are the browser's own guaranteed keyboard input
 * path while it holds focus — not competing with Windows' own
 * accessibility/focus-traversal layer for arrow keys the way a global
 * bare-key listener does (see docs/Pro Roadmap.md, 0.2.5, for why the
 * 0.2.3/0.2.4 global-interception approach didn't reliably work). The
 * native default step (0.01s, matching the finest scrub precision) is
 * overridden here with the specified 10s/30s/beginning/end behavior;
 * every other native key (Up/Down/PageUp/PageDown) is left alone and
 * still moves the same authoritative playhead via the `input` listener.
 */
function bindPlayheadSlider() {
  if (!el.playheadSlider) return;

  el.playheadSlider.addEventListener("keydown", (event) => {
    if (!activeDoc) return;
    switch (event.key) {
      case "ArrowLeft":
        event.preventDefault();
        setPlayhead(activeDoc.cursorSec - (event.ctrlKey ? 30 : 10));
        break;
      case "ArrowRight":
        event.preventDefault();
        setPlayhead(activeDoc.cursorSec + (event.ctrlKey ? 30 : 10));
        break;
      case "Home":
        event.preventDefault();
        setPlayhead(0);
        break;
      case "End":
        event.preventDefault();
        setPlayhead(activeDoc.durationSec);
        break;
      default:
        break; // native default handling (Up/Down/PageUp/PageDown/etc.)
    }
  });

  // Mouse drag, and any native key left un-overridden above, changes the
  // slider's own DOM value directly; this syncs that back into the one
  // authoritative playhead the same way every other interaction does.
  el.playheadSlider.addEventListener("input", () => {
    if (!activeDoc) return;
    setPlayhead(parseFloat(el.playheadSlider.value));
  });
}

/**
 * A sighted user clicking anywhere on the visual timeline moves the same
 * authoritative playhead a keyboard/screen-reader user moves via the
 * slider — "there is no separate mouse position state," per the Pro
 * Roadmap. The click position is converted to a fraction of the
 * timeline's actual rendered width, then to seconds, independent of the
 * canvas's internal pixel buffer size (see drawTimeline for why those
 * can differ).
 */
function bindTimelineClick() {
  if (!el.timelineCanvas) return;
  el.timelineCanvas.addEventListener("click", (event) => {
    if (!activeDoc) return;
    const rect = el.timelineCanvas.getBoundingClientRect();
    if (rect.width <= 0) return;
    const fraction = clamp((event.clientX - rect.left) / rect.width, 0, 1);
    setPlayhead(fraction * activeDoc.durationSec);
    announceStatus(formatTimePrecise(activeDoc.cursorSec));
  });
}

/**
 * Draws the visual timeline: the document track, the selected interval
 * (if any), Marks, and the playhead — all using the same seconds-to-
 * pixels coordinate mapping the future waveform would use. Every state
 * that isn't the plain track background is distinguished by shape or
 * outline as well as color (a diamond-topped line for the playhead, a
 * triangular flag for each Mark, an outlined-and-shaded region for the
 * selected interval), per this app's "never color alone" requirement.
 *
 * `overridePlayheadSec`, when given, draws the playhead at that position
 * instead of activeDoc.cursorSec — used only by the live playback
 * ticker below, so a moving playback position can be shown visually
 * without it ever becoming the authoritative editing playhead.
 */
function drawTimeline(overridePlayheadSec) {
  const canvas = el.timelineCanvas;
  if (!canvas || !activeDoc) return;
  const ctx = canvas.getContext("2d");
  if (!ctx) return;

  // Match the canvas's internal pixel buffer to its actual rendered CSS
  // size so drawing stays crisp at whatever width this app's responsive
  // layout gives it, and so this math always agrees with the click
  // handler's fraction-of-rendered-width math above.
  const cssWidth = Math.max(1, Math.round(canvas.clientWidth || canvas.width));
  const cssHeight = Math.max(1, Math.round(canvas.clientHeight || canvas.height));
  if (canvas.width !== cssWidth) canvas.width = cssWidth;
  if (canvas.height !== cssHeight) canvas.height = cssHeight;

  const width = canvas.width;
  const height = canvas.height;
  const duration = Math.max(activeDoc.durationSec, 0.001); // avoid divide-by-zero for a brand-new empty document

  ctx.clearRect(0, 0, width, height);

  const trackTop = height * 0.35;
  const trackHeight = height * 0.3;
  const secToX = (sec) => (clamp(sec, 0, duration) / duration) * width;

  ctx.fillStyle = "#E7EEE9";
  ctx.fillRect(0, trackTop, width, trackHeight);
  ctx.strokeStyle = "#6E7B82"; // --color-border
  ctx.lineWidth = 1;
  ctx.strokeRect(0.5, trackTop + 0.5, width - 1, trackHeight - 1);

  // Selected interval — shaded fill AND an outline, not color alone.
  // Note (see docs/Pro Roadmap.md, 0.2.5): the current selection model
  // (AudioDocument.selection) only ever holds a complete {startSec,
  // endSec} pair or null — there is no distinct "only the first Mark
  // has been placed yet" state to draw a single boundary marker for
  // without changing that data model, which this stage deliberately
  // does not do. Both boundaries are always drawn together, faithfully
  // reflecting what the underlying state actually is.
  if (activeDoc.hasSelection()) {
    const startX = secToX(activeDoc.selection.startSec);
    const endX = secToX(activeDoc.selection.endSec);
    ctx.fillStyle = "rgba(11, 93, 59, 0.25)";
    ctx.fillRect(startX, trackTop, Math.max(1, endX - startX), trackHeight);
    ctx.strokeStyle = "#0B5D3B"; // --color-accent
    ctx.lineWidth = 2;
    ctx.strokeRect(startX, trackTop, Math.max(1, endX - startX), trackHeight);

    // Marks: triangular flags — shape-distinct from the diamond-topped
    // playhead line drawn below, not just a different color.
    ctx.fillStyle = "#8A5A00"; // --color-focus
    [startX, endX].forEach((x) => {
      ctx.beginPath();
      ctx.moveTo(x, trackTop - 2);
      ctx.lineTo(x - 6, trackTop - 12);
      ctx.lineTo(x + 6, trackTop - 12);
      ctx.closePath();
      ctx.fill();
    });
  }

  const playheadSec = overridePlayheadSec !== undefined ? overridePlayheadSec : activeDoc.cursorSec;
  const playheadX = secToX(playheadSec);
  ctx.strokeStyle = "#0B5D3B";
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(playheadX, 4);
  ctx.lineTo(playheadX, height - 4);
  ctx.stroke();
  ctx.fillStyle = "#0B5D3B";
  ctx.beginPath();
  ctx.moveTo(playheadX, 4);
  ctx.lineTo(playheadX - 5, 13);
  ctx.lineTo(playheadX + 5, 13);
  ctx.closePath();
  ctx.fill();
}

let playbackTickerId = null;

/** While X or Space audition is actually playing, visually tracks the live, continuously-changing playback position on the slider thumb and timeline — WITHOUT writing to activeDoc.cursorSec. See the section doc comment above for why that distinction matters. */
function startPlaybackTicker() {
  if (playbackTickerId !== null) return;
  const tick = () => {
    if (!player.isPlaying() || !activeDoc) {
      playbackTickerId = null;
      syncPlayheadUI(); // restore the true authoritative playhead's display once playback has stopped
      return;
    }
    const liveSec = player.getPositionSec();
    if (el.playheadSlider) el.playheadSlider.value = String(liveSec);
    drawTimeline(liveSec);
    playbackTickerId = requestAnimationFrame(tick);
  };
  playbackTickerId = requestAnimationFrame(tick);
}

// ---------------------------------------------------------------------
// Navigation
// ---------------------------------------------------------------------

function handleNavigate(deltaSec) {
  if (!activeDoc) return;
  setPlayhead(activeDoc.cursorSec + deltaSec);
  announceStatus(formatTimePrecise(activeDoc.cursorSec));
}

function handleJump(toSec) {
  if (!activeDoc) return;
  setPlayhead(toSec);
  announceStatus(formatTimePrecise(activeDoc.cursorSec));
}

function handleAnnouncePosition() {
  if (!activeDoc) return;
  announceStatus(formatTimePrecise(activeDoc.cursorSec));
}

/**
 * Moves the playhead by `deltaSec` and immediately plays a short clip
 * starting at the new position — the audible-scrubbing behavior itself.
 * See BufferPlayer.scrubClip for why a short real-audio clip, not a
 * silent jump, is what "audible" means here.
 */
function handleScrub(deltaSec) {
  if (!activeDoc) return;
  setPlayhead(activeDoc.cursorSec + deltaSec);
  player.scrubClip(activeDoc.buffer, activeDoc.cursorSec);
  announceStatus(formatTimePrecise(activeDoc.cursorSec));
}

// ---------------------------------------------------------------------
// Selection
// ---------------------------------------------------------------------

function handleSetSelectionStart() {
  if (!activeDoc) return;
  activeDoc.setSelectionStart(activeDoc.cursorSec);
  updateSelectionDisplay();
  drawTimeline();
  announceStatus(`Selection start set. ${formatTimePrecise(activeDoc.selection.startSec)}.`);
}

function handleSetSelectionEnd() {
  if (!activeDoc) return;
  activeDoc.setSelectionEnd(activeDoc.cursorSec);
  updateSelectionDisplay();
  drawTimeline();
  announceStatus(`Selection end set. ${formatTimePrecise(activeDoc.selection.endSec)}.`);
}

function handleSelectAll() {
  if (!activeDoc) return;
  activeDoc.selectAll();
  updateSelectionDisplay();
  drawTimeline();
  announceStatus(`All selected. ${formatTimePrecise(activeDoc.selectionDurationSec())} selected.`);
}

function handleClearSelection() {
  if (!activeDoc) return;
  activeDoc.clearSelection();
  updateSelectionDisplay();
  drawTimeline();
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
// Playback: SPACE (audition) and X (locate-and-land) are deliberately
// different commands, not one generic Play/Pause — see the Pro Roadmap,
// Stage 1, "Edit Position and Playback Position." Both start playback
// from the current playhead; they differ only in what happens to the
// playhead when playback stops:
//   - SPACE (audition): stopping never moves the playhead. Repeated
//     Space lets the user audition from the same established editing
//     context as many times as needed.
//   - X (locate and land): stopping — by pressing X again, or by
//     playback reaching the end on its own — moves the playhead to
//     exactly where it stopped. This is what lets a user listen until
//     roughly the right spot, land there with X, then use U/I scrubbing
//     to find the exact boundary.
// `playbackMode` tracks which of the two is currently playing, since
// both share the same underlying BufferPlayer session.
// ---------------------------------------------------------------------

let playbackMode = null; // "audition" | "locate" | null

function updateTransportButtonLabels() {
  el.auditionButton.textContent = playbackMode === "audition" ? "Stop Audition (Space)" : "Audition (Space)";
  el.editorPlayPauseButton.textContent = playbackMode === "locate" ? "Stop and Land (X)" : "Play and Land (X)";
}

/** Stops whatever is currently playing (Space or X). `landPlayhead` controls whether the playhead moves to the stop position — the one behavioral difference between the two commands. */
function stopActivePlayback({ landPlayhead }) {
  if (!player.isPlaying()) return;
  const stoppedAtSec = player.getPositionSec();
  player.stop();
  if (landPlayhead && activeDoc) {
    setPlayhead(stoppedAtSec);
  } else {
    syncPlayheadUI(); // restore slider/timeline to the (unchanged) authoritative playhead after a non-landing stop
  }
  playbackMode = null;
  updateTransportButtonLabels();
}

function handleAuditionPlayback() {
  if (!activeDoc) return;

  if (player.isPlaying() && playbackMode === "audition") {
    stopActivePlayback({ landPlayhead: false });
    announceStatus("Audition stopped.");
    return;
  }
  if (player.isPlaying()) {
    // X was playing — stop it without landing, since the user's next
    // action (starting Space) supersedes it, then start audition fresh.
    stopActivePlayback({ landPlayhead: false });
  }

  player.play(activeDoc.buffer, activeDoc.cursorSec, activeDoc.durationSec);
  playbackMode = "audition";
  updateTransportButtonLabels();
  startPlaybackTicker();
  announceStatus("Auditioning.");
}

function handleLocateAndLand() {
  if (!activeDoc) return;

  if (player.isPlaying() && playbackMode === "locate") {
    stopActivePlayback({ landPlayhead: true });
    announceStatus(`Landed at ${formatTimePrecise(activeDoc.cursorSec)}.`);
    return;
  }
  if (player.isPlaying()) {
    // Space was playing — stop it without landing (that's Space's own
    // rule, not X's), then start Play and Land fresh.
    stopActivePlayback({ landPlayhead: false });
  }

  player.play(activeDoc.buffer, activeDoc.cursorSec, activeDoc.durationSec);
  playbackMode = "locate";
  updateTransportButtonLabels();
  startPlaybackTicker();
  announceStatus("Playing.");
}

function handlePreviewSelection() {
  if (!activeDoc) return;
  if (!activeDoc.hasSelection()) {
    announceAlert("There is no selection to preview.");
    return;
  }
  player.play(activeDoc.buffer, activeDoc.selection.startSec, activeDoc.selection.endSec);
  playbackMode = null; // preview lands neither Space nor X semantics; it's its own, separate action
  el.editorPreviewButton.textContent = "Stop Preview";
  startPlaybackTicker();
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
    setPlayhead(insertAt + reconciled.length / reconciled.sampleRate);

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
  setPlayhead(startSec);

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
  setPlayhead(0);

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
  playbackMode = null;
  updateTransportButtonLabels();
  el.editorPreviewButton.textContent = "Preview Selection";
  updateWindowTitle(); // title's "(unsaved changes)" marker is the only per-document status surface now
  updateSelectionDisplay();
  updateButtonStates();
  syncPlayheadUI(); // an edit can change duration (delete/trim/paste), so the slider's max and the timeline both need to re-derive from the document's new state, not just the playhead position
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
  updateSelectionDisplay();
  updateButtonStates();
  syncPlayheadUI(); // sets the slider's max (document duration) for the first time and draws the initial timeline
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

  [el.setSelectionStartButton, el.auditionButton, el.editorPlayPauseButton, el.playheadSlider].forEach(
    (button) => (button.disabled = !has)
  );

  el.setSelectionEndButton.disabled = !has;
  el.editorPreviewButton.disabled = !hasSelection;

  // Note (0.2.7): the native menu's own items are not dynamically
  // enabled/disabled to match this same state — every menu action still
  // relies on its existing `if (!activeDoc) return { executed: false,
  // reason: ... }` guard (already present in every registerShortcutActions
  // handler) to no-op gracefully with a clear diagnostic reason rather
  // than crash or misbehave. Wiring live menu-item enabled state would
  // need a new Rust command JS could call to toggle a specific item,
  // which this build deliberately deferred — see docs/Pro Roadmap.md,
  // "Deferred by design."
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
