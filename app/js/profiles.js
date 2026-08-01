// profiles.js
// Recording Profile framework. Each profile is a named preset that
// controls how the microphone stream is captured. The list here is the
// single source of truth for Phase 1's three profiles; future profiles are
// added by appending to this array, not by redesigning the engine.

export const PROFILES = [
  {
    id: "quick-note",
    name: "Quick Note",
    description:
      "Fast, informal capture for short ideas and reminders. Standard browser audio processing is left on so recording starts instantly with no setup.",
    constraints: {
      echoCancellation: true,
      noiseSuppression: true,
      autoGainControl: true,
    },
    audioBitsPerSecond: 96000,
  },
  {
    id: "spoken-word",
    name: "Spoken Word",
    description:
      "Optimized for clarity of speech: narration, notes, interviews, and dictation. Noise suppression and echo cancellation are enabled to keep the voice clear.",
    constraints: {
      echoCancellation: true,
      noiseSuppression: true,
      autoGainControl: true,
    },
    audioBitsPerSecond: 128000,
  },
  {
    id: "natural-voice",
    name: "Natural Voice",
    description:
      "Minimal audio processing to preserve the most natural, unprocessed sound. Best when the recording needs to capture voice or ambient sound as faithfully as possible.",
    constraints: {
      echoCancellation: false,
      noiseSuppression: false,
      autoGainControl: false,
    },
    audioBitsPerSecond: 192000,
  },
];

export function getProfileById(id) {
  return PROFILES.find((p) => p.id === id) || PROFILES[0];
}

export const DEFAULT_PROFILE_ID = PROFILES[0].id;
