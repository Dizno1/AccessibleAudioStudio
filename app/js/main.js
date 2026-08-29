// main.js
// Wires together device management, the recording engine, playback, the
// library, and the shortcut service. This file owns application state and
// DOM event bindings; it does not implement any browser API logic itself
// (that lives in the dedicated modules) — keeping this file focused on
// orchestration only, so future features extend the modules, not this file.

import { initAnnouncer, announceStatus, announceAlert } from "./announcer.js";
import {
  getBrowserCapabilities,
  requestMicrophonePermission,
  listMicrophones,
  openMicrophoneStream,
  closeStream,
} from "./deviceManager.js";
import { PROFILES, getProfileById, DEFAULT_PROFILE_ID } from "./profiles.js";
import { RecordingEngine, RecordingState } from "./recordingEngine.js";
import { PlaybackController } from "./playback.js";
import * as storage from "./storage.js";
import { renderLibrary, focusRecordingHeading } from "./library.js";
import { formatDurationNatural } from "./timeFormat.js";
import { initShortcutService, registerAction } from "./shortcutService.js";
import { onShortcutEvent, getLastShortcutEvent } from "./shortcutDiagnostics.js";
import { initAudioEditorLauncher, registerAudioEditorLauncherShortcuts } from "./audioEditorLauncher.js";

// ---------------------------------------------------------------------
// Element references
// ---------------------------------------------------------------------

const el = {
  unsupportedNotice: document.getElementById("unsupported-notice"),
  unsupportedDetails: document.getElementById("unsupported-details"),

  micStatus: document.getElementById("mic-status"),
  enableMicButton: document.getElementById("enable-mic-button"),
  micSelection: document.getElementById("mic-selection"),
  micSelect: document.getElementById("mic-select"),
  profileSelect: document.getElementById("profile-select"),
  profileDescription: document.getElementById("profile-description"),

  recordingStatus: document.getElementById("recording-status"),
  recordToggleButton: document.getElementById("record-toggle-button"),
  pauseResumeButton: document.getElementById("pause-resume-button"),

  savePanel: document.getElementById("review-panel"),
  reviewDurationDescription: document.getElementById("review-duration-description"),
  saveButton: document.getElementById("save-recording-button"),
  recordAgainButton: document.getElementById("record-again-button"),
  discardButton: document.getElementById("discard-recording-button"),

  saveForm: document.getElementById("save-form"),
  nameInput: document.getElementById("recording-name-input"),
  notesInput: document.getElementById("recording-notes-input"),
  confirmSaveButton: document.getElementById("confirm-save-button"),
  cancelSaveButton: document.getElementById("cancel-save-button"),

  playbackStatus: document.getElementById("playback-status"),
  audioPlayer: document.getElementById("audio-player"),
  playPauseButton: document.getElementById("play-pause-button"),
  restartButton: document.getElementById("restart-button"),
  skipBackwardButton: document.getElementById("skip-backward-button"),
  skipForwardButton: document.getElementById("skip-forward-button"),
  jumpBeginningButton: document.getElementById("jump-beginning-button"),
  jumpEndButton: document.getElementById("jump-end-button"),
  announcePositionButton: document.getElementById("announce-position-button"),

  libraryContainer: document.getElementById("library-container"),

  diagnosticsLastShortcut: document.getElementById("diagnostics-last-shortcut"),
};

// ---------------------------------------------------------------------
// Application state
// ---------------------------------------------------------------------

const state = {
  capabilities: null,
  micStream: null,
  microphones: [],
  selectedProfileId: DEFAULT_PROFILE_ID,
  engine: null,
  pendingRecording: null, // { blob, durationSeconds } awaiting save/discard
  selectedRecordingId: null,
  library: [],
};

const playback = new PlaybackController(el.audioPlayer);

// ---------------------------------------------------------------------
// Startup
// ---------------------------------------------------------------------

async function init() {
  initAnnouncer();
  initShortcutService();
  registerShortcutActions();
  bindNativeMenuEvents();
  bindStaticEventListeners();
  populateProfileSelect();
  initShortcutDiagnosticsPanel();

  // Audio Editor (Pro) is a self-contained module: it owns its own DOM
  // wiring and shortcut actions, and never touches recording state above.
  // As of 0.2.0 it only launches editor windows (open_audio_windows /
  // open_new_editor_window) — the actual per-document editing lives
  // entirely in editorWindow.js, in each of those separate windows.
  initAudioEditorLauncher();
  registerAudioEditorLauncherShortcuts();

  state.capabilities = getBrowserCapabilities();
  if (!state.capabilities.isFullySupported) {
    showUnsupportedNotice(state.capabilities);
  }

  await refreshLibrary();
}

