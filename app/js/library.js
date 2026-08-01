// library.js
// Renders the Recording Library as a plain, semantic list — no waveform,
// no visual timeline. Each recording is a list item with a heading, a
// natural-language metadata description, and clearly labeled action
// buttons (Select for Playback, Rename, Edit Notes, Download, Delete).
//
// Every action button's accessible name includes the recording's own name
// (e.g. "Select second test for playback", "Rename second test") so a
// screen reader user browsing many controls in a row — or jumping to one
// directly by name — always knows which recording a control belongs to.
// Proximity to a heading is never relied on for this.
//
// Rendering is non-destructive: existing DOM elements are reused and only
// updated where something actually changed, rather than being torn down
// and rebuilt on every call. This matters for two concrete reasons —
//  1. A screen reader only announces a native toggle button's updated
//     pressed/not-pressed state if the SAME element the user just
//     activated is still in the DOM afterward. Recreating it from scratch
//     produces a brand-new element that was never "activated," so nothing
//     gets announced.
//  2. Recreating unrelated, unchanged list items on every render is
//     needless churn and risks disrupting focus.

import { getProfileById } from "./profiles.js";
import { formatDurationNatural, formatDateNatural } from "./timeFormat.js";

// Tracks the DOM elements already built for each recording id, so repeat
// calls can update in place instead of rebuilding.
const itemRefs = new Map();
let listEl = null;

function setTextIfChanged(el, text) {
  if (el.textContent !== text) el.textContent = text;
}

function createItem(rec, handlers) {
  const li = document.createElement("li");
  li.className = "recording-item";
  li.dataset.recordingId = rec.id;

  const heading = document.createElement("h3");
  heading.className = "recording-item__name";
  li.appendChild(heading);

  const meta = document.createElement("p");
  meta.className = "recording-item__meta";
  li.appendChild(meta);

  const notes = document.createElement("p");
  notes.className = "recording-item__notes";
  // Not attached until there's actually a note to show; see updateItem.

  const actions = document.createElement("div");
  actions.className = "recording-item__actions";

  const selectBtn = document.createElement("button");
  selectBtn.type = "button";
  // The name stays constant regardless of selection state; aria-pressed
  // alone communicates pressed/not pressed, matching how a screen reader
  // announces a native toggle button — which only works because this
  // exact button element is reused across renders rather than recreated.
  selectBtn.addEventListener("click", () => handlers.onSelect(rec.id));
  actions.appendChild(selectBtn);

  const renameBtn = document.createElement("button");
  renameBtn.type = "button";
  renameBtn.addEventListener("click", () => handlers.onRename(rec.id));
  actions.appendChild(renameBtn);

  const notesBtn = document.createElement("button");
  notesBtn.type = "button";
  notesBtn.addEventListener("click", () => handlers.onEditNotes(rec.id));
  actions.appendChild(notesBtn);

  const downloadBtn = document.createElement("a");
  downloadBtn.className = "button-link";
  // Created once per recording — the underlying audio blob never changes
  // after save, so there's no reason to mint (and leak) a new object URL
  // on every render.
  downloadBtn.href = URL.createObjectURL(rec.blob);
  actions.appendChild(downloadBtn);

  const deleteBtn = document.createElement("button");
  deleteBtn.type = "button";
  deleteBtn.addEventListener("click", () => handlers.onDelete(rec.id));
  actions.appendChild(deleteBtn);

  li.appendChild(actions);

  return { li, heading, meta, notes, actions, selectBtn, renameBtn, notesBtn, downloadBtn, deleteBtn };
}

