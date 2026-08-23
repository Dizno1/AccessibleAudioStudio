// audioCodec.js
// The only module that talks to the browser's audio decoder and to the
// vendored MP3 encoder. Everything else in the editor works with plain
// AudioBuffer objects and never needs to know how a file was read or how
// it will be written.
//
// Decoding: the browser's built-in decodeAudioData() is used for every
// supported input format (WAV, MP3, M4A, FLAC, OGG — see
// SUPPORTED_AUDIO_EXTENSIONS below). This is what lets "Open Audio" accept
// a mix of those formats in one operation without any format-specific
// code here — whatever the browser's audio engine can decode, this app
// can open. A file whose extension isn't on that list is never handed to
// the decoder at all (see isSupportedAudioExtension); a file that IS a
// supported extension but still fails to decode is reported as a normal
// per-file failure by the caller (see documentManager.js).
//
// Encoding: WAV is written directly (uncompressed PCM, a well-documented
// and completely reliable format to hand-produce). MP3 is written using
// the vendored lamejs encoder (see app/js/vendor). These are the two
// initial Save/Save As targets called for in this phase.

let sharedAudioContext = null;

/** One shared AudioContext for decoding and format-reconciliation rendering. */
export function getAudioContext() {
  if (!sharedAudioContext) {
    const Ctx = window.AudioContext || window.webkitAudioContext;
    sharedAudioContext = new Ctx();
  }
  return sharedAudioContext;
}

/** Guess a practical file-extension category from a filename, for format decisions. */
export function extensionOf(filename) {
  const match = /\.([a-z0-9]+)$/i.exec(filename || "");
  return match ? match[1].toLowerCase() : "";
}

// The only audio formats this app knows how to open, per the Pro roadmap.
// Anything else — including non-audio files that merely sit in the same
// folder a user is opening from, like an Audacity .aup3 project file — is
// filtered out by name before it ever reaches the decoder, rather than
// being handed to decodeAudioData and hoping it fails cleanly. That
// matters because decodeAudioData's behavior on genuinely non-audio input
// is not reliably a quick, clean rejection across every engine this app
// runs on — treating "supported audio file" as an explicit allow-list is
// both simpler and safer than treating "decode succeeded" as the only
// signal.
export const SUPPORTED_AUDIO_EXTENSIONS = ["wav", "mp3", "m4a", "flac", "ogg"];

export function isSupportedAudioExtension(filename) {
  return SUPPORTED_AUDIO_EXTENSIONS.includes(extensionOf(filename));
}

// A hard ceiling on how long a single file is allowed to take to decode.
// Without this, one unusually malformed file partway through a
// multi-file Open operation could stall the entire batch indefinitely —
// every file after it would simply never open, with nothing visibly
// wrong. The extension allow-list above prevents the common case (a
// non-audio file); this is the backstop for a file that has an audio
// extension but is corrupt or otherwise pathological.
const DECODE_TIMEOUT_MS = 20000;

function withTimeout(promise, ms, timeoutMessage) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(timeoutMessage)), ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (err) => {
        clearTimeout(timer);
        reject(err);
      }
    );
  });
}

/**
 * Decode a File/Blob into an AudioBuffer.
 * @returns {Promise<AudioBuffer>}
 */
export async function decodeAudioFile(file) {
  const arrayBuffer = await file.arrayBuffer();
  const ctx = getAudioContext();
  // decodeAudioData's callback form is used instead of the promise form
  // only where broader engine support matters; the promise form is
  // supported everywhere this app targets (Chrome, Edge, Firefox, and
  // Tauri's WebView2), so it is used directly here.
  return withTimeout(
    ctx.decodeAudioData(arrayBuffer.slice(0)),
    DECODE_TIMEOUT_MS,
    "This file took too long to decode and was skipped."
  );
}

// ---------------------------------------------------------------------
// WAV encoding (16-bit PCM)
// ---------------------------------------------------------------------