function showUnsupportedNotice(capabilities) {
  const missing = [];
  if (!capabilities.hasMediaDevices) missing.push("microphone access (getUserMedia)");
  if (!capabilities.hasMediaRecorder) missing.push("audio recording (MediaRecorder)");
  if (!capabilities.supportedMimeType) missing.push("a supported audio recording format");
  if (!capabilities.hasIndexedDB) missing.push("local storage (IndexedDB)");

  el.unsupportedDetails.textContent =
    "This browser is missing: " + missing.join(", ") +
    ". Please try an up-to-date version of Chrome, Edge, or Firefox.";
  el.unsupportedNotice.hidden = false;
  el.enableMicButton.disabled = true;
}

// ---------------------------------------------------------------------
// Microphone setup
// ---------------------------------------------------------------------

function populateProfileSelect() {
  el.profileSelect.innerHTML = "";
  PROFILES.forEach((profile) => {
    const option = document.createElement("option");
    option.value = profile.id;
    option.textContent = profile.name;
    el.profileSelect.appendChild(option);
  });
  el.profileSelect.value = state.selectedProfileId;
  updateProfileDescription();
}

function updateProfileDescription() {
  const profile = getProfileById(state.selectedProfileId);
  el.profileDescription.textContent = profile.description;
}

async function handleEnableMicrophone() {
  try {
    el.enableMicButton.disabled = true;
    el.micStatus.textContent = "Requesting microphone permission…";

    const stream = await requestMicrophonePermission();
    // We only needed this stream to unlock device labels; the recording
    // engine opens its own stream per-profile when recording starts.
    closeStream(stream);

    state.microphones = await listMicrophones();
    populateMicSelect();

    el.micSelection.hidden = false;
    el.micStatus.textContent = `Microphone access granted. ${state.microphones.length} microphone${state.microphones.length === 1 ? "" : "s"} found. Ready to record.`;
    el.recordToggleButton.disabled = false;
  } catch (err) {
    el.micStatus.textContent = "Microphone access was not granted.";
    announceAlert("Microphone access was denied or unavailable. " + describeError(err));
    el.enableMicButton.disabled = false;
  }
}

function populateMicSelect() {
  el.micSelect.innerHTML = "";
  state.microphones.forEach((mic) => {
    const option = document.createElement("option");
    option.value = mic.deviceId;
    option.textContent = mic.label;
    el.micSelect.appendChild(option);
  });
}

// ---------------------------------------------------------------------
// Recording
// ---------------------------------------------------------------------

async function startRecording() {
  if (state.engine && state.engine.state === RecordingState.RECORDING) return;
  if (!state.capabilities.isFullySupported) {
    announceAlert("Recording is not available in this browser.");
    return;
  }
  if (el.recordToggleButton.disabled) {
    announceAlert("Enable microphone access before recording.");
    return;
  }

  try {
    const profile = getProfileById(state.selectedProfileId);
    const deviceId = el.micSelect.value || undefined;
    const stream = await openMicrophoneStream(deviceId, profile.constraints);
    state.micStream = stream;

    state.engine = new RecordingEngine(
      stream,
      state.capabilities.supportedMimeType,
      profile.audioBitsPerSecond
    );
    state.engine.start();

    el.recordingStatus.textContent = `Recording with the ${profile.name} profile.`;
    announceStatus("Recording started.");

    // The button that had focus (very likely this one) keeps it: relabel
    // in place rather than disabling it, so the browser never has a
    // reason to move focus or re-announce surrounding context. The
    // microphone and profile selectors are deliberately left enabled too
    // — changing them mid-recording has no effect on the stream already
    // in use, so there's nothing to protect by disabling them, and doing
    // so risks kicking focus away from whichever one the user just used.
    el.recordToggleButton.textContent = "Stop Recording (Ctrl+Alt+R)";
    el.pauseResumeButton.disabled = false;
    el.pauseResumeButton.textContent = "Pause Recording (Ctrl+Alt+Space)";
  } catch (err) {
    announceAlert("Could not start recording. " + describeError(err));
  }
}