function updateItem(refs, rec, selectedId, disableSelection) {
  const isSelected = rec.id === selectedId;

  if (isSelected) {
    refs.li.classList.add("recording-item--selected");
  } else {
    refs.li.classList.remove("recording-item--selected");
  }

  setTextIfChanged(refs.heading, rec.name);

  const profile = getProfileById(rec.profileId);
  const metaText =
    `Recorded ${formatDateNatural(rec.createdAt)}. ` +
    `Duration: ${formatDurationNatural(rec.durationSeconds)}. ` +
    `Profile: ${profile.name}.` +
    (isSelected ? " Currently selected for playback." : "");
  setTextIfChanged(refs.meta, metaText);

  if (rec.notes) {
    setTextIfChanged(refs.notes, `Notes: ${rec.notes}`);
    if (!refs.notes.isConnected) {
      refs.li.insertBefore(refs.notes, refs.actions);
    }
  } else if (refs.notes.isConnected) {
    refs.notes.remove();
  }

  const selectLabel = `Select ${rec.name} for playback`;
  if (refs.selectBtn.textContent !== selectLabel) refs.selectBtn.textContent = selectLabel;
  const pressedValue = isSelected ? "true" : "false";
  if (refs.selectBtn.getAttribute("aria-pressed") !== pressedValue) {
    refs.selectBtn.setAttribute("aria-pressed", pressedValue);
  }
  if (refs.selectBtn.disabled !== !!disableSelection) {
    refs.selectBtn.disabled = !!disableSelection;
  }

  setTextIfChanged(refs.renameBtn, `Rename ${rec.name}`);
  setTextIfChanged(refs.notesBtn, `Edit notes for ${rec.name}`);

  const downloadLabel = `Download ${rec.name}`;
  if (refs.downloadBtn.textContent !== downloadLabel) refs.downloadBtn.textContent = downloadLabel;
  const downloadName = sanitizeFileName(rec.name) + extensionForMimeType(rec.mimeType);
  if (refs.downloadBtn.download !== downloadName) refs.downloadBtn.download = downloadName;

  setTextIfChanged(refs.deleteBtn, `Delete ${rec.name}`);
}

/**
 * @param {HTMLElement} container - element to render the list into
 * @param {Array} recordings - records from storage.listRecordings()
 * @param {Object} handlers - { onSelect(id), onRename(id), onEditNotes(id), onDelete(id) }
 * @param {string|null} selectedId - currently selected recording id, if any
 * @param {Object} [options]
 * @param {boolean} [options.disableSelection] - true while a recording is being reviewed/saved,
 *   so the user must resolve it (Save/Record Again/Discard) before switching playback selection
 */
export function renderLibrary(container, recordings, handlers, selectedId, options = {}) {
  const disableSelection = !!options.disableSelection;

  if (!recordings || recordings.length === 0) {
    for (const refs of itemRefs.values()) {
      URL.revokeObjectURL(refs.downloadBtn.href);
    }
    itemRefs.clear();
    listEl = null;
    if (!container.dataset.libraryState || container.dataset.libraryState !== "empty") {
      container.innerHTML = "";
      const empty = document.createElement("p");
      empty.textContent = "Your recording library is empty. Recordings you save will appear here.";
      container.appendChild(empty);
      container.dataset.libraryState = "empty";
    }
    return;
  }

  if (!listEl || !listEl.isConnected) {
    container.innerHTML = "";
    listEl = document.createElement("ul");
    listEl.className = "recording-list";
    listEl.setAttribute("aria-label", "Saved recordings");
    container.appendChild(listEl);
    container.dataset.libraryState = "populated";
  }

  const seenIds = new Set();

  recordings.forEach((rec) => {
    seenIds.add(rec.id);
    let refs = itemRefs.get(rec.id);
    if (!refs) {
      refs = createItem(rec, handlers);
      itemRefs.set(rec.id, refs);
    }
    updateItem(refs, rec, selectedId, disableSelection);
    // appendChild on an element already in the DOM moves it rather than
    // recreating it, so this both (re)establishes correct order and
    // never disturbs elements that didn't move.
    listEl.appendChild(refs.li);
  });

  for (const [id, refs] of itemRefs) {
    if (!seenIds.has(id)) {
      URL.revokeObjectURL(refs.downloadBtn.href);
      refs.li.remove();
      itemRefs.delete(id);
    }
  }
}

function sanitizeFileName(name) {
  return (name || "recording").replace(/[^a-z0-9\-_ ]/gi, "").trim() || "recording";
}

function extensionForMimeType(mimeType) {
  if (!mimeType) return ".webm";
  if (mimeType.includes("webm")) return ".webm";
  if (mimeType.includes("ogg")) return ".ogg";
  if (mimeType.includes("mp4")) return ".m4a";
  return ".audio";
}
