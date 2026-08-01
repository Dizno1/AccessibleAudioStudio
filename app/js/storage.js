// storage.js
// Local-first persistence layer for AccessibleAudioStudio.
// Recordings (audio blobs + metadata) are stored entirely in the browser
// using IndexedDB. Nothing leaves the device. This module has no knowledge
// of the UI; it only knows how to save, list, update, and delete recordings.

const DB_NAME = "AccessibleAudioStudioDB";
const DB_VERSION = 1;
const STORE_NAME = "recordings";

let dbPromise = null;

function openDatabase() {
  if (dbPromise) return dbPromise;

  dbPromise = new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        const store = db.createObjectStore(STORE_NAME, { keyPath: "id" });
        store.createIndex("createdAt", "createdAt", { unique: false });
      }
    };

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });

  return dbPromise;
}

function generateId() {
  if (window.crypto && window.crypto.randomUUID) {
    return window.crypto.randomUUID();
  }
  return "rec-" + Date.now() + "-" + Math.random().toString(16).slice(2);
}

/**
 * Persist a new recording. The audio blob is stored exactly as produced by
 * the recording engine (original, unmodified) alongside its metadata.
 * @returns {Promise<Object>} the stored recording record
 */
export async function saveRecording({ name, durationSeconds, profileId, notes, mimeType, blob }) {
  const db = await openDatabase();
  const record = {
    id: generateId(),
    name: name && name.trim() ? name.trim() : "Untitled recording",
    createdAt: new Date().toISOString(),
    durationSeconds: Math.round(durationSeconds || 0),
    profileId,
    notes: notes || "",
    mimeType,
    blob,
  };

  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readwrite");
    tx.objectStore(STORE_NAME).add(record);
    tx.oncomplete = () => resolve(record);
    tx.onerror = () => reject(tx.error);
  });
}

/**
 * Return all recordings, most recently created first.
 */
export async function listRecordings() {
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readonly");
    const request = tx.objectStore(STORE_NAME).getAll();
    request.onsuccess = () => {
      const results = request.result || [];
      results.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
      resolve(results);
    };
    request.onerror = () => reject(request.error);
  });
}

export async function getRecording(id) {
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readonly");
    const request = tx.objectStore(STORE_NAME).get(id);
    request.onsuccess = () => resolve(request.result || null);
    request.onerror = () => reject(request.error);
  });
}

/**
 * Update editable metadata only (name, notes). Audio and creation data are
 * never modified after the fact, preserving the original recording.
 */
export async function updateRecordingMetadata(id, { name, notes }) {
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readwrite");
    const store = tx.objectStore(STORE_NAME);
    const getRequest = store.get(id);
    getRequest.onsuccess = () => {
      const record = getRequest.result;
      if (!record) {
        reject(new Error("Recording not found"));
        return;
      }
      if (typeof name === "string" && name.trim()) record.name = name.trim();
      if (typeof notes === "string") record.notes = notes;
      store.put(record);
    };
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export async function deleteRecording(id) {
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readwrite");
    tx.objectStore(STORE_NAME).delete(id);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}
