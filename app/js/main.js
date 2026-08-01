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
import { renderLibrary } from "./library.js";
import { formatDurationNatural } from "./timeFormat.js";
import { initShortcutService, registerAction } from "./shortcutService.js";
import { onShortcutEvent, getLastShortcutEvent } from "./shortcutDiagnostics.js";

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
  startButton: document.getElementById("start-recording-button"),
  pauseResumeButton: document.getElementById("pause-resume-button"),
  stopButton: document.getElementById("stop-recording-button"),

  savePanel: document.getElementById("save-panel"),
  saveDurationDescription: document.getElementById("save-duration-description"),
  nameInput: document.getElementById("recording-name-input"),
  notesInput: document.getElementById("recording-notes-input"),
  saveButton: document.getElementById("save-recording-button"),
  discardButton: document.getElementById("discard-recording-button"),

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
  bindStaticEventListeners();
  populateProfileSelect();
  initShortcutDiagnosticsPanel();

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
    announceStatus("Microphone ready.");
    el.startButton.disabled = false;
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
  if (el.startButton.disabled) {
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

    el.startButton.disabled = true;
    el.pauseResumeButton.disabled = false;
    el.pauseResumeButton.textContent = "Pause Recording (Ctrl+Alt+Space)";
    el.stopButton.disabled = false;
    el.micSelect.disabled = true;
    el.profileSelect.disabled = true;
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

    el.recordingStatus.textContent = "Recording stopped.";
    announceStatus("Recording stopped.");

    el.startButton.disabled = false;
    el.pauseResumeButton.disabled = true;
    el.stopButton.disabled = true;
    el.micSelect.disabled = false;
    el.profileSelect.disabled = false;

    openSavePanel(durationSeconds);
  } catch (err) {
    announceAlert("Recording could not be stopped cleanly. " + describeError(err));
  }
}

function openSavePanel(durationSeconds) {
  const profile = getProfileById(state.selectedProfileId);
  const defaultName = `${profile.name} – ${new Date().toLocaleDateString()}`;

  el.saveDurationDescription.textContent = `Length: ${formatDurationNatural(durationSeconds)}.`;
  el.nameInput.value = defaultName;
  el.notesInput.value = "";
  el.savePanel.hidden = false;
  el.nameInput.focus();
  el.nameInput.select();
}

function closeSavePanel() {
  el.savePanel.hidden = true;
  state.pendingRecording = null;
}

async function saveRecording() {
  if (!state.pendingRecording) return;

  const profile = getProfileById(state.selectedProfileId);
  const { blob, durationSeconds } = state.pendingRecording;

  try {
    await storage.saveRecording({
      name: el.nameInput.value,
      durationSeconds,
      profileId: profile.id,
      notes: el.notesInput.value,
      mimeType: state.capabilities.supportedMimeType,
      blob,
    });

    closeSavePanel();
    await refreshLibrary();
    announceStatus("Recording saved.");
    el.libraryContainer.setAttribute("tabindex", "-1");
    el.libraryContainer.focus();
  } catch (err) {
    announceAlert("The recording could not be saved. " + describeError(err));
  }
}

function discardRecording() {
  closeSavePanel();
  el.recordingStatus.textContent = "Recording discarded.";
  announceStatus("Recording discarded.");
  el.startButton.focus();
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
    state.selectedRecordingId
  );
}

function handleSelectRecording(id) {
  const record = state.library.find((r) => r.id === id);
  if (!record) return;

  state.selectedRecordingId = id;
  playback.load(record.blob);

  el.playbackStatus.textContent = `Selected for playback: ${record.name}.`;
  announceStatus(`${record.name} selected for playback.`);

  [
    el.playPauseButton,
    el.restartButton,
    el.skipBackwardButton,
    el.skipForwardButton,
    el.jumpBeginningButton,
    el.jumpEndButton,
    el.announcePositionButton,
  ].forEach((btn) => (btn.disabled = false));
  el.playPauseButton.textContent = "Play (Ctrl+Alt+P)";

  refreshLibrary();
}

