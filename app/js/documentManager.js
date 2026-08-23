// documentManager.js
// Owns the set of currently-open AudioDocuments and which one is active.
// Nothing in here touches the DOM — audioEditorController.js reads this
// module's state and renders it.

import { AudioDocument } from "./audioDocument.js";
import { decodeAudioFile, extensionOf, isSupportedAudioExtension } from "./audioCodec.js";
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
 * The key used to detect "this source file is already open." The full
 * file path when one is known (desktop build, via the Tauri file dialog —
 * see readTauriPathAsFile in audioEditorController.js, which stamps a
 * `__sourcePath` property onto the File it constructs), otherwise the
 * filename alone as a best-effort fallback. Browser File objects never
 * expose a real path (a deliberate browser security restriction), so
 * filename-only matching is the documented limitation of the fallback
 * path — it can't distinguish two different files that happen to share a
 * name in different folders, but it does catch the exact case reported:
 * opening the same file twice.
 */
function sourceKeyOf(file) {
  return file.__sourcePath || file.name;
}

/**
 * Given a candidate list of files, split them into files that are new
 * (safe to open immediately) and files that match the source of a
 * document already open (need the user's decision before opening again).
 * Only supported-extension files are considered — an unsupported file is
 * never a "duplicate", it's just unsupported.
 * @param {File[]} files
 * @returns {{newFiles: File[], alreadyOpen: File[]}}
 */
function partitionByAlreadyOpen(files) {
  const openKeys = new Set(documents.map((d) => d.sourceKey).filter(Boolean));
  const newFiles = [];
  const alreadyOpen = [];
  for (const file of files) {
    if (isSupportedAudioExtension(file.name) && openKeys.has(sourceKeyOf(file))) {
      alreadyOpen.push(file);
    } else {
      newFiles.push(file);
    }
  }
  return { newFiles, alreadyOpen };
}

/**
 * Open one or more audio files as new documents, in a single operation.
 * Every file is sorted into exactly one of four outcomes:
 *   - opened: a supported audio file that decoded successfully and is now
 *     its own audio document.
 *   - failed: a file with a supported extension that still failed to
 *     decode (e.g. corrupt).
 *   - skipped: a file whose extension isn't one this app can open at all
 *     (an Audacity .aup3 project file, for example). These are never
 *     handed to the decoder in the first place — see
 *     isSupportedAudioExtension in audioCodec.js — specifically so that
 *     one unsupported file in a folder full of audio can never stall or
 *     block the rest of the selection from opening.
 *   - alreadyOpen: a supported file whose source matches a document
 *     that's already open. These are never silently opened as a second
 *     copy — the caller (audioEditorController.js) is responsible for
 *     asking the user and, if confirmed, calling openFiles again on just
 *     these files with `allowDuplicates: true`.
 * @param {FileList|File[]} files
 * @param {Object} [options]
 * @param {boolean} [options.allowDuplicates] - when true, skips the
 *   already-open check entirely (used for the confirmed "open another
 *   copy" pass). Every file is treated as new.
 * @returns {Promise<{opened: AudioDocument[], failed: {file: File, error: Error}[], skipped: File[], alreadyOpen: File[]}>}
 */
export async function openFiles(files, { allowDuplicates = false } = {}) {
  const fileArray = Array.from(files);
  const { newFiles, alreadyOpen } = allowDuplicates
    ? { newFiles: fileArray, alreadyOpen: [] }
    : partitionByAlreadyOpen(fileArray);

  const opened = [];
  const failed = [];
  const skipped = [];

  for (const file of newFiles) {
    if (!isSupportedAudioExtension(file.name)) {
      skipped.push(file);
      continue;
    }

    try {
      const buffer = await decodeAudioFile(file);
      const baseName = generateUniqueBaseName(file.name);
      const doc = new AudioDocument({
        buffer,
        baseName,
        sourceExtension: extensionOf(file.name) || "wav",
        sourceKey: sourceKeyOf(file),
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

  return { opened, failed, skipped, alreadyOpen };
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
