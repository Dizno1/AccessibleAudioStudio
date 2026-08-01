// deviceManager.js
// Microphone discovery, selection, and browser capability reporting.
// This module never assumes a capability is present — everything is
// detected from the running browser before it is reported to the user.

/**
 * Report which browser capabilities this app depends on are actually
 * available, rather than assuming support.
 */
export function getBrowserCapabilities() {
  const hasMediaDevices = !!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia);
  const hasMediaRecorder = typeof window.MediaRecorder !== "undefined";
  const hasIndexedDB = !!window.indexedDB;

  let supportedMimeType = null;
  if (hasMediaRecorder) {
    const candidates = [
      "audio/webm;codecs=opus",
      "audio/webm",
      "audio/ogg;codecs=opus",
      "audio/mp4",
    ];
    supportedMimeType = candidates.find((type) => MediaRecorder.isTypeSupported(type)) || null;
  }

  const isFullySupported = hasMediaDevices && hasMediaRecorder && hasIndexedDB && !!supportedMimeType;

  return {
    hasMediaDevices,
    hasMediaRecorder,
    hasIndexedDB,
    supportedMimeType,
    isFullySupported,
  };
}

/**
 * Ask the user for microphone permission. This is required before device
 * labels are available from enumerateDevices(). Returns the granted stream
 * so callers can reuse it instead of opening the microphone twice.
 */
export async function requestMicrophonePermission() {
  const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
  return stream;
}

/**
 * List available audio input devices. Requires permission to already have
 * been granted, or device labels will be empty.
 */
export async function listMicrophones() {
  const devices = await navigator.mediaDevices.enumerateDevices();
  return devices
    .filter((d) => d.kind === "audioinput")
    .map((d, index) => ({
      deviceId: d.deviceId,
      label: d.label && d.label.trim() ? d.label : `Microphone ${index + 1}`,
    }));
}

/**
 * Open a stream from a specific microphone with the given recording
 * profile's constraints applied.
 */
export async function openMicrophoneStream(deviceId, profileConstraints) {
  const audioConstraints = {
    ...profileConstraints,
  };
  if (deviceId) {
    audioConstraints.deviceId = { exact: deviceId };
  }
  return navigator.mediaDevices.getUserMedia({ audio: audioConstraints });
}

export function closeStream(stream) {
  if (!stream) return;
  stream.getTracks().forEach((track) => track.stop());
}