function togglePauseResume() {
  if (!state.engine) return;

  if (state.engine.state === RecordingState.RECORDING) {
    state.engine.pause();
    el.pauseResumeButton.textContent = "Resume Recording (Ctrl+Alt+Space)";
    el.recordingStatus.textContent = "Recording paused.";
    announceStatus("Recording paused.");
  } else if (state.engine.state === RecordingState.PAUSED) {
    state.engine.resume();
    el.pauseResumeButton.textContent = "Pause Recording (Ctrl+Alt+Space)";
    el.recordingStatus.textContent = "Recording resumed.";
    announceStatus("Recording resumed.");
  } else {
    announceAlert("There is no active recording to pause or resume.");
  }
}

async function stopRecording() {
  if (!state.engine) {
    announceAlert("There is no active recording to stop.");
    return;
  }
  if (state.engine.state !== RecordingState.RECORDING && state.engine.state !== RecordingState.PAUSED) {
    return;
  }

  try {
    const { blob, durationSeconds } = await state.engine.stop();
    closeStream(state.micStream);
    state.micStream = null;
    state.pendingRecording = { blob, durationSeconds };

    el.pauseResumeButton.disabled = true;

    openReviewPanel(durationSeconds);
  } catch (err) {
    announceAlert("Recording could not be stopped cleanly. " + describeError(err));
  }
}

/**
 * Enter the review state: the just-stopped recording is loaded into the
 * shared Playback controls (but NOT auto-played), and the user is offered
 * Save / Record Again / Discard before ever being asked for a name.
 */
function openReviewPanel(durationSeconds) {
  el.recordingStatus.textContent = "Recording stopped. Ready for review.";
  el.reviewDurationDescription.textContent = `Length: ${formatDurationNatural(durationSeconds)}.`;
  el.savePanel.hidden = false;
  el.recordToggleButton.textContent = "Start Recording (Ctrl+Alt+R)";
  el.recordToggleButton.disabled = true;

  // Reviewing an unsaved recording takes over the shared playback controls.
  // Selecting a different saved recording is disabled until this one is
  // resolved, so what's loaded never silently drifts from what Ctrl+Alt+P
  // will act on.
  playback.load(state.pendingRecording.blob);
  setPlaybackControlsEnabled(true);
  updatePlaybackStatusText();
  refreshLibrary();

  announceStatus("Recording stopped.");
  // This is the one deliberate focus move in this flow — an explicit,
  // previously agreed consequence of stopping, not an incidental side
  // effect of disabling a control.
  el.playPauseButton.focus();
}

function closeReviewPanel() {
  el.savePanel.hidden = true;
  el.saveForm.hidden = true;
}

function setPlaybackControlsEnabled(enabled) {
  [
    el.playPauseButton,
    el.restartButton,
    el.skipBackwardButton,
    el.skipForwardButton,
    el.jumpBeginningButton,
    el.jumpEndButton,
    el.announcePositionButton,
  ].forEach((btn) => (btn.disabled = !enabled));
}

function updatePlaybackStatusText() {
  if (state.pendingRecording) {
    el.playbackStatus.textContent = "Reviewing your unsaved recording. Not yet saved.";
  } else if (state.selectedRecordingId) {
    const record = state.library.find((r) => r.id === state.selectedRecordingId);
    el.playbackStatus.textContent = record
      ? `Selected for playback: ${record.name}.`
      : "No recording selected for playback.";
  } else {
    el.playbackStatus.textContent = "No recording selected for playback.";
  }
}

/** Reveal the name/notes form. Only happens once the user chooses to save. */
function openSaveForm() {
  const profile = getProfileById(state.selectedProfileId);
  const defaultName = `${profile.name} – ${new Date().toLocaleDateString()}`;

  el.savePanel.hidden = true;
  el.saveForm.hidden = false;
  el.nameInput.value = defaultName;
  el.notesInput.value = "";
  el.nameInput.focus();
  el.nameInput.select();
}

function cancelSaveForm() {
  el.saveForm.hidden = true;
  el.savePanel.hidden = false;
  el.saveButton.focus();
}

async function confirmSave() {
  if (!state.pendingRecording) return;

  const profile = getProfileById(state.selectedProfileId);
  const { blob, durationSeconds } = state.pendingRecording;

  try {
    const saved = await storage.saveRecording({
      name: el.nameInput.value,
      durationSeconds,
      profileId: profile.id,
      notes: el.notesInput.value,
      mimeType: state.capabilities.supportedMimeType,
      blob,
    });

    state.pendingRecording = null;
    // Keep the just-saved recording selected for playback, as requested,
    // rather than clearing the playback selection.
    state.selectedRecordingId = saved.id;

    closeReviewPanel();
    el.recordingStatus.textContent = "Not recording.";
    el.recordToggleButton.disabled = false;
    updatePlaybackStatusText();
    await refreshLibrary();

    announceStatus("Recording saved.");
    focusRecordingHeading(saved.id);
  } catch (err) {
    announceAlert("The recording could not be saved. " + describeError(err));
  }
}

