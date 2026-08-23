// audioClipboard.js
// A small in-application clipboard for audio, separate from the system
// clipboard. Web pages cannot place raw audio samples on the operating
// system clipboard, so Cut/Copy/Paste here move audio between
// AccessibleAudioStudio Pro documents only — not to or from other
// applications. This is documented as a Phase 1 limitation.

let clipboardBuffer = null; // AudioBuffer | null
let hasContent = false;

export function setClipboard(buffer) {
  clipboardBuffer = buffer;
  hasContent = true;
}

export function getClipboard() {
  return clipboardBuffer;
}

export function clipboardHasContent() {
  return hasContent;
}
