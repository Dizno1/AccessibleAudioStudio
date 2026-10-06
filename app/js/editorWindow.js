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
import { encodeWav, encodeMp3, encodeMp3Async, getAudioContext, decodeAudioFile } from "./audioCodec.js";
import { BufferPlayer } from "./audioBufferPlayer.js";
import * as clipboard from "./audioClipboard.js";
import { AudioDocument } from "./audioDocument.js";
import { initShortcutService, registerAction, triggerAction } from "./shortcutService.js";
import { onShortcutEvent, getLastShortcutEvent } from "./shortcutDiagnostics.js";
import { initAnnouncer } from "./announcer.js";

let el = {};
const player = new BufferPlayer();
let activeDoc = null;
let isPrimaryEditor = false;
let pendingPrimaryResolve = null;
let applicationShutdownRequested = false;
let documentLoadState = "loading";
let nativeDecodeRequested = false;
let editorInitializationStarted = false;
let activeSaveOperation = null;

function isRunningInTauri() {
  return typeof window !== "undefined" && !!window.__TAURI__;
}

// Persist file-open/decode diagnostics on the Rust side so the evidence survives
// a WebView freeze or Task Manager termination. Diagnostics are intentionally
// silent: they must never add screen-reader chatter or alter editor behavior.
async function recordLoadDiagnostic(event, details = "") {
  if (!isRunningInTauri()) return;
  try {
    await window.__TAURI__.core.invoke("append_audio_load_diagnostic", { event, details });
  } catch (_) {
    // Diagnostics must never be able to break document loading.
  }
}

function recordDecodeDiagnostic(event, details = "") {
  void recordLoadDiagnostic(event, details);
}

