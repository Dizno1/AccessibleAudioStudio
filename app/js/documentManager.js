// documentManager.js
// Owns the set of currently-open AudioDocuments and which one is active.
// Nothing in here touches the DOM — audioEditorController.js reads this
// module's state and renders it.

import { AudioDocument } from "./audioDocument.js";
import { decodeAudioFile, extensionOf } from "./audioCodec.js";
import { createEmptyBuffer } from "./audioBufferUtils.js";

const documents = []; // open AudioDocument instances, in open order
let activeId = null;

export function getDocuments() {
  return documents;
}

export function getActiveDocument() {
  return documents.find((d) => d.id === activeId) || null;
}

export function setActiveDocument(id) {
  if (documents.some((d) => d.id === id)) {
    activeId = id;
    return true;
  }
  return false;
}

/**
 * Open one or more audio files as new documents. Files that fail to
 * decode are reported individually rather than aborting the whole batch —
 * opening five WAVs and one corrupt MP3 should still open the five WAVs.
 * @param {FileList|File[]} files
 * @returns {Promise<{opened: AudioDocument[], failed: {file: File, error: Error}[]}>}
 */
export async function openFiles(files) {
  const opened = [];
  const failed = [];

  for (const file of Array.from(files)) {
    try {
      const buffer = await decodeAudioFile(file);
      const baseName = generateUniqueBaseName(file.name);
      const doc = new AudioDocument({
        buffer,
        baseName,
        sourceExtension: extensionOf(file.name) || "wav",
      });
      documents.push(doc);
      opened.push(doc);
    } catch (err) {
      failed.push({ file, error: err });
    }
  }

  if (opened.length > 0) {
    activeId = opened[opened.length - 1].id;
  }

  return { opened, failed };
}

/** Create a new empty audio document. Matches the currently-active document's format if one exists, otherwise CD-quality stereo defaults. */
export function createNewDocument() {
  const active = getActiveDocument();
  const sampleRate = active ? active.sampleRate : 44100;
  const numChannels = active ? active.numChannels : 2;
  const buffer = createEmptyBuffer(sampleRate, numChannels);

  const doc = new AudioDocument({
    buffer,
    baseName: null,
    sourceExtension: "wav",
    isNew: true,
  });
  documents.push(doc);
  activeId = doc.id;
  return doc;
}

/** Close a document. Returns false without closing if it has unsaved changes and `force` is not set. */
export function closeDocument(id, { force = false } = {}) {
  const doc = documents.find((d) => d.id === id);
  if (!doc) return { closed: false, reason: "not-found" };
  if (doc.dirty && !force) return { closed: false, reason: "unsaved-changes" };

  const index = documents.indexOf(doc);
  documents.splice(index, 1);

  if (activeId === id) {
    const next = documents[index] || documents[index - 1] || null;
    activeId = next ? next.id : null;
  }

  return { closed: true };
}

export function documentCount() {
  return documents.length;
}

/** Append " (2)", " (3)", etc. before the extension if the name is already in use, so every open document's title stays unique. */
function generateUniqueBaseName(originalName) {
  const inUse = new Set(documents.map((d) => d.baseName).filter(Boolean));
  if (!inUse.has(originalName)) return originalName;

  const dotIndex = originalName.lastIndexOf(".");
  const stem = dotIndex > -1 ? originalName.slice(0, dotIndex) : originalName;
  const ext = dotIndex > -1 ? originalName.slice(dotIndex) : "";

  let n = 2;
  let candidate = `${stem} (${n})${ext}`;
  while (inUse.has(candidate)) {
    n += 1;
    candidate = `${stem} (${n})${ext}`;
  }
  return candidate;
}