/**
 * Encode an AudioBuffer as a 16-bit PCM WAV file.
 * @returns {Blob}
 */
export function encodeWav(audioBuffer) {
  const numChannels = audioBuffer.numberOfChannels;
  const sampleRate = audioBuffer.sampleRate;
  const numFrames = audioBuffer.length;
  const bytesPerSample = 2;
  const blockAlign = numChannels * bytesPerSample;
  const dataSize = numFrames * blockAlign;

  const buffer = new ArrayBuffer(44 + dataSize);
  const view = new DataView(buffer);

  writeString(view, 0, "RIFF");
  view.setUint32(4, 36 + dataSize, true);
  writeString(view, 8, "WAVE");
  writeString(view, 12, "fmt ");
  view.setUint32(16, 16, true); // PCM fmt chunk size
  view.setUint16(20, 1, true); // PCM format
  view.setUint16(22, numChannels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * blockAlign, true); // byte rate
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, 16, true); // bits per sample
  writeString(view, 36, "data");
  view.setUint32(40, dataSize, true);

  const channelData = [];
  for (let c = 0; c < numChannels; c++) {
    channelData.push(audioBuffer.getChannelData(c));
  }

  let offset = 44;
  for (let i = 0; i < numFrames; i++) {
    for (let c = 0; c < numChannels; c++) {
      const sample = Math.max(-1, Math.min(1, channelData[c][i]));
      const intSample = sample < 0 ? sample * 0x8000 : sample * 0x7fff;
      view.setInt16(offset, intSample, true);
      offset += 2;
    }
  }

  return new Blob([buffer], { type: "audio/wav" });
}

function writeString(view, offset, str) {
  for (let i = 0; i < str.length; i++) {
    view.setUint8(offset + i, str.charCodeAt(i));
  }
}

// ---------------------------------------------------------------------
// MP3 encoding (via vendored lamejs)
// ---------------------------------------------------------------------

/**
 * Encode an AudioBuffer as an MP3 file.
 * @param {AudioBuffer} audioBuffer
 * @param {number} bitrateKbps default 192
 * @returns {Blob}
 */
export function encodeMp3(audioBuffer, bitrateKbps = 192) {
  if (!window.lamejs) {
    throw new Error("The MP3 encoder did not load. Try saving as WAV instead.");
  }

  // lamejs only encodes mono or stereo; anything else is mixed down to
  // stereo first via the same reconciliation path used for cross-document
  // paste, so this stays a single, well-tested code path.
  const numChannels = Math.min(2, audioBuffer.numberOfChannels);
  const sampleRate = audioBuffer.sampleRate;
  const encoder = new window.lamejs.Mp3Encoder(numChannels, sampleRate, bitrateKbps);

  const left = floatTo16BitPCM(audioBuffer.getChannelData(0));
  const right = numChannels === 2 ? floatTo16BitPCM(audioBuffer.getChannelData(1)) : null;

  const chunks = [];
  const sampleBlockSize = 1152;

  for (let i = 0; i < left.length; i += sampleBlockSize) {
    const leftChunk = left.subarray(i, i + sampleBlockSize);
    let mp3buf;
    if (numChannels === 2) {
      const rightChunk = right.subarray(i, i + sampleBlockSize);
      mp3buf = encoder.encodeBuffer(leftChunk, rightChunk);
    } else {
      mp3buf = encoder.encodeBuffer(leftChunk);
    }
    if (mp3buf.length > 0) chunks.push(new Int8Array(mp3buf));
  }

  const finalBuf = encoder.flush();
  if (finalBuf.length > 0) chunks.push(new Int8Array(finalBuf));

  return new Blob(chunks, { type: "audio/mp3" });
}

function floatTo16BitPCM(floatArray) {
  const out = new Int16Array(floatArray.length);
  for (let i = 0; i < floatArray.length; i++) {
    const s = Math.max(-1, Math.min(1, floatArray[i]));
    out[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
  }
  return out;
}
