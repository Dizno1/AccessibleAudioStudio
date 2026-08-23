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
}
