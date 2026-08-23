// audioBufferUtils.js
// Pure functions that operate on AudioBuffer objects. None of these
// mutate the buffer they're given — each returns a brand-new AudioBuffer.
// That single rule is what makes undo/redo simple elsewhere: an
// AudioDocument's history is just a list of AudioBuffer references, since
// nothing already in the list is ever changed after the fact.
//
// This is also where routine format differences are reconciled, using the
// browser's own audio engine (OfflineAudioContext) to resample and to mix
// channel counts, rather than hand-written signal processing.

import { getAudioContext } from "./audioCodec.js";

/** Create a new empty AudioBuffer at a given sample rate/channel count. */
export function createEmptyBuffer(sampleRate, numChannels) {
  const ctx = getAudioContext();
  return ctx.createBuffer(numChannels, 1, sampleRate);
}

/** Total duration of a buffer, in seconds. */
export function durationOf(buffer) {
  return buffer.length / buffer.sampleRate;
}

function secondsToFrame(buffer, seconds) {
  return Math.max(0, Math.min(buffer.length, Math.round(seconds * buffer.sampleRate)));
}

/** Return a new AudioBuffer containing only [startSec, endSec) of the source. */
export function sliceBuffer(buffer, startSec, endSec) {
  const ctx = getAudioContext();
  const startFrame = secondsToFrame(buffer, startSec);
  const endFrame = Math.max(startFrame, secondsToFrame(buffer, endSec));
  const length = Math.max(1, endFrame - startFrame);

  const out = ctx.createBuffer(buffer.numberOfChannels, length, buffer.sampleRate);
  for (let c = 0; c < buffer.numberOfChannels; c++) {
    const src = buffer.getChannelData(c).subarray(startFrame, startFrame + length);
    out.getChannelData(c).set(src);
  }
  return out;
}

/** Return a new AudioBuffer with [startSec, endSec) removed. */
export function deleteRange(buffer, startSec, endSec) {
  const before = sliceBuffer(buffer, 0, startSec);
  const after = sliceBuffer(buffer, endSec, durationOf(buffer));
  const beforeHasContent = startSec > 0;
  const afterHasContent = endSec < durationOf(buffer);

  if (!beforeHasContent && !afterHasContent) {
    return createEmptyBuffer(buffer.sampleRate, buffer.numberOfChannels);
  }
  if (!beforeHasContent) return after;
  if (!afterHasContent) return before;
  return concatBuffers(before, after);
}

/** Return a new AudioBuffer with `insertBuffer` spliced in at `atSec`. */
export function insertBufferAt(destBuffer, insertBuffer, atSec) {
  const before = sliceBuffer(destBuffer, 0, atSec);
  const after = sliceBuffer(destBuffer, atSec, durationOf(destBuffer));
  const hasBefore = atSec > 0;
  const hasAfter = atSec < durationOf(destBuffer);

  let result = insertBuffer;
  if (hasBefore) result = concatBuffers(before, result);
  if (hasAfter) result = concatBuffers(result, after);
  return result;
}

/** Concatenate two AudioBuffers of the same sample rate and channel count. */
export function concatBuffers(a, b) {
  const ctx = getAudioContext();
  const numChannels = Math.max(a.numberOfChannels, b.numberOfChannels);
  const sampleRate = a.sampleRate;
  const out = ctx.createBuffer(numChannels, a.length + b.length, sampleRate);
  for (let c = 0; c < numChannels; c++) {
    const channel = out.getChannelData(c);
    channel.set(a.numberOfChannels > c ? a.getChannelData(c) : a.getChannelData(0), 0);
    channel.set(b.numberOfChannels > c ? b.getChannelData(c) : b.getChannelData(0), a.length);
  }
  return out;
}

/**
 * Reconcile `sourceBuffer` to the sample rate and channel count of
 * `destSampleRate`/`destChannels`, if it doesn't already match. Returns
 * the original buffer unchanged when no conversion is needed, so callers
 * can tell whether a conversion actually happened.
 * @returns {Promise<{buffer: AudioBuffer, converted: boolean}>}
 */
export async function reconcileToDestination(sourceBuffer, destSampleRate, destChannels) {
  const needsResample = sourceBuffer.sampleRate !== destSampleRate;
  const needsRemix = sourceBuffer.numberOfChannels !== destChannels;

  if (!needsResample && !needsRemix) {
    return { buffer: sourceBuffer, converted: false };
  }

  const duration = sourceBuffer.length / sourceBuffer.sampleRate;
  const targetLength = Math.max(1, Math.ceil(duration * destSampleRate));

  const OfflineCtx = window.OfflineAudioContext || window.webkitOfflineAudioContext;
  const offline = new OfflineCtx(destChannels, targetLength, destSampleRate);

  const source = offline.createBufferSource();
  source.buffer = sourceBuffer;
  // Connecting a source with a different channel count than the
  // destination triggers the browser's own standard up/down-mix (mono to
  // stereo duplicates the channel; stereo to mono averages the channels),
  // which is why no custom channel-mixing code is written here.
  source.connect(offline.destination);
  source.start(0);

  const rendered = await offline.startRendering();
  return { buffer: rendered, converted: true };
}

/** Deep-enough copy of an AudioBuffer (used only where a source must be preserved independently). */
export function cloneBuffer(buffer) {
  const ctx = getAudioContext();
  const out = ctx.createBuffer(buffer.numberOfChannels, buffer.length, buffer.sampleRate);
  for (let c = 0; c < buffer.numberOfChannels; c++) {
    out.getChannelData(c).set(buffer.getChannelData(c));
  }
  return out;
}