function recordAgain() {
  if (!state.pendingRecording) return;

  const confirmed = window.confirm("Record again and discard the current recording?");
  if (!confirmed) return;

  discardPendingRecording();
  el.recordToggleButton.focus();
}

function discardRecording() {
  discardPendingRecording();
  announceStatus("Recording discarded.");
  el.recordToggleButton.focus();
}

/** Shared cleanup for Record Again and Discard: drop the unsaved recording and return to ready-to-record. */
function discardPendingRecording() {
  state.pendingRecording = null;
  closeReviewPanel();
  playback.clear();
  setPlaybackControlsEnabled(false);
  updatePlaybackStatusText();
  el.recordingStatus.textContent = "Not recording.";
  el.recordToggleButton.disabled = false;
  refreshLibrary();
}

// ---------------------------------------------------------------------
// Library
// ---------------------------------------------------------------------

async function refreshLibrary() {
  state.library = await storage.listRecordings();
  renderLibrary(
    el.libraryContainer,
    state.library,
    {
      onSelect: handleSelectRecording,
      onRename: handleRenameRecording,
      onEditNotes: handleEditNotes,
      onDelete: handleDeleteRecording,
    },
    state.selectedRecordingId,
    { disableSelection: !!state.pendingRecording }
  );
}

function handleSelectRecording(id) {
  if (state.pendingRecording) {
    // Defense in depth: the Select control is disabled in the library
    // while there's an unsaved recording pending review, but guard here
    // too in case this is ever reached another way.
    announceAlert("Finish reviewing the current recording first — Save, Record Again, or Discard.");
    return;
  }

  const record = state.library.find((r) => r.id === id);
  if (!record) return;

  state.selectedRecordingId = id;
  playback.load(record.blob);
  setPlaybackControlsEnabled(true);
  updatePlaybackStatusText();
  el.playPauseButton.textContent = "Play (Ctrl+Alt+P)";

  refreshLibrary();
}

async function handleRenameRecording(id) {
  const record = state.library.find((r) => r.id === id);
  if (!record) return;

  const newName = window.prompt("Rename recording:", record.name);
  if (newName === null) return;
  if (!newName.trim()) {
    announceAlert("Recording name cannot be empty.");
    return;
  }
  await storage.updateRecordingMetadata(id, { name: newName });
  await refreshLibrary();
}

async function handleEditNotes(id) {
  const record = state.library.find((r) => r.id === id);
  if (!record) return;

  const newNotes = window.prompt("Edit notes for this recording:", record.notes || "");
  if (newNotes === null) return;
  await storage.updateRecordingMetadata(id, { notes: newNotes });
  await refreshLibrary();
}

async function handleDeleteRecording(id) {
  const record = state.library.find((r) => r.id === id);
  if (!record) return;

  const confirmed = window.confirm(`Delete "${record.name}"? This cannot be undone.`);
  if (!confirmed) return;

  await storage.deleteRecording(id);

  if (state.selectedRecordingId === id) {
    state.selectedRecordingId = null;
    playback.clear();
    setPlaybackControlsEnabled(false);
    updatePlaybackStatusText();
  }

  await refreshLibrary();
  announceStatus("Recording deleted.");
}

// ---------------------------------------------------------------------
// Playback
// ---------------------------------------------------------------------

function togglePlayPause() {
  if (!playback.hasSource()) {
    announceAlert("No recording is available for playback.");
    return;
  }
  const result = playback.togglePlayPause();
  if (result === "playing") {
    el.playPauseButton.textContent = "Pause (Ctrl+Alt+P)";
    announceStatus("Playback started.");
  } else {
    el.playPauseButton.textContent = "Play (Ctrl+Alt+P)";
    announceStatus("Playback paused.");
  }
}

function announcePlaybackPosition() {
  if (!playback.hasSource()) return;
  announceStatus(playback.getPositionDescription());
}

// ---------------------------------------------------------------------
// Event bindings
// ---------------------------------------------------------------------

