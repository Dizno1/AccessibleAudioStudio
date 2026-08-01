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

import { getProfileById } from "./profiles.js";
import { formatDurationNatural, formatDateNatural } from "./timeFormat.js";

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
  container.innerHTML = "";

  if (!recordings || recordings.length === 0) {
    const empty = document.createElement("p");
    empty.textContent = "Your recording library is empty. Recordings you save will appear here.";
    container.appendChild(empty);
    return;
  }

  const list = document.createElement("ul");
  list.className = "recording-list";
  list.setAttribute("aria-label", "Saved recordings");

  recordings.forEach((rec) => {
    const item = document.createElement("li");
    item.className = "recording-item";
    if (rec.id === selectedId) {
      item.classList.add("recording-item--selected");
    }

    const heading = document.createElement("h3");
    heading.className = "recording-item__name";
    heading.textContent = rec.name;
    item.appendChild(heading);

    const profile = getProfileById(rec.profileId);
    const meta = document.createElement("p");
    meta.className = "recording-item__meta";
    meta.textContent =
      `Recorded ${formatDateNatural(rec.createdAt)}. ` +
      `Duration: ${formatDurationNatural(rec.durationSeconds)}. ` +
      `Profile: ${profile.name}.` +
      (rec.id === selectedId ? " Currently selected for playback." : "");
    item.appendChild(meta);

    if (rec.notes) {
      const notes = document.createElement("p");
      notes.className = "recording-item__notes";
      notes.textContent = `Notes: ${rec.notes}`;
      item.appendChild(notes);
    }

    const actions = document.createElement("div");
    actions.className = "recording-item__actions";

    const selectBtn = document.createElement("button");
    selectBtn.type = "button";
    // The name stays constant regardless of selection state; aria-pressed
    // alone communicates pressed/not pressed, matching how a screen reader
    // announces a native toggle button.
    selectBtn.textContent = `Select ${rec.name} for playback`;
    selectBtn.setAttribute("aria-pressed", rec.id === selectedId ? "true" : "false");
    selectBtn.disabled = !!options.disableSelection;
    selectBtn.addEventListener("click", () => handlers.onSelect(rec.id));
    actions.appendChild(selectBtn);

    const renameBtn = document.createElement("button");
    renameBtn.type = "button";
    renameBtn.textContent = `Rename ${rec.name}`;
    renameBtn.addEventListener("click", () => handlers.onRename(rec.id, rec.name));
    actions.appendChild(renameBtn);

    const notesBtn = document.createElement("button");
    notesBtn.type = "button";
    notesBtn.textContent = `Edit notes for ${rec.name}`;
    notesBtn.addEventListener("click", () => handlers.onEditNotes(rec.id, rec.notes));
    actions.appendChild(notesBtn);

    const downloadBtn = document.createElement("a");
    downloadBtn.textContent = `Download ${rec.name}`;
    downloadBtn.href = URL.createObjectURL(rec.blob);
    downloadBtn.download = sanitizeFileName(rec.name) + extensionForMimeType(rec.mimeType);
    downloadBtn.className = "button-link";
    actions.appendChild(downloadBtn);

    const deleteBtn = document.createElement("button");
    deleteBtn.type = "button";
    deleteBtn.textContent = `Delete ${rec.name}`;
    deleteBtn.addEventListener("click", () => handlers.onDelete(rec.id, rec.name));
    actions.appendChild(deleteBtn);

    item.appendChild(actions);
    list.appendChild(item);
  });

  container.appendChild(list);
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
