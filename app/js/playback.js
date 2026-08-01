// playback.js
// Fully keyboard-accessible playback controller wrapping a single
// <audio> element. No waveform, no visual timeline — position and
// duration are only ever communicated as natural-language text, and only
// on demand (never as a continuously-updating live announcement).

import { formatDurationNatural } from "./timeFormat.js";

const SKIP_SECONDS = 10;

export class PlaybackController {
  constructor(audioElement) {
    this.audio = audioElement;
    this._objectUrl = null;
  }

  /** Load a recording's blob for playback. Does not start playing. */
  load(blob) {
    this._revokeCurrentUrl();
    this._objectUrl = URL.createObjectURL(blob);
    this.audio.src = this._objectUrl;
  }

  clear() {
    this._revokeCurrentUrl();
    this.audio.removeAttribute("src");
    this.audio.load();
  }

  _revokeCurrentUrl() {
    if (this._objectUrl) {
      URL.revokeObjectURL(this._objectUrl);
      this._objectUrl = null;
    }
  }

  hasSource() {
    return !!this.audio.src;
  }

  play() {
    return this.audio.play();
  }

  pause() {
    this.audio.pause();
  }

  get isPlaying() {
    return !this.audio.paused && !this.audio.ended;
  }

  togglePlayPause() {
    if (this.isPlaying) {
      this.pause();
      return "paused";
    } else {
      this.play();
      return "playing";
    }
  }

  restart() {
    this.audio.currentTime = 0;
    this.play();
  }

  skipForward(seconds = SKIP_SECONDS) {
    const max = isFinite(this.audio.duration) ? this.audio.duration : Infinity;
    this.audio.currentTime = Math.min(this.audio.currentTime + seconds, max);
  }

  skipBackward(seconds = SKIP_SECONDS) {
    this.audio.currentTime = Math.max(this.audio.currentTime - seconds, 0);
  }

  jumpToBeginning() {
    this.audio.currentTime = 0;
  }

  jumpToEnd() {
    if (isFinite(this.audio.duration)) {
      this.audio.currentTime = this.audio.duration;
    }
  }

  /** Natural-language "current position of total duration" for on-demand reading. */
  getPositionDescription() {
    const current = formatDurationNatural(this.audio.currentTime || 0);
    const total = isFinite(this.audio.duration)
      ? formatDurationNatural(this.audio.duration)
      : "unknown duration";
    return `${current} of ${total}`;
  }
}
