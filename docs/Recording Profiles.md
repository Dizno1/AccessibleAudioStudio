# Recording Profiles

Recording Profiles let a user choose how the microphone is captured without needing to understand audio engineering terms like echo cancellation or bitrate directly. Each profile is a named preset described in plain language.

The profile framework (`app/js/profiles.js`) is a single array of profile definitions. Adding a future profile means adding one entry to that array — no other module needs to change.

## Implemented in Phase 1

### Quick Note
Fast, informal capture for short ideas and reminders. Standard browser audio processing (echo cancellation, noise suppression, automatic gain control) stays on so recording starts instantly with no setup or thinking required. This is the default profile.

### Spoken Word
Optimized for clarity of speech — narration, voice notes, interviews, dictation. Noise suppression and echo cancellation are enabled and a higher bitrate than Quick Note is used, keeping spoken words clear and easy to review or (in a future phase) transcribe accurately.

### Natural Voice
Minimal audio processing, for when the recording needs to sound as close as possible to what a microphone actually picked up. Echo cancellation, noise suppression, and automatic gain control are all turned off, and the highest bitrate of the three profiles is used to preserve fidelity. Best for voice work where processing artifacts would be undesirable, or for capturing ambient/natural sound.

## Planned future profiles

Not implemented in Phase 1, but anticipated as the application grows:

- **Interview** — two-speaker optimized capture, likely paired with future marker support.
- **Music/Instrument** — wide dynamic range, processing disabled, highest available bitrate.
- **Low Bandwidth** — smaller file size for long recordings where storage space matters more than fidelity.

Each of these can be added later purely as new entries in the profile array, without changes to the Recording Engine, Device Manager, or UI.