async function main() {
  if (editorInitializationStarted) {
    await recordLoadDiagnostic("editor-init-duplicate-blocked", "duplicate editor initialization ignored before source/decode request");
    return;
  }
  editorInitializationStarted = true;
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


async function audioBufferFromNativeDecode(nativeAudio, displayName) {
  const sampleRate = Number(nativeAudio.sample_rate);
  const channelCount = Number(nativeAudio.channels);
  const frameCount = Number(nativeAudio.frames);
  const cacheId = nativeAudio.cache_id;
  if (!sampleRate || !channelCount || !frameCount || !cacheId) {
    throw new Error("Native decoder returned incomplete audio metadata.");
  }

  const ctx = getAudioContext();
  let buffer;
  try {
    buffer = ctx.createBuffer(channelCount, frameCount, sampleRate);
  } catch (error) {
    throw new Error(`Could not allocate the audio document in the editor: ${error?.message || error}`);
  }

  // Pull bounded chunks from the native PCM cache. This avoids serializing a
  // 46-minute document as one enormous base64 IPC response, which previously
  // crashed WebView2 with STATUS_BREAKPOINT. The percentage below is genuine:
  // it is based on PCM frames actually copied into the editor AudioBuffer.
  const { invoke } = window.__TAURI__.core;
  const chunkFrames = 1_048_576;
  const totalWork = frameCount * channelCount;
  let completedWork = 0;
  let lastAnnouncedPercent = -10;

  for (let channelIndex = 0; channelIndex < channelCount; channelIndex += 1) {
    for (let startFrame = 0; startFrame < frameCount; startFrame += chunkFrames) {
      const requested = Math.min(chunkFrames, frameCount - startFrame);
      const chunk = await invoke("read_native_pcm_chunk", {
        cacheId,
        channelIndex,
        startFrame,
        frameCount: requested,
      });
      const returnedFrames = Number(chunk.frames);
      if (returnedFrames !== requested) {
        throw new Error(`Native PCM cache returned ${returnedFrames} frames when ${requested} were requested.`);
      }
      const binary = atob(chunk.f32_le_base64 || "");
      if (binary.length !== returnedFrames * 4) {
        throw new Error("Native PCM cache returned an incomplete audio chunk.");
      }
      const bytes = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
      buffer.copyToChannel(new Float32Array(bytes.buffer), channelIndex, startFrame);
      completedWork += returnedFrames;

      const percent = Math.floor((completedWork / totalWork) * 100);
      const milestone = Math.floor(percent / 10) * 10;
      if (milestone >= lastAnnouncedPercent + 10 && milestone > 0 && milestone < 100) {
        lastAnnouncedPercent = milestone;
        const message = `Preparing ${displayName}. ${milestone} percent.`;
        setDocumentLoadState("loading", message);
        announceStatus(message);
        await recordLoadDiagnostic("pcm-transfer-progress", `percent=${milestone} frames_copied=${completedWork} total_frames=${totalWork}`);
      }
    }
  }
  return buffer;
}

function setDocumentLoadState(state, message) {
  documentLoadState = state;
  if (el.loadingStatus) {
    el.loadingStatus.hidden = state === "ready";
    el.loadingStatus.textContent = message || "";
  }
  if (state !== "ready") updateButtonStates();
}

function announceLoading(message) {
  setDocumentLoadState("loading", message);
  announceStatus(message);
}

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
    await recordLoadDiagnostic("editor-init-request", "requesting pending editor source");
    const initStarted = performance.now();
    const info = await invoke("get_editor_init_info");
    const transferredBytes = info && info.data ? info.data.length : 0;
    await recordLoadDiagnostic(
      "editor-init-received",
      `kind=${info.kind} name=${info.name || ""} transferred_bytes=${transferredBytes} elapsed_ms=${Math.round(performance.now() - initStarted)}`
    );
    // info: { kind: "file" | "new", name, path, data }
    if (info.kind === "file") {
      announceLoading(`Loading ${info.name}. Please wait.`);
      await recordLoadDiagnostic("loading-state", `state=loading name=${info.name}`);
    }

    if (info.kind === "new") {
      const displayNumber = Number(String(info.name || "").replace(/^Untitled Audio\s+/, "")) || null;
      activeDoc = new AudioDocument({
        buffer: bufUtil.createEmptyBuffer(44100, 2),
        baseName: null,
        sourceExtension: "wav",
        isNew: true,
        displayNumber,
        documentId: window.__TAURI__.window.getCurrentWindow().label,
      });
    } else {
      let buffer;
      if (info.decoder === "native-mp3") {
        if (nativeDecodeRequested) throw new Error("This editor already requested its native MP3 decode.");
        nativeDecodeRequested = true;
        announceLoading(`Decoding ${info.name}. Please wait.`);
        await recordLoadDiagnostic(
          "native-decode-request",
          `name=${info.name} source_path=${info.path || ""}`
        );
        const nativeStarted = performance.now();
        const nativeAudio = await invoke("native_decode_audio", { path: info.path });
        await recordLoadDiagnostic(
          "native-decode-received",
          `elapsed_ms=${Math.round(performance.now() - nativeStarted)} duration_sec=${nativeAudio.duration_sec} channels=${nativeAudio.channels} sample_rate=${nativeAudio.sample_rate} frames=${nativeAudio.frames}`
        );
        announceLoading(`Preparing ${info.name}. Please wait.`);
        buffer = await audioBufferFromNativeDecode(nativeAudio, info.name);
        await recordLoadDiagnostic(
          "native-buffer-created",
          `duration_sec=${buffer.duration} channels=${buffer.numberOfChannels} sample_rate=${buffer.sampleRate} frames=${buffer.length}`
        );
      } else {
        const file = new File([new Uint8Array(info.data)], info.name);
        await recordLoadDiagnostic(
          "file-object-created",
          `name=${info.name} file_bytes=${file.size} source_path=${info.path || ""}`
        );
        buffer = await decodeAudioFile(file, recordDecodeDiagnostic);
      }
      const extension = (info.name.split(".").pop() || "wav").toLowerCase();
      activeDoc = new AudioDocument({
        buffer,
        baseName: info.name,
        sourceExtension: extension,
        sourceKey: info.path || info.name,
        documentId: window.__TAURI__.window.getCurrentWindow().label,
      });
    }

    documentLoadState = "ready";
    if (el.loadingStatus) el.loadingStatus.hidden = true;
    // Only consume the registered source after the document is genuinely ready.
    // A WebView reload during loading can therefore retry instead of becoming an
    // orphaned editor with "no registered source".
    try { await invoke("acknowledge_editor_source_loaded"); } catch (_) {}
    if (info.decoder === "native-mp3") {
      try { await invoke("release_native_pcm_cache"); } catch (_) {}
    }
    await recordLoadDiagnostic(
      "editor-ready",
      activeDoc && activeDoc.buffer
        ? `duration_sec=${activeDoc.buffer.duration} channels=${activeDoc.buffer.numberOfChannels} sample_rate=${activeDoc.buffer.sampleRate}`
        : "document initialized without audio buffer metadata"
    );
    finishLoadingDocument();
  } catch (err) {
    documentLoadState = "failed";
    setDocumentLoadState("failed", "Audio document could not be opened.");
    await recordLoadDiagnostic(
      "editor-open-failed",
      `error=${err && err.message ? err.message : String(err)}`
    );
    el.documentHeading.textContent = "This document could not be opened";
    announceAlert(
      "This audio document could not be opened. " + (err && err.message ? err.message : String(err))
    );
  }
}

