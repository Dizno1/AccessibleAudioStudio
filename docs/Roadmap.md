# Roadmap

## Status: Phase 1 complete, plus two accessibility refinement passes

Phase 1 delivers a dependable, fully keyboard- and screen-reader-accessible recording foundation. Nothing beyond recording, playback, and library management is in scope yet — by design. Two follow-up refinement passes (below) corrected a real keyboard-shortcut bug, substantially reduced how much the application speaks automatically, and eliminated focus/DOM instability that was causing extra screen-reader chatter beyond the application's own announcements.

### Completed in Phase 1

**Application shell**
- Semantic landmark structure (`header`, `main`, sectioned `panel`s, `footer`), logical heading hierarchy, skip link, responsive single-column layout.
- Two ARIA live regions (`polite` for status, `assertive` for errors) drive all dynamic announcements. Automatic live announcements are limited to a fixed whitelist — see `docs/Screen Reader First Principles.md`, "Silence Is an Accessibility Feature."

**Audio Device Manager** (`app/js/deviceManager.js`)
- Browser capability detection (`getUserMedia`, `MediaRecorder`, supported MIME type, `IndexedDB`) reported to the user rather than assumed.
- Microphone permission request, device enumeration, and selection.
- Recording-readiness status communicated in plain text.

**Recording Engine** (`app/js/recordingEngine.js`)
- Explicit state machine (idle → recording → paused → stopped) built on `MediaRecorder`, guarding against invalid transitions.
- Start, Pause, Resume, and Stop are implemented. Stopping does not save automatically — see "Review before saving" below.
- Start and Stop are now one persistent button (`record-toggle-button`) that relabels itself in place ("Start Recording" ↔ "Stop Recording") rather than swapping between two separate buttons via disable/enable. The microphone and profile selectors are also left enabled throughout recording. Both changes exist for the same reason: disabling whatever control currently has focus forces the browser to move focus away and often causes assistive tech to re-announce surrounding landmark/region context — noise the user never asked for. See "Focus & DOM stability" below.

**Review before saving** (`app/js/main.js`)
- When a recording stops, it is never saved sight-unseen: the user can listen to it immediately, using the ordinary Playback controls, before naming it or deciding whether to keep it.
- Stopping announces once, "Recording stopped." (the fuller "Ready for review" context is visible text, readable on demand), moves focus to the Play button, and does not auto-play.
- Three decisions are offered: **Save Recording** (only now does the app ask for a name — with a useful default — and notes), **Record Again** (confirms with "Record again and discard the current recording?" before discarding), and **Discard Recording**.
- While a recording is under review, the record toggle button is disabled and the Recording Library's "Select for Playback" controls are disabled, so what's loaded for playback can never silently drift from what the user is actually reviewing. This disabling happens alongside the one deliberate focus move in this flow (to the Play button) — never on its own as an incidental side effect.

**Focus & DOM stability** (`app/js/main.js`, `app/js/library.js`)
- Once recording or playback begins, whatever control had focus keeps it until the user moves it themselves, or takes an action that deliberately hands focus somewhere else (like Stop moving focus to Play — an established, intentional exception). Nothing is disabled, destroyed, or rebuilt as an incidental side effect of a state change.
- Concretely: the record toggle button is never disabled while a recording is starting or stopping (only relabeled), and the microphone/profile selectors are never disabled during recording — disabling either risks yanking focus off whichever one the user was just on, which reliably produces the "browser re-announces the region/landmark" noise that has nothing to do with the application's own announcements.
- The Recording Library (see below) updates existing DOM elements in place rather than tearing sections down and rebuilding them, for the same reason.
- No routine recording or playback event uses a browser-level dialog or notification. The only native dialogs in the app (`window.confirm`/`window.prompt` for Rename, Edit Notes, Delete, and Record Again) are deliberate, infrequent library-management actions — never triggered automatically and never used for the moment-to-moment recording/playback flow. The one unavoidable browser-native prompt is the microphone permission request, which is a one-time part of initial setup, not a routine event.

**Playback** (`app/js/playback.js`)
- Play/Pause, Restart, Skip Forward, Skip Backward, Jump to Beginning, Jump to End — all keyboard operable through standard buttons.
- No waveform or visual timeline. Position/duration are exposed only as natural-language text, and only on demand (an explicit "Announce Current Position" control). Only Play and Pause announce automatically; Restart, Skip, Jump, and reaching the end of a recording change the Play/Pause button's own label but say nothing extra.
- Ctrl+Alt+P (and the Play/Pause button) act on the current unsaved recording when one is under review, otherwise on whichever saved recording is selected in the library. If neither exists, it announces "No recording is available for playback." rather than doing nothing silently.

