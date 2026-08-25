// audioClipboard.js
// A small in-application clipboard for audio, separate from the system
// clipboard. Web pages cannot place raw audio samples on the operating
// system clipboard, so Cut/Copy/Paste here move audio between
// AccessibleAudioStudio Pro documents only — not to or from other
// applications. This is documented as a Phase 1 limitation, unchanged
// since the original single-window architecture.
//
// What changed in 0.2.0: every open audio document now lives in its own
// separate window/webview, so a plain module-level JS variable (0.1.x's
// entire implementation) can no longer serve Copy in one window and
// Paste in another — each window has its own completely independent
// JavaScript runtime with no shared memory at all. The clipboard now
// lives in Rust, as small managed Tauri state (see
// SharedAudioClipboard/set_shared_audio_clipboard/get_shared_audio_clipboard
// in src-tauri/src/main.rs), reachable by every window through the same
// ordinary Tauri command mechanism already used for Open Audio. The
// public API here (setClipboard/getClipboard/clipboardHasContent) is
// unchanged in shape from 0.1.x, so audioEditorController.js's Cut/Copy/
// Paste logic needed only to start awaiting these calls, not to change
// how it uses them.
//
// The browser-only fallback (no Tauri runtime present, e.g. this app
// running as a plain GitHub Pages page) keeps the original plain-variable
// behavior — there is exactly one window in that context anyway, so
// nothing is lost by not reaching for shared state that wouldn't exist.

let localClipboardBuffer = null; // AudioBuffer | null, browser-only fallback
let localHasContent = false;

function isRunningInTauri() {
  return typeof window !== "undefined" && !!window.__TAURI__;
}

/** Serializes an AudioBuffer into the plain, JSON-friendly shape the Rust side stores. */
function toPayload(buffer) {
  const channelData = [];
  for (let c = 0; c < buffer.numberOfChannels; c++) {
    // Float32Array isn't itself JSON-serializable in a useful way over
    // Tauri's IPC layer; a plain array of numbers is what actually
    // survives the round trip intact.
    channelData.push(Array.from(buffer.getChannelData(c)));
  }
  return { sample_rate: buffer.sampleRate, channel_data: channelData };
}

/** Reconstructs an AudioBuffer from the Rust-side payload shape. */
function fromPayload(payload, audioContext) {
  const numChannels = payload.channel_data.length;
  const length = numChannels > 0 ? payload.channel_data[0].length : 1;
  const buffer = audioContext.createBuffer(numChannels, Math.max(1, length), payload.sample_rate);
  for (let c = 0; c < numChannels; c++) {
    buffer.getChannelData(c).set(Float32Array.from(payload.channel_data[c]));
  }
  return buffer;
}

/** Copies an AudioBuffer to the clipboard — shared across every open editor window when running as the desktop app. */
export async function setClipboard(buffer) {
  if (isRunningInTauri()) {
    const { invoke } = window.__TAURI__.core;
    await invoke("set_shared_audio_clipboard", { payload: toPayload(buffer) });
  } else {
    localClipboardBuffer = buffer;
    localHasContent = true;
  }
}

/**
 * Retrieves the current clipboard contents as an AudioBuffer, or null if
 * nothing has been copied yet. `audioContext` is required to reconstruct
 * the buffer from the Tauri-stored payload shape (getAudioContext() from
 * audioCodec.js, passed in by the caller rather than imported directly
 * here, to avoid a circular dependency between the two modules).
 */
export async function getClipboard(audioContext) {
  if (isRunningInTauri()) {
    const { invoke } = window.__TAURI__.core;
    const payload = await invoke("get_shared_audio_clipboard");
    return payload ? fromPayload(payload, audioContext) : null;
  }
  return localClipboardBuffer;
}

/** Whether anything has been copied yet, without needing to reconstruct the full AudioBuffer. */
export async function clipboardHasContent() {
  if (isRunningInTauri()) {
    const { invoke } = window.__TAURI__.core;
    const payload = await invoke("get_shared_audio_clipboard");
    return payload !== null;
  }
  return localHasContent;
}