async function finishLoadingDocument() {
  // The Rust/Recording Studio controller is authoritative. A newly opened
  // detail window first asks the master who is Primary, then publishes its
  // document facts upward. Merely visiting a window can never change Primary.
  if (isRunningInTauri()) {
    try {
      const info = await window.__TAURI__.core.invoke("get_primary_editor_info");
      isPrimaryEditor = info.label === window.__TAURI__.window.getCurrentWindow().label;
    } catch (_) { isPrimaryEditor = false; }
  }
  await updateWindowTitle();
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
    const baseTitle = activeDoc.title;
    const primaryTitle = baseTitle.endsWith(" - AccessibleAudioStudio Pro")
      ? baseTitle.replace(" - AccessibleAudioStudio Pro", " - Primary Editor - AccessibleAudioStudio Pro")
      : `${baseTitle} - Primary Editor`;
    await getCurrentWindow().setTitle(isPrimaryEditor ? primaryTitle : baseTitle);
    await publishDocumentState();
  } catch (err) {
    // A window-title update failing is not worth interrupting the user
    // over — the in-page heading (updated separately, see render()) still
    // carries the same information for anyone reading the page itself.
  }
}

async function publishDocumentState() {
  if (!isRunningInTauri() || !activeDoc) return;
  try {
    await window.__TAURI__.core.invoke("register_document_state", {
      documentId: activeDoc.id,
      displayName: activeDoc.baseName || `Untitled Audio ${activeDoc._displayNumber || ""}`.trim(),
      path: activeDoc.sourceKey || null,
      dirty: !!activeDoc.dirty,
      isNew: !!activeDoc.isNew,
    });
  } catch (_) {
    // The OS title remains a useful fallback surface, but application-level
    // decisions never infer dirty/Primary state from it in the master model.
  }
}

// ---------------------------------------------------------------------
// Elements & events
// ---------------------------------------------------------------------

function cacheElements() {
  el = {
    documentHeading: document.getElementById("document-heading"),
    positionInfo: document.getElementById("position-info"),
    loadingStatus: document.getElementById("loading-status"),
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

    unsavedCloseDialog: document.getElementById("unsaved-close-dialog"),
    unsavedCloseMessage: document.getElementById("unsaved-close-message"),
    closeSaveButton: document.getElementById("close-save-button"),
    closeDiscardButton: document.getElementById("close-discard-button"),
    closeCancelButton: document.getElementById("close-cancel-button"),

    primaryEditorDialog: document.getElementById("primary-editor-dialog"),
    primaryEditorDialogMessage: document.getElementById("primary-editor-dialog-message"),
    confirmPrimaryEditorButton: document.getElementById("confirm-primary-editor-button"),
    cancelPrimaryEditorButton: document.getElementById("cancel-primary-editor-button"),

    diagnosticsLastShortcut: document.getElementById("diagnostics-last-shortcut"),
  };
}

function bindEvents() {
  bindPlayheadSlider();
  bindTimelineClick();
  bindMenuEvents();

  // Once the native Save As dialog has closed, Escape cancels the actual
  // encode/write operation. This is deliberately a capture listener so the
  // command works with Virtual PC Cursor either on or off and regardless of
  // which editor control currently has focus.
  window.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && activeSaveOperation) {
      event.preventDefault();
      event.stopPropagation();
      activeSaveOperation.abort();
    }
  }, true);

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
  el.saveAsNameInput.addEventListener("keydown", (event) => {
    if (event.key === "Enter" && !event.ctrlKey && !event.altKey && !event.metaKey) {
      event.preventDefault();
      handleConfirmSaveAs();
    }
  });

  el.closeSaveButton.addEventListener("click", handleCloseWithSave);
  el.closeDiscardButton.addEventListener("click", () => {
    if (applicationShutdownRequested) approveApplicationShutdownEditor();
    else closeEditorAfterDecision(false);
  });
  el.closeCancelButton.addEventListener("click", cancelUnsavedClose);
  el.unsavedCloseDialog.addEventListener("cancel", (event) => {
    event.preventDefault();
    cancelUnsavedClose();
  });

  el.confirmPrimaryEditorButton.addEventListener("click", () => finishPrimaryConfirmation(true));
  el.cancelPrimaryEditorButton.addEventListener("click", () => finishPrimaryConfirmation(false));
  el.primaryEditorDialog.addEventListener("cancel", (event) => {
    event.preventDefault();
    finishPrimaryConfirmation(false);
  });

  bindWindowCloseProtection();
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

  // Every listen() below passes { target: currentLabel }. Without it, Tauri's
  // own JS client defaults a listener's target to { kind: "Any" } -- and, per
  // Tauri's own event-matching logic (listeners.rs: a target of Any always
  // matches, regardless of what the emitter targeted), a plain, untargeted
  // listen() receives EVERY emit of that event name app-wide, including ones
  // Rust sent via emit_to() to a completely different window. Rust-side
  // emit_to() scopes the SEND; this scopes the RECEIVE -- both are required,
  // and this was the missing half: every open editor's identical, unscoped
  // "menu-action" listener was still firing for every other editor's menu
  // clicks (most visibly, "Make This Editor Primary"), independent of which
  // window Rust actually emitted to. See docs/Pro Roadmap.md, "Primary
  // Editor architecture," 0.2.9 entry.
  const currentLabel = window.__TAURI__.window.getCurrentWindow().label;

  // Use a unique event name per native window. This avoids depending on
  // Tauri receive-side target filtering and keeps menu ownership stable even
  // while editor windows are created and destroyed.
  listen(`menu-action:${currentLabel}`, async (event) => {
    const id = event.payload;
    if (id === "makePrimaryEditor") {
      await requestMakePrimaryEditor();
      return;
    }
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
    if (id === "goToPrimaryEditor") {
      await goToPrimaryEditor();
      return;
    }
    await triggerAction(id);
  });

  listen("menu-action-unavailable", (event) => {
    if (event.payload === "goToPrimaryEditor") {
      announceAlert("No Primary Editor is currently set. Use Make This Editor Primary on another editor window first.");
    }
  });

  listen("primary-editor-state-changed", async (event) => {
    isPrimaryEditor = event.payload === currentLabel;
    await updateWindowTitle();
  });

  // Application shutdown is deliberately serialized. Rust asks one editor at
  // a time to resolve its document; only after that editor closes does the
  // next editor receive this event. This prevents a pile of simultaneous Save
  // dialogs and gives Cancel the same meaning it has in desktop editors.
  listen("application-close-requested", async () => {
    applicationShutdownRequested = true;
    if (!activeDoc || !activeDoc.dirty) {
      await approveApplicationShutdownEditor();
      return;
    }

    // Save and Quit was already chosen in the Recording Studio. The editor
    // must now produce an explicit successful save result before shutdown can
    // advance. Untitled documents use the native Windows Save As dialog owned
    // by the Recording Studio, so no background editor has to steal focus.
    const saved = activeDoc.isNew ? await handleNativeSaveAs() : await handleSave();
    if (!saved || activeDoc.dirty) {
      applicationShutdownRequested = false;
      try { await window.__TAURI__.core.invoke("cancel_application_shutdown"); } catch (_) {}
      announceAlert("Quit canceled because this document could not be saved.");
    }
  });
}

