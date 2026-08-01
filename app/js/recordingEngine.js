// recordingEngine.js
// Wraps the browser MediaRecorder API in a small, reliable state machine.
// Recording reliability is the highest priority for this module: state
// transitions are explicit and guarded so a mis-timed call (e.g. pause
// while idle) fails safely instead of corrupting a recording.

export const RecordingState = Object.freeze({
  IDLE: "idle",
  RECORDING: "recording",
  PAUSED: "paused",
  STOPPED: "stopped",
});

export class RecordingEngine {
  /**
   * @param {MediaStream} stream - an already-open microphone stream
   * @param {string} mimeType - a MediaRecorder.isTypeSupported()-verified type
   * @param {number} [audioBitsPerSecond]
   */
  constructor(stream, mimeType, audioBitsPerSecond) {
    this.state = RecordingState.IDLE;
    this.mimeType = mimeType;
    this.chunks = [];
    this._startedAt = null;
    this._accumulatedMs = 0;

    const options = { mimeType };
    if (audioBitsPerSecond) options.audioBitsPerSecond = audioBitsPerSecond;

    this.recorder = new MediaRecorder(stream, options);

    this.recorder.ondataavailable = (event) => {
      if (event.data && event.data.size > 0) {
        this.chunks.push(event.data);
      }
    };
  }

  start() {
    if (this.state !== RecordingState.IDLE) {
      throw new Error("Cannot start: recording is not idle.");
    }
    this.chunks = [];
    this._accumulatedMs = 0;
    this._startedAt = Date.now();
    this.recorder.start();
    this.state = RecordingState.RECORDING;
  }

  pause() {
    if (this.state !== RecordingState.RECORDING) {
      throw new Error("Cannot pause: not currently recording.");
    }
    this.recorder.pause();
    this._accumulatedMs += Date.now() - this._startedAt;
    this._startedAt = null;
    this.state = RecordingState.PAUSED;
  }

  resume() {
    if (this.state !== RecordingState.PAUSED) {
      throw new Error("Cannot resume: recording is not paused.");
    }
    this.recorder.resume();
    this._startedAt = Date.now();
    this.state = RecordingState.RECORDING;
  }

  /**
   * Stop recording and resolve with the final audio Blob and duration.
   * @returns {Promise<{blob: Blob, durationSeconds: number}>}
   */
  stop() {
    if (this.state !== RecordingState.RECORDING && this.state !== RecordingState.PAUSED) {
      throw new Error("Cannot stop: no active recording.");
    }
    return new Promise((resolve, reject) => {
      this.recorder.onstop = () => {
        if (this._startedAt !== null) {
          this._accumulatedMs += Date.now() - this._startedAt;
          this._startedAt = null;
        }
        const blob = new Blob(this.chunks, { type: this.mimeType });
        const durationSeconds = this._accumulatedMs / 1000;
        this.state = RecordingState.STOPPED;
        resolve({ blob, durationSeconds });
      };
      this.recorder.onerror = (event) => reject(event.error || new Error("Recording failed."));
      this.recorder.stop();
    });
  }

  getElapsedSeconds() {
    let ms = this._accumulatedMs;
    if (this.state === RecordingState.RECORDING && this._startedAt !== null) {
      ms += Date.now() - this._startedAt;
    }
    return ms / 1000;
  }
}