function bindStaticEventListeners() {
  el.enableMicButton.addEventListener("click", handleEnableMicrophone);

  el.profileSelect.addEventListener("change", () => {
    state.selectedProfileId = el.profileSelect.value;
    updateProfileDescription();
  });

  el.recordToggleButton.addEventListener("click", () => toggleRecording());
  el.pauseResumeButton.addEventListener("click", togglePauseResume);

  el.saveButton.addEventListener("click", openSaveForm);
  el.recordAgainButton.addEventListener("click", recordAgain);
  el.discardButton.addEventListener("click", discardRecording);
  el.confirmSaveButton.addEventListener("click", confirmSave);
  el.cancelSaveButton.addEventListener("click", cancelSaveForm);

  el.playPauseButton.addEventListener("click", togglePlayPause);
  el.restartButton.addEventListener("click", () => {
    playback.restart();
    el.playPauseButton.textContent = "Pause (Ctrl+Alt+P)";
  });
  el.skipBackwardButton.addEventListener("click", () => playback.skipBackward());
  el.skipForwardButton.addEventListener("click", () => playback.skipForward());
  el.jumpBeginningButton.addEventListener("click", () => playback.jumpToBeginning());
  el.jumpEndButton.addEventListener("click", () => playback.jumpToEnd());
  el.announcePositionButton.addEventListener("click", announcePlaybackPosition);

  el.audioPlayer.addEventListener("ended", () => {
    el.playPauseButton.textContent = "Play (Ctrl+Alt+P)";
  });
}

async function goToPrimaryEditor() {
  if (typeof window === "undefined" || !window.__TAURI__) return false;
  try {
    await new Promise((resolve) => setTimeout(resolve, 50));
    await window.__TAURI__.core.invoke("focus_primary_editor");
    return true;
  } catch (_) {
    announceAlert("No Primary Editor is currently available.");
    return false;
  }
}

function bindNativeMenuEvents() {
  if (typeof window === "undefined" || !window.__TAURI__) return;
  const { listen } = window.__TAURI__.event;
  listen("menu-action", async (event) => {
    if (event.payload === "goToPrimaryEditor") {
      await goToPrimaryEditor();
      return;
    }
    if (event.payload === "showKeyboardShortcuts" || event.payload === "showOpenAudioDiagnostics") {
      const wantedSummary = event.payload === "showKeyboardShortcuts" ? "Keyboard Shortcuts" : "Open Audio Diagnostics";
      const details = Array.from(document.querySelectorAll("footer details")).find((d) =>
        d.querySelector("summary")?.textContent.startsWith(wantedSummary)
      );
      if (details) {
        details.open = true;
        details.querySelector("summary")?.focus();
      }
    }
  });
}

function registerShortcutActions() {
  registerAction("goToPrimaryEditor", () => {
    goToPrimaryEditor();
    return { executed: true, resultText: "Go to Primary Editor" };
  });

  // Ctrl+Alt+R toggles like the record button on a physical recorder:
  // not recording -> start; recording or paused -> stop. There is no
  // separate stop shortcut.
  registerAction("toggleRecording", toggleRecording);

  registerAction("togglePauseResume", () => {
    if (el.pauseResumeButton.disabled) {
      return { executed: false, reason: "There is no active recording to pause or resume." };
    }
    togglePauseResume();
    return { executed: true, resultText: "Pause or Resume Recording" };
  });

  registerAction("togglePlayPause", () => {
    if (!playback.hasSource()) {
      return { executed: false, reason: "No recording is available for playback." };
    }
    togglePlayPause();
    return { executed: true, resultText: "Play or Pause Playback" };
  });
}

/** Shared by the record toggle button's click handler and the Ctrl+Alt+R shortcut. */
function toggleRecording() {
  const isActiveRecording =
    state.engine &&
    (state.engine.state === RecordingState.RECORDING || state.engine.state === RecordingState.PAUSED);

  if (isActiveRecording) {
    stopRecording();
    return { executed: true, resultText: "Stop Recording" };
  }

  if (state.pendingRecording) {
    return {
      executed: false,
      reason: "Finish reviewing the current recording first — Save, Record Again, or Discard.",
    };
  }

  if (el.recordToggleButton.disabled) {
    return { executed: false, reason: "Enable microphone access before recording." };
  }
  startRecording();
  return { executed: true, resultText: "Start Recording" };
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

function describeError(err) {
  if (!err) return "";
  if (err.name === "NotAllowedError") return "Permission was denied.";
  if (err.name === "NotFoundError") return "No microphone was found.";
  return err.message || String(err);
}

init();