async function handleRenameRecording(id, currentName) {
  const newName = window.prompt("Rename recording:", currentName);
  if (newName === null) return;
  if (!newName.trim()) {
    announceAlert("Recording name cannot be empty.");
    return;
  }
  await storage.updateRecordingMetadata(id, { name: newName });
  await refreshLibrary();
  announceStatus("Recording renamed.");
}

async function handleEditNotes(id, currentNotes) {
  const newNotes = window.prompt("Edit notes for this recording:", currentNotes || "");
  if (newNotes === null) return;
  await storage.updateRecordingMetadata(id, { notes: newNotes });
  await refreshLibrary();
  announceStatus("Notes updated.");
}

async function handleDeleteRecording(id, name) {
  const confirmed = window.confirm(`Delete "${name}"? This cannot be undone.`);
  if (!confirmed) return;

  await storage.deleteRecording(id);

  if (state.selectedRecordingId === id) {
    state.selectedRecordingId = null;
    playback.clear();
    el.playbackStatus.textContent = "No recording selected for playback.";
    [
      el.playPauseButton,
      el.restartButton,
      el.skipBackwardButton,
      el.skipForwardButton,
      el.jumpBeginningButton,
      el.jumpEndButton,
      el.announcePositionButton,
    ].forEach((btn) => (btn.disabled = true));
  }

  await refreshLibrary();
  announceStatus("Recording deleted.");
}

// ---------------------------------------------------------------------
// Playback
// ---------------------------------------------------------------------

function togglePlayPause() {
  if (!playback.hasSource()) {
    announceAlert("Select a recording from the library first.");
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

  el.startButton.addEventListener("click", startRecording);
  el.pauseResumeButton.addEventListener("click", togglePauseResume);
  el.stopButton.addEventListener("click", stopRecording);

  el.saveButton.addEventListener("click", saveRecording);
  el.discardButton.addEventListener("click", discardRecording);

  el.playPauseButton.addEventListener("click", togglePlayPause);
  el.restartButton.addEventListener("click", () => {
    playback.restart();
    el.playPauseButton.textContent = "Pause (Ctrl+Alt+P)";
    announceStatus("Playback restarted.");
  });
  el.skipBackwardButton.addEventListener("click", () => playback.skipBackward());
  el.skipForwardButton.addEventListener("click", () => playback.skipForward());
  el.jumpBeginningButton.addEventListener("click", () => {
    playback.jumpToBeginning();
    announceStatus("Jumped to beginning.");
  });
  el.jumpEndButton.addEventListener("click", () => {
    playback.jumpToEnd();
    announceStatus("Jumped to end.");
  });
  el.announcePositionButton.addEventListener("click", announcePlaybackPosition);

  el.audioPlayer.addEventListener("ended", () => {
    el.playPauseButton.textContent = "Play (Ctrl+Alt+P)";
    announceStatus("Playback finished.");
  });
}

function registerShortcutActions() {
  // Ctrl+Alt+R toggles like the record button on a physical recorder:
  // not recording -> start; recording or paused -> stop. There is no
  // separate stop shortcut.
  registerAction("toggleRecording", () => {
    const isActiveRecording =
      state.engine &&
      (state.engine.state === RecordingState.RECORDING || state.engine.state === RecordingState.PAUSED);

    if (isActiveRecording) {
      if (el.stopButton.disabled) {
        return { executed: false, reason: "The Stop Recording control is not currently available." };
      }
      stopRecording();
      return { executed: true, resultText: "Stop Recording" };
    }

    if (el.startButton.disabled) {
      return { executed: false, reason: "Enable microphone access before recording." };
    }
    startRecording();
    return { executed: true, resultText: "Start Recording" };
  });

  registerAction("togglePauseResume", () => {
    if (el.pauseResumeButton.disabled) {
      return { executed: false, reason: "There is no active recording to pause or resume." };
    }
    togglePauseResume();
    return { executed: true, resultText: "Pause or Resume Recording" };
  });

  registerAction("togglePlayPause", () => {
    if (el.playPauseButton.disabled) {
      return { executed: false, reason: "No recording is selected for playback." };
    }
    togglePlayPause();
    return { executed: true, resultText: "Play or Pause Playback" };
  });
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