// Guards against a single conceptual activation of "Make This Editor
// Primary" reaching this function more than once. Native menu clicks can
// be re-delivered by assistive technology, so only one transfer request may
// be in flight at a time.
let primaryRequestInFlight = false;

async function requestMakePrimaryEditor() {
  if (!isRunningInTauri() || !activeDoc) return;
  if (primaryRequestInFlight) return;
  primaryRequestInFlight = true;
  try {
    const { invoke } = window.__TAURI__.core;
    const currentWindow = window.__TAURI__.window.getCurrentWindow();
    const info = await invoke("get_primary_editor_info");

    if (info.label === currentWindow.label) {
      announceStatus("This editor is already the Primary Editor.");
      return;
    }

    if (info.label) {
      const currentName = (info.title || "the current Primary Editor")
        .replace(" - Primary Editor - AccessibleAudioStudio Pro", "")
        .replace(" - AccessibleAudioStudio Pro", "");
      const proposedName = activeDoc.baseName || activeDoc.title.replace(" - AccessibleAudioStudio Pro", "");
      const confirmed = await confirmPrimaryReassignment(proposedName, currentName);
      if (!confirmed) return;
    }

    await invoke("set_current_editor_primary");
    // Do not wait for a cross-window event to make this editor reflect the
    // authoritative result. The command was invoked by this exact window.
    isPrimaryEditor = true;
    await updateWindowTitle();
  } finally {
    primaryRequestInFlight = false;
  }
}

function confirmPrimaryReassignment(proposedName, currentName) {
  if (!el.primaryEditorDialog) return Promise.resolve(false);

  // Only one confirmation may exist in this editor at a time. Native menu
  // events can be re-announced or reactivated by assistive technology; a
  // second activation must focus the existing dialog, never create another
  // pending promise or leave a stale confirmation behind.
  if (el.primaryEditorDialog.open) {
    el.confirmPrimaryEditorButton?.focus();
    return Promise.resolve(false);
  }

  el.primaryEditorDialogMessage.textContent =
    `Make ${proposedName} the Primary Editor instead of ${currentName}?`;
  el.primaryEditorDialog.showModal();
  el.confirmPrimaryEditorButton.focus();
  return new Promise((resolve) => {
    pendingPrimaryResolve = resolve;
  });
}

function finishPrimaryConfirmation(confirmed) {
  if (!el.primaryEditorDialog?.open) return;
  el.primaryEditorDialog.close();
  const resolve = pendingPrimaryResolve;
  pendingPrimaryResolve = null;
  if (resolve) resolve(confirmed);
}

async function bindWindowCloseProtection() {
  if (!isRunningInTauri()) return;
  const currentWindow = window.__TAURI__.window.getCurrentWindow();
  await currentWindow.onCloseRequested((event) => {
    if (!activeDoc || !activeDoc.dirty) {
      // Even a clean Primary must release the shared role before closing.
      event.preventDefault();
      closeEditorAfterDecision(false);
      return;
    }
    event.preventDefault();
    const name = activeDoc.baseName || activeDoc.title.replace(" - AccessibleAudioStudio Pro", "");
    el.unsavedCloseMessage.textContent = `${name} has unsaved changes. Save before closing?`;
    if (!el.unsavedCloseDialog.open) el.unsavedCloseDialog.showModal();
    el.closeSaveButton.focus();
  });
}

