// audioBufferPlayer.js
// Plays an AudioBuffer (a whole document, or just a selection range)
// directly through Web Audio, independent of the <audio> element used for
// recording playback. This keeps the two playback systems (Recording
// Library vs. audio-editor documents) simple and separate rather than
// forcing one <audio> element to serve two very different jobs.

import { getAudioContext } from "./audioCodec.js";

export class BufferPlayer {
  constructor() {
    this.sourceNode = null;
    this.buffer = null;
    this.rangeStartSec = 0;
    this.rangeEndSec = 0;
    this.playbackStartedAtCtxTime = 0;
    this.playing = false;
    this.onEnded = null; // caller-supplied callback
  }

  /** Play `buffer` from `startSec` up to `endSec` (defaults to the whole buffer). */
  play(buffer, startSec = 0, endSec = null) {
    this.stop();

    const ctx = getAudioContext();
    if (ctx.state === "suspended") ctx.resume();

    const duration = buffer.length / buffer.sampleRate;
    const end = endSec == null ? duration : Math.min(endSec, duration);
    const start = Math.max(0, Math.min(startSec, end));

    const node = ctx.createBufferSource();
    node.buffer = buffer;
    node.connect(ctx.destination);
    node.onended = () => {
      if (this.sourceNode === node) {
        this.playing = false;
        this.sourceNode = null;
        if (this.onEnded) this.onEnded();
      }
    };
    node.start(0, start, Math.max(0.001, end - start));

    this.sourceNode = node;
    this.buffer = buffer;
    this.rangeStartSec = start;
    this.rangeEndSec = end;
    this.playbackStartedAtCtxTime = ctx.currentTime;
    this.playing = true;
  }

  stop() {
    if (this.sourceNode) {
      try {
        this.sourceNode.onended = null;
        this.sourceNode.stop();
      } catch (e) {
        // already stopped; nothing to do
      }
      this.sourceNode = null;
    }
    this.playing = false;
  }

  isPlaying() {
    return this.playing;
  }

  /** Current playback position within the buffer, in seconds. */
  getPositionSec() {
    if (!this.playing) return this.rangeStartSec;
    const ctx = getAudioContext();
    const elapsed = ctx.currentTime - this.playbackStartedAtCtxTime;
    return Math.min(this.rangeEndSec, this.rangeStartSec + elapsed);
  }

  /**
   * Plays a short, self-stopping clip starting at `atSec` — the actual
   * audible-feedback mechanism behind Stage 1's U/I scrubbing (see the
   * Pro Roadmap, Stage 1). This is genuine audio content at the new
   * position, not a silent playhead jump: the user hears real samples
   * from the document at exactly where the playhead just moved to,
   * which is what "audible" means for locating an acoustic boundary
   * (the start of a word, a breath, a transient) by ear.
   *
   * Deliberately not a claim of continuous, real-time, pitch-preserved
   * scrub audio the way a professional NLE's mouse-drag scrub works —
   * that would need a materially different, granular playback engine.
   * A short clip per discrete keyboard step is what the specified
   * increments (1 second / 100 ms / 10 ms steps) actually call for, and
   * is achievable with this existing buffer-source-based player with no
   * engine changes.
   *
   * Any in-progress ordinary playback (Space/X) is stopped first, so a
   * scrub clip never overlaps with document playback — the scrub clip
   * itself does not call the caller's onEnded callback, since it isn't
   * "the document stopped playing," just a brief audible preview.
   */
  scrubClip(buffer, atSec, clipLengthSec = 0.2) {
    this.stop();

    const ctx = getAudioContext();
    if (ctx.state === "suspended") ctx.resume();

    const duration = buffer.length / buffer.sampleRate;
    const start = Math.max(0, Math.min(atSec, duration));
    const end = Math.min(duration, start + Math.max(0.001, clipLengthSec));

    const node = ctx.createBufferSource();
    node.buffer = buffer;
    node.connect(ctx.destination);
    node.start(0, start, Math.max(0.001, end - start));
    // Deliberately no node.onended handling and no this.sourceNode
    // assignment — a scrub clip is a brief, fire-and-forget preview, not
    // a playback session this.isPlaying()/getPositionSec() should ever
    // report as in progress.
  }
}
