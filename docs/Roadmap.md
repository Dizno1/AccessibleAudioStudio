# Roadmap

## Status: Phase 1 complete

Phase 1 delivers a dependable, fully keyboard- and screen-reader-accessible recording foundation. Nothing beyond recording, playback, and library management is in scope yet — by design.

### Completed in Phase 1

**Application shell**
- Semantic landmark structure (`header`, `main`, sectioned `panel`s, `footer`), logical heading hierarchy, skip link, responsive single-column layout.
- Two ARIA live regions (`polite` for status, `assertive` for errors) drive all dynamic announcements. Updates are announced only on meaningful state changes — never continuously.

**Audio Device Manager** (`app/js/deviceManager.js`)
- Browser capability detection (`getUserMedia`, `MediaRecorder`, supported MIME type, `IndexedDB`) reported to the user rather than assumed.
- Microphone permission request, device enumeration, and selection.
- Recording-readiness status communicated in plain text.

**Recording Engine** (`app/js/recordingEngine.js`)
- Explicit state machine (idle → recording → paused → stopped) built on `MediaRecorder`, guarding against invalid transitions.
- Start, Pause, Resume, and Stop are implemented. Stopping does not save automatically — see "Review before saving" below.

**Review before saving** (`app/js/main.js`)
- When a recording stops, it is never saved sight-unseen: the user can listen to it immediately, using the ordinary Playback controls, before naming it or deciding whether to keep it.
- Stopping announces once, "Recording stopped. Ready for review," moves focus to the Play button, and does not auto-play.
- Three decisions are offered: **Save Recording** (only now does the app ask for a name and notes — with a useful default name — and notes), **Record Again** (confirms with "Record again and discard the current recording?" before discarding), and **Discard Recording**.
- While a recording is under review, Start Recording is disabled and the Recording Library's "Select for Playback" controls are disabled, so what's loaded for playback can never silently drift from what the user is actually reviewing.

**Playback** (`app/js/playback.js`)
- Play/Pause, Restart, Skip Forward, Skip Backward, Jump to Beginning, Jump to End — all keyboard operable through standard buttons.
- No waveform or visual timeline. Position/duration are exposed only as natural-language text, and only on demand (an explicit "Announce Current Position" control), never as a running commentary.
- Ctrl+Alt+P (and the Play/Pause button) act on the current unsaved recording when one is under review, otherwise on whichever saved recording is selected in the library. If neither exists, it announces "No recording is available for playback." rather than doing nothing silently.

**Recording Library** (`app/js/library.js`, `app/js/storage.js`)
- Recordings persist locally in IndexedDB (Local First) with name, creation date, duration, recording profile, and notes.
- Rename, edit notes, download, select-for-playback, and delete, all through plain semantic controls.
- Every action button's accessible name includes the recording's own name (e.g. "Select second test for playback", "Rename second test", "Delete second test") so a screen reader user always knows which recording a control belongs to, without relying on proximity to a heading. The select control communicates state entirely through `aria-pressed` — its name doesn't change between "Select" and "Selected."
- Original recorded audio is never modified after save (Preserve Original Recordings) — only metadata is editable.

**Recording Profiles** (`app/js/profiles.js`)
- Quick Note, Spoken Word, and Natural Voice implemented as data-driven presets. See `docs/Recording Profiles.md`.

**Keyboard shortcuts** (`app/js/shortcutService.js`)
- Centralized shortcut service with a single configuration array, rather than per-component key handlers.
- Ctrl+Alt+R toggles recording (Start when idle, Stop when recording or paused) — deliberately mirroring the single record button on a physical recorder rather than separate start/stop keys. Ctrl+Alt+Space (Pause/Resume), Ctrl+Alt+P (Play/Pause).
- Shortcuts are suspended automatically while focus is in an editable field; visible buttons remain fully functional at all times and display their shortcut in their label.
- Reserved (not yet wired to keys) future actions are declared in the same module: previous/next/insert marker, restart playback, skip forward/backward, jump to beginning/end, trim start/end, normalize audio, export recording. Adding real shortcuts for these later is a configuration change, not a redesign.

**Keyboard Shortcut Diagnostics** (`app/js/shortcutDiagnostics.js`)
- A small always-on diagnostic panel (under a "Keyboard Shortcut Diagnostics (Help)" disclosure in the footer) reports the last shortcut the app detected, whether an action executed, and why not if it didn't.
- Every recognized key combination is reported to this module by the shortcut service — including the case where it was suppressed because focus was in a text field — so a shortcut that "does nothing" can be told apart from one that never reached the app at all.

### Known limitations at the end of Phase 1

- Audio format depends on what the browser's `MediaRecorder` supports (typically WebM/Opus in Chrome, Edge, and Firefox). No server-side transcoding exists yet.
- No editing, trimming, or markers — intentionally deferred.
- No transcription, AI features, cloud sync, or VoiceOfOpenDoor integration — intentionally deferred.
- Rename and notes editing currently use the browser's native prompt dialog for simplicity; a fully in-page accessible form may replace this in a later phase if user feedback calls for it.
- Ctrl+Alt+P (Play/Pause) was reported as not firing during initial testing. Its priority logic and "no recording available" messaging are now clarified, but the original report of the keystroke not being detected at all is still unconfirmed either way — pending a retest using the Keyboard Shortcut Diagnostics panel.

## Planned future phases (not yet scheduled)

These are directional, not committed:

- **Phase 2 — Editing foundations:** trimming, markers (previous/next/insert), non-destructive edit history, still screen-reader-first with no waveform interaction required.
- **Phase 3 — Transcription:** on-device or opt-in cloud transcription, transcript displayed and navigable as text.
- **Phase 4 — Audio enhancement:** normalization, noise reduction as an explicit, reviewable action (never automatic/invisible).
- **Phase 5 — VoiceOfOpenDoor integration:** connecting recorded material to Open Door Design's synthetic voice project where relevant.
- **Ongoing — Customizable shortcuts:** a settings UI reading and writing the shortcut configuration described above.

## Recommended next phase

**Phase 2: Editing foundations (trimming and markers)**, building directly on the reserved shortcut actions and the "Preserve Original Recordings" principle — edits should be represented as non-destructive instructions layered on top of the original audio, never as in-place modification of the saved recording.