async function cancelUnsavedClose() {
  if (el.unsavedCloseDialog?.open) el.unsavedCloseDialog.close();
  if (applicationShutdownRequested && isRunningInTauri()) {
    applicationShutdownRequested = false;
    try { await window.__TAURI__.core.invoke("cancel_application_shutdown"); } catch (_) {}
  }
  announceStatus("Close canceled. Your changes are still open.");
}

async function handleCloseWithSave() {
  if (!activeDoc) return;

  // A new document needs Save As. Close the modal first so the Save As
  // controls are actually reachable and focusable instead of sitting behind
  // an open modal dialog. The shutdown remains pending until Save As succeeds.
  if (activeDoc.isNew) {
    if (el.unsavedCloseDialog?.open) el.unsavedCloseDialog.close();
    openSaveAsForm();
    return;
  }

  const saved = await handleSave();
  if (!saved || activeDoc.dirty) {
    announceAlert("The document was not closed because it was not saved.");
    return;
  }
  if (applicationShutdownRequested) {
    await approveApplicationShutdownEditor();
  } else {
    await closeEditorAfterDecision(true);
  }
}

async function approveApplicationShutdownEditor() {
  if (!isRunningInTauri()) return;
  if (el.unsavedCloseDialog?.open) el.unsavedCloseDialog.close();
  applicationShutdownRequested = false;
  try {
    await window.__TAURI__.core.invoke("approve_application_shutdown_editor");
  } catch (err) {
    announceAlert("AccessibleAudioStudio Pro could not continue closing. " +
      (err && err.message ? err.message : String(err)));
  }
}

async function closeEditorAfterDecision(_saved) {
  if (!isRunningInTauri()) return;
  if (el.unsavedCloseDialog?.open) el.unsavedCloseDialog.close();
  try {
    // The native Rust command destroys the exact editor window that invoked it.
    // Do not call the frontend Window.close()/destroy() APIs here: this function
    // is reached from the close-request listener itself, and routing the approved
    // close back through that bridge is the failure mode that previously left
    // editor windows alive until the application was terminated.
    await window.__TAURI__.core.invoke("close_current_editor");
  } catch (err) {
    announceAlert(
      "The editor could not be closed. " + (err && err.message ? err.message : String(err))
    );
  }
}

async function goToPrimaryEditor() {
  if (!isRunningInTauri()) return false;
  try {
    // When invoked from a native menu, let Windows finish dismissing the
    // menu before moving focus. Otherwise the menu owner can reclaim
    // focus immediately after Rust focuses the Primary Editor.
    await new Promise((resolve) => setTimeout(resolve, 50));
    await window.__TAURI__.core.invoke("focus_primary_editor");
    return true;
  } catch (_) {
    return false;
  }
}

// Major VC-off work locations. Keep this registry small and functional: Ctrl+Page
// Up/Down jumps between work areas, while Tab/Shift+Tab moves among controls
// inside the current area. Future editor features (for example level monitors)
// join this registry instead of inventing another navigation scheme.
const EDITOR_LOCATIONS = [
  {
    name: "Timeline",
    getTarget: () => el.playheadSlider,
    containsFocus: () => document.activeElement === el.playheadSlider,
  },
  {
    name: "Marks and Selection",
    getTarget: () => el.setSelectionStartButton,
    containsFocus: () => [el.setSelectionStartButton, el.setSelectionEndButton].includes(document.activeElement),
  },
  {
    name: "Playback",
    getTarget: () => el.auditionButton,
    containsFocus: () => [el.auditionButton, el.editorPlayPauseButton, el.editorPreviewButton].includes(document.activeElement),
  },
];

function moveEditorLocation(direction) {
  const available = EDITOR_LOCATIONS.filter((location) => {
    const target = location.getTarget();
    return target && !target.disabled && !target.hidden;
  });
  if (!available.length) return false;

  const currentIndex = available.findIndex((location) => location.containsFocus());
  const base = currentIndex >= 0 ? currentIndex : (direction > 0 ? -1 : 0);
  const nextIndex = (base + direction + available.length) % available.length;
  const location = available[nextIndex];
  const target = location.getTarget();
  target.focus();
  announceStatus(`${location.name}.`);
  return true;
}