**Recording Library** (`app/js/library.js`, `app/js/storage.js`)
- Recordings persist locally in IndexedDB (Local First) with name, creation date, duration, recording profile, and notes.
- Rename, edit notes, download, select-for-playback, and delete, all through plain semantic controls.
- Every action button's accessible name includes the recording's own name (e.g. "Select second test for playback", "Rename second test", "Delete second test") so a screen reader user always knows which recording a control belongs to, without relying on proximity to a heading. The select control communicates state entirely through `aria-pressed` — its name doesn't change between "Select" and "Selected," and there is no separate "selected for playback" announcement layered on top, since a native toggle button's own pressed-state feedback already covers it.
- Rendering is non-destructive: re-rendering the library updates only the text/attributes that changed on existing elements rather than tearing the whole list down and rebuilding it. This is what makes the native pressed-state announcement above actually work (the element the user just activated has to still be the same element afterward), and it also means renaming or adding notes no longer regenerates unrelated list items or their object URLs.
- Original recorded audio is never modified after save (Preserve Original Recordings) — only metadata is editable.

**Recording Profiles** (`app/js/profiles.js`)
- Quick Note, Spoken Word, and Natural Voice implemented as data-driven presets. See `docs/Recording Profiles.md`.
- The profile selector announces only the chosen profile's name during ordinary navigation (no `aria-describedby` link to the full description). The description remains as ordinary visible text immediately after the selector, reachable on demand by continuing to read past it.

**Keyboard shortcuts** (`app/js/shortcutService.js`)
- Centralized shortcut service with a single configuration array, rather than per-component key handlers.
- Ctrl+Alt+R toggles recording (Start when idle, Stop when recording or paused) — deliberately mirroring the single record button on a physical recorder rather than separate start/stop keys. Ctrl+Alt+Space (Pause/Resume), Ctrl+Alt+P (Play/Pause).
- Shortcuts are suspended only while focus is in a literal text-entry field (`input`, `textarea`, or a content-editable element) — not a `<select>`, which has no typing to protect. This fixed a real bug: Ctrl+Alt+R wasn't reliably starting a recording because focus is commonly left on the microphone or profile dropdown right before recording, and the previous check suppressed shortcuts there too. Visible buttons remain fully functional at all times and display their shortcut in their label.
- Reserved (not yet wired to keys) future actions are declared in the same module: previous/next/insert marker, restart playback, skip forward/backward, jump to beginning/end, trim start/end, normalize audio, export recording. Adding real shortcuts for these later is a configuration change, not a redesign.

**Keyboard Shortcut Diagnostics** (`app/js/shortcutDiagnostics.js`)
- A small always-on diagnostic panel (under a "Keyboard Shortcut Diagnostics (Help)" disclosure in the footer) reports the last shortcut the app detected, whether an action executed, and why not if it didn't.
- Every recognized key combination is reported to this module by the shortcut service — including the case where it was suppressed because focus was in a text field — so a shortcut that "does nothing" can be told apart from one that never reached the app at all.

### Known limitations at the end of Phase 1

- Audio format depends on what the browser's `MediaRecorder` supports (typically WebM/Opus in Chrome, Edge, and Firefox). No server-side transcoding exists yet.
- No editing, trimming, or markers — intentionally deferred.
- No transcription, AI features, cloud sync, or VoiceOfOpenDoor integration — intentionally deferred.
- Rename and notes editing currently use the browser's native prompt dialog for simplicity; a fully in-page accessible form may replace this in a later phase if user feedback calls for it.
- Ctrl+Alt+P (Play/Pause) was reported as not firing during initial testing. Two related root causes have since been fixed (the `<select>` suppression bug, and disabling controls that could hold focus), which plausibly explains the original report — but it hasn't been explicitly retested since these fixes landed. Worth confirming with the Keyboard Shortcut Diagnostics panel.

## Planned future phases (not yet scheduled)

These are directional, not committed:

- **Phase 2 — Editing foundations:** trimming, markers (previous/next/insert), non-destructive edit history, still screen-reader-first with no waveform interaction required.
- **Phase 3 — Transcription:** on-device or opt-in cloud transcription, transcript displayed and navigable as text.
- **Phase 4 — Audio enhancement:** normalization, noise reduction as an explicit, reviewable action (never automatic/invisible).
- **Phase 5 — VoiceOfOpenDoor integration:** connecting recorded material to Open Door Design's synthetic voice project where relevant.
- **Ongoing — Customizable shortcuts:** a settings UI reading and writing the shortcut configuration described above.

## Recommended next phase

**Phase 2: Editing foundations (trimming and markers)**, building directly on the reserved shortcut actions and the "Preserve Original Recordings" principle — edits should be represented as non-destructive instructions layered on top of the original audio, never as in-place modification of the saved recording.
