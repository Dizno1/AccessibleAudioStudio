// audioDocument.js
// One AudioDocument represents one open audio file being edited. Each
// opened or newly-created file gets its own independent AudioDocument —
// this is the "document" in the Open/New/Save/Save As, multi-document
// model the Pro roadmap calls for.
//
// A document never mutates its AudioBuffer in place. Every edit produces
// a new AudioBuffer (see audioBufferUtils.js) and the document just moves
// its `buffer` reference forward, pushing the previous reference onto
// `history`. That is the entire undo/redo mechanism.

import { durationOf } from "./audioBufferUtils.js";

// Undo history is capped so a long editing session on a large recording
// can't grow memory without bound. This is a documented Phase 1
// limitation, not a design goal.
const MAX_HISTORY = 25;

let nextDocNumber = 1;

export class AudioDocument {
  /**
   * @param {Object} opts
   * @param {AudioBuffer} opts.buffer
   * @param {string} opts.baseName - filename without the "- AccessibleAudioStudio Pro" suffix, e.g. "Interview.wav"
   * @param {string} opts.sourceExtension - "wav" | "mp3" | "m4a" | "flac" | "ogg" | ""
   * @param {boolean} [opts.isNew] - true for a New Audio document with no source file
   * @param {string|null} [opts.sourceKey] - identifies the file this document was opened from,
   *   for already-open detection (see documentManager.js). The full file path when known
   *   (desktop build), otherwise the filename as a best-effort fallback (browser build,
   *   where the File API doesn't expose a path). null for a New Audio document.
   */
  constructor({ buffer, baseName, sourceExtension, isNew = false, sourceKey = null }) {
    this.id = "doc-" + Date.now() + "-" + Math.random().toString(16).slice(2);
    this.buffer = buffer;
    this.baseName = baseName;
    this.sourceExtension = sourceExtension || "wav";
    this.isNew = isNew;
    this.sourceKey = sourceKey;

    this.history = []; // past buffers, most recent last
    this.future = []; // buffers undone, for redo
    this.dirty = isNew; // a fresh New Audio document already has "unsaved" status

    this.selection = null; // { startSec, endSec } | null
    this.cursorSec = 0;

    this._displayNumber = isNew ? nextDocNumber++ : null;
  }

  /** Accessible document title, e.g. "Interview.wav - AccessibleAudioStudio Pro". */
  get title() {
    const name = this.baseName || `Untitled Audio ${this._displayNumber || ""}`.trim();
    const unsavedMark = this.dirty ? " (unsaved changes)" : "";
    return `${name}${unsavedMark} - AccessibleAudioStudio Pro`;
  }

  get durationSec() {
    return durationOf(this.buffer);
  }

  get sampleRate() {
    return this.buffer.sampleRate;
  }

  get numChannels() {
    return this.buffer.numberOfChannels;
  }

  /** Replace the working buffer as the result of an edit, recording undo history. */
  applyEdit(newBuffer, { clearSelection = true } = {}) {
    this.history.push(this.buffer);
    if (this.history.length > MAX_HISTORY) this.history.shift();
    this.future = [];
    this.buffer = newBuffer;
    this.dirty = true;
    if (clearSelection) this.selection = null;
    this.cursorSec = Math.min(this.cursorSec, this.durationSec);
  }

  canUndo() {
    return this.history.length > 0;
  }

  canRedo() {
    return this.future.length > 0;
  }

  undo() {
    if (!this.canUndo()) return false;
    this.future.push(this.buffer);
    this.buffer = this.history.pop();
    this.dirty = true;
    this.selection = null;
    this.cursorSec = Math.min(this.cursorSec, this.durationSec);
    return true;
  }

  redo() {
    if (!this.canRedo()) return false;
    this.history.push(this.buffer);
    this.buffer = this.future.pop();
    this.dirty = true;
    this.selection = null;
    this.cursorSec = Math.min(this.cursorSec, this.durationSec);
    return true;
  }

  markSaved() {
    this.dirty = false;
  }

  hasSelection() {
    return !!this.selection && this.selection.endSec > this.selection.startSec;
  }

  selectionDurationSec() {
    return this.hasSelection() ? this.selection.endSec - this.selection.startSec : 0;
  }

  setSelectionStart(sec) {
    const clamped = clamp(sec, 0, this.durationSec);
    const end = this.selection && this.selection.endSec > clamped ? this.selection.endSec : this.durationSec;
    this.selection = { startSec: clamped, endSec: Math.max(clamped, end) };
  }

  setSelectionEnd(sec) {
    const clamped = clamp(sec, 0, this.durationSec);
    const start = this.selection ? Math.min(this.selection.startSec, clamped) : 0;
    this.selection = { startSec: start, endSec: clamped };
  }

  selectAll() {
    this.selection = { startSec: 0, endSec: this.durationSec };
  }

  clearSelection() {
    this.selection = null;
  }

  moveCursor(deltaSec) {
    this.cursorSec = clamp(this.cursorSec + deltaSec, 0, this.durationSec);
    return this.cursorSec;
  }
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}