function registerShortcutActions() {
  registerAction("nextEditorLocation", () => ({
    executed: moveEditorLocation(1),
    resultText: "Next editor location",
  }));
  registerAction("previousEditorLocation", () => ({
    executed: moveEditorLocation(-1),
    resultText: "Previous editor location",
  }));

  registerAction("copySelection", async () => {
    if (!activeDoc || !activeDoc.hasSelection()) return { executed: false, reason: "There is no selection to copy." };
    await handleCopy();
    return { executed: true, resultText: "Copy completed" };
  });
  registerAction("cutSelection", async () => {
    if (!activeDoc || !activeDoc.hasSelection()) return { executed: false, reason: "There is no selection to cut." };
    await handleCut();
    return { executed: true, resultText: "Cut completed" };
  });
  registerAction("pasteSelection", async () => {
    if (!activeDoc) return { executed: false, reason: "No audio document is open." };
    await handlePaste();
    return { executed: true, resultText: "Paste completed" };
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
  registerAction("jumpBack5Minutes", () => {
    if (!activeDoc) return { executed: false, reason: "No audio document is open." };
    const base = player.isPlaying() ? player.getPositionSec() : activeDoc.cursorSec;
    seekPlaybackFromPlayhead(base - 300);
    announceStatus(`Rewind 5 minutes. ${formatTimePrecise(activeDoc.cursorSec)}.`);
    return { executed: true, resultText: "Rewound 5 minutes" };
  });
  registerAction("jumpForward5Minutes", () => {
    if (!activeDoc) return { executed: false, reason: "No audio document is open." };
    const base = player.isPlaying() ? player.getPositionSec() : activeDoc.cursorSec;
    seekPlaybackFromPlayhead(base + 300);
    announceStatus(`Fast forward 5 minutes. ${formatTimePrecise(activeDoc.cursorSec)}.`);
    return { executed: true, resultText: "Fast forwarded 5 minutes" };
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

  registerAction("goToPrimaryEditor", () => {
    goToPrimaryEditor();
    return { executed: true, resultText: "Go to Primary Editor" };
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
  registerAction("trimStart", () => {
    if (!activeDoc) return { executed: false, reason: "No audio document is open." };
    handleTrimBeginning();
    return { executed: true, resultText: "Trim Beginning to Playhead" };
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
function seekPlaybackFromPlayhead(targetSec) {
  if (!activeDoc) return;
  const wasPlaying = player.isPlaying();
  const mode = playbackMode;
  const rangeEnd = wasPlaying ? player.rangeEndSec : activeDoc.durationSec;
  const clamped = Math.max(0, Math.min(targetSec, activeDoc.durationSec));
  setPlayhead(clamped);

  // A playhead command issued while audio is playing is a seek, not merely
  // a visual slider move. Restart the current playback mode at the requested
  // position so what the user hears and what the Playhead control reports
  // remain the same position.
  if (wasPlaying && mode) {
    player.stop();
    const end = Math.max(clamped, Math.min(rangeEnd, activeDoc.durationSec));
    if (end > clamped) {
      player.play(activeDoc.buffer, clamped, end);
      playbackMode = mode;
      updateTransportButtonLabels();
      startPlaybackTicker();
    } else {
      playbackMode = null;
      updateTransportButtonLabels();
    }
  }
}

function bindPlayheadSlider() {
  if (!el.playheadSlider) return;

  el.playheadSlider.addEventListener("keydown", (event) => {
    if (!activeDoc) return;
    switch (event.key) {
      case "ArrowLeft":
        event.preventDefault();
        seekPlaybackFromPlayhead((player.isPlaying() ? player.getPositionSec() : activeDoc.cursorSec) - (event.ctrlKey ? 30 : 10));
        break;
      case "ArrowRight":
        event.preventDefault();
        seekPlaybackFromPlayhead((player.isPlaying() ? player.getPositionSec() : activeDoc.cursorSec) + (event.ctrlKey ? 30 : 10));
        break;
      case "Home":
        event.preventDefault();
        if (event.shiftKey) {
          const anchor = activeDoc.cursorSec;
          activeDoc.selection = { startSec: 0, endSec: anchor };
          setPlayhead(0);
          updateSelectionDisplay();
          drawTimeline();
          announceStatus(`Selected from beginning to ${formatTimePrecise(anchor)}.`);
        } else {
          activeDoc.clearSelection();
          updateSelectionDisplay();
          setPlayhead(0);
          announceStatus(`Beginning. ${formatTimePrecise(activeDoc.cursorSec)}. Selection cleared.`);
        }
        break;
      case "End":
        event.preventDefault();
        if (event.shiftKey) {
          const anchor = activeDoc.cursorSec;
          activeDoc.selection = { startSec: anchor, endSec: activeDoc.durationSec };
          setPlayhead(activeDoc.durationSec);
          updateSelectionDisplay();
          drawTimeline();
          announceStatus(`Selected from ${formatTimePrecise(anchor)} to end.`);
        } else {
          activeDoc.clearSelection();
          updateSelectionDisplay();
          setPlayhead(activeDoc.durationSec);
          announceStatus(`End. ${formatTimePrecise(activeDoc.cursorSec)}. Selection cleared.`);
        }
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
    seekPlaybackFromPlayhead(parseFloat(el.playheadSlider.value));
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
    if (el.playheadSlider) {
      // Keep the focused native range control truthful while audio is moving.
      // Do not announce on every animation frame; updating value +
      // aria-valuetext lets a screen-reader user query the current position
      // without creating a stream of unsolicited speech.
      el.playheadSlider.value = String(liveSec);
      el.playheadSlider.setAttribute("aria-valuetext", formatTimePrecise(liveSec));
    }
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

  const auditionStart = activeDoc.hasSelection() ? activeDoc.selection.startSec : activeDoc.cursorSec;
  const auditionEnd = activeDoc.hasSelection() ? activeDoc.selection.endSec : activeDoc.durationSec;
  player.play(activeDoc.buffer, auditionStart, auditionEnd);
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

    const replacingSelection = activeDoc.hasSelection();
    const insertAt = replacingSelection ? activeDoc.selection.startSec : activeDoc.cursorSec;
    const destination = replacingSelection
      ? bufUtil.deleteRange(activeDoc.buffer, activeDoc.selection.startSec, activeDoc.selection.endSec)
      : activeDoc.buffer;
    const newBuffer = bufUtil.insertBufferAt(destination, reconciled, insertAt);
    activeDoc.applyEdit(newBuffer);

    // The newly pasted/replaced audio becomes the active selection, per
    // the Pro editing model. The playhead lands at its end.
    const pastedDuration = reconciled.length / reconciled.sampleRate;
    activeDoc.selection = { startSec: insertAt, endSec: insertAt + pastedDuration };
    setPlayhead(insertAt + pastedDuration);

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

function handleTrimBeginning() {
  if (!activeDoc) return;
  const cutAt = activeDoc.cursorSec;
  if (cutAt <= 0) {
    announceAlert("The playhead is already at the beginning.");
    return;
  }
  if (cutAt >= activeDoc.durationSec) {
    announceAlert("The playhead is at the end. Trim Beginning would remove the entire document.");
    return;
  }

  // This command is deliberately playhead-based. Trimming unwanted audio
  // before the current edit position must not require either Mark.
  const newBuffer = bufUtil.sliceBuffer(activeDoc.buffer, cutAt, activeDoc.durationSec);
  activeDoc.applyEdit(newBuffer);
  setPlayhead(0);
  refreshAfterEdit();
  announceStatus(`Trimmed beginning through ${formatTimePrecise(cutAt)}.`);
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

async function encodeActiveDocument(format, signal = null) {
  if (signal?.aborted) throw new DOMException("Save canceled.", "AbortError");
  if (format === "mp3") {
    announceStatus(`Preparing ${activeDoc.baseName || "audio"} for saving. Please wait. Press Escape to cancel.`);
    return await encodeMp3Async(activeDoc.buffer, 192, (percent) => {
      if (percent > 0 && percent < 100 && percent % 10 === 0)
        announceStatus(`Preparing ${activeDoc.baseName || "audio"} for saving. ${percent} percent. Press Escape to cancel.`);
    }, signal);
  }
  return encodeWav(activeDoc.buffer);
}

async function writeBlobToNativePath(path, blob, onProgress = null, signal = null) {
  // Smaller IPC chunks make progress and Escape cancellation responsive even
  // when Array.from() and Tauri serialization are the expensive part.
  const CHUNK = 256 * 1024;
  await window.__TAURI__.core.invoke("begin_audio_save_stream", { path });
  let written = 0;
  let lastPercent = 0;
  try {
    for (let offset = 0; offset < blob.size; offset += CHUNK) {
      if (signal?.aborted) throw new DOMException("Save canceled.", "AbortError");
      const part = new Uint8Array(await blob.slice(offset, offset + CHUNK).arrayBuffer());
      await window.__TAURI__.core.invoke("append_audio_save_stream", { path, bytes: Array.from(part) });
      written += part.byteLength;
      const percent = blob.size > 0 ? Math.min(100, Math.floor((written / blob.size) * 100)) : 100;
      const milestone = Math.floor(percent / 10) * 10;
      if (onProgress && milestone >= 10 && milestone < 100 && milestone > lastPercent) {
        lastPercent = milestone;
        onProgress(milestone);
      }
      await new Promise(resolve => setTimeout(resolve, 0));
    }
    if (signal?.aborted) throw new DOMException("Save canceled.", "AbortError");
    return await window.__TAURI__.core.invoke("finish_audio_save_stream", { path, expectedBytes: written });
  } catch (err) {
    try { await window.__TAURI__.core.invoke("abort_audio_save_stream", { path }); } catch (_) {}
    throw err;
  }
}

function isSaveCancellation(err) {
  return !!err && (err.name === "AbortError" || /save canceled/i.test(err.message || ""));
}

function beginCancelableSave() {
  if (activeSaveOperation) activeSaveOperation.abort();
  activeSaveOperation = new AbortController();
  return activeSaveOperation;
}

function finishCancelableSave(controller) {
  if (activeSaveOperation === controller) activeSaveOperation = null;
}

function formatForDocument() {
  return activeDoc && activeDoc.sourceExtension === "mp3" ? "mp3" : "wav";
}

async function handleNativeSaveAs() {
  if (!activeDoc) return false;
  const format = formatForDocument();
  const proposedBase = activeDoc.baseName ? stripExtension(activeDoc.baseName) : "Untitled Audio";
  const suggestedName = `${proposedBase}.${format}`;
  try {
    if (!isRunningInTauri()) {
      const blob = await encodeActiveDocument(format);
      downloadBlob(blob, suggestedName);
      activeDoc.baseName = suggestedName;
      activeDoc.sourceExtension = format;
      activeDoc.isNew = false;
      activeDoc.markSaved();
      updateWindowTitle(); updateButtonStates();
      announceStatus(`${suggestedName} saved.`);
      return true;
    }
    // Show the native Save As dialog before doing expensive encoding. A
    // canceled Save As should be immediate and should not encode the document.
    const savedPath = await window.__TAURI__.core.invoke("choose_audio_save_path_native", { suggestedName });
    if (!savedPath) {
      if (applicationShutdownRequested) {
        applicationShutdownRequested = false;
        try { await window.__TAURI__.core.invoke("cancel_application_shutdown"); } catch (_) {}
        announceStatus("Save As canceled. Quit canceled. Your changes are still open.");
      } else {
        announceStatus("Save As canceled. Your changes are still open.");
      }
      return false;
    }
    const filename = savedPath.replace(/^.*[\\/]/, "");
    const saveController = beginCancelableSave();
    try {
      const blob = await encodeActiveDocument(format, saveController.signal);
      announceStatus(`Saving ${filename}. Please wait. Press Escape to cancel.`);
      await writeBlobToNativePath(savedPath, blob, (percent) => {
        announceStatus(`Saving ${filename}. ${percent} percent. Press Escape to cancel.`);
      }, saveController.signal);
    } finally {
      finishCancelableSave(saveController);
    }
    activeDoc.baseName = filename;
    activeDoc.sourceExtension = (filename.split(".").pop() || format).toLowerCase();
    activeDoc.sourceKey = savedPath;
    activeDoc.isNew = false;
    activeDoc.markSaved();
    updateWindowTitle(); updateButtonStates();
    announceStatus(`${filename} saved.`);
    if (applicationShutdownRequested) await approveApplicationShutdownEditor();
    return true;
  } catch (err) {
    if (applicationShutdownRequested) {
      applicationShutdownRequested = false;
      try { await window.__TAURI__.core.invoke("cancel_application_shutdown"); } catch (_) {}
    }
    if (isSaveCancellation(err)) {
      announceStatus("Save canceled. Your changes are still open.");
      return false;
    }
    announceAlert(`Save failed. ${err && err.message ? err.message : String(err)} The document remains open with unsaved changes.`);
    return false;
  }
}

async function handleSave() {
  if (!activeDoc) return false;
  if (activeDoc.isNew || !activeDoc.sourceKey) return await handleNativeSaveAs();

  const format = formatForDocument();
  try {
    const saveController = beginCancelableSave();
    let savedPath;
    try {
      const blob = await encodeActiveDocument(format, saveController.signal);
      announceStatus(`Saving ${activeDoc.baseName || "Audio"}. Please wait. Press Escape to cancel.`);
      savedPath = await writeBlobToNativePath(activeDoc.sourceKey, blob, (percent) => {
        announceStatus(`Saving ${activeDoc.baseName || "Audio"}. ${percent} percent. Press Escape to cancel.`);
      }, saveController.signal);
    } finally {
      finishCancelableSave(saveController);
    }
    activeDoc.markSaved();
    updateWindowTitle(); updateButtonStates();
    announceStatus(`${activeDoc.baseName || "Audio"} saved.`);
    if (applicationShutdownRequested) await approveApplicationShutdownEditor();
    return !!savedPath;
  } catch (err) {
    if (applicationShutdownRequested) {
      applicationShutdownRequested = false;
      try { await window.__TAURI__.core.invoke("cancel_application_shutdown"); } catch (_) {}
    }
    if (isSaveCancellation(err)) {
      announceStatus("Save canceled. Your changes are still open.");
      return false;
    }
    announceAlert(`Save failed. ${err && err.message ? err.message : String(err)} The document remains open with unsaved changes.`);
    return false;
  }
}

function openSaveAsForm() {
  // Save As is intentionally the native Windows dialog. It provides familiar
  // filename editing, Enter-to-save behavior, and the OS overwrite warning.
  void handleNativeSaveAs();
}

async function closeSaveAsForm() {
  // Retained for compatibility with the existing hidden legacy panel. Native
  // Save As cancellation is handled by handleNativeSaveAs().
  if (el.saveAsForm) el.saveAsForm.hidden = true;
}

async function handleConfirmSaveAs() {
  return await handleNativeSaveAs();
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
  const has = !!activeDoc && documentLoadState === "ready";
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
