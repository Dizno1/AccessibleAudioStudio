# AccessibleAudioStudio

A professional, browser-based audio recording environment designed from the ground up for keyboard users and screen reader users — fully usable by everyone.

Accessibility is not a layer added on top here. It is the architecture. See `docs/Screen Reader First Principles.md` for the non-negotiable rules every feature follows, and `docs/Vision.md` for the long-term direction.

## Status: Phase 1 complete

Phase 1 objective: allow a user to confidently create a high-quality recording, entirely from the keyboard, entirely through a screen reader.

A user can currently:

- Enable microphone access and choose a specific microphone
- Choose a Recording Profile (Quick Note, Spoken Word, Natural Voice)
- Start, pause, resume, and stop a recording
- Save a recording with a name and optional notes
- Play back any saved recording — play/pause, restart, skip forward/backward, jump to beginning/end
- Browse, rename, annotate, download, and delete recordings in the Recording Library
- Do all of the above with visible buttons or with global keyboard shortcuts

See `docs/Roadmap.md` for the complete list of what was built, known limitations, and the recommended next phase.

## Running the app

This is a static, dependency-free browser application — no build step, no server required.

Open `index.html` directly in a modern browser (Chrome, Edge, or Firefox recommended), or serve the folder with any static file server, for example:

```
python3 -m http.server 8000
```

then visit `http://localhost:8000`.

All recordings are stored locally in the browser via IndexedDB. Nothing is uploaded anywhere.

## Project structure

```
index.html                 Application shell
app/css/styles.css         Stylesheet (cosmetic only -- page is fully usable without it)
app/js/
  main.js                  Orchestrates all modules and DOM events
  deviceManager.js         Microphone discovery, permissions, capability detection
  recordingEngine.js       MediaRecorder-based recording state machine
  playback.js              Keyboard-accessible playback controller
  storage.js               IndexedDB persistence for recordings + metadata
  library.js               Accessible rendering of the Recording Library
  profiles.js              Recording Profile definitions
  shortcutService.js       Centralized global keyboard shortcut service
  announcer.js             ARIA live region status/alert announcements
  timeFormat.js             Natural-language duration/date formatting
docs/
  Vision.md
  Screen Reader First Principles.md
  Recording Profiles.md
  Roadmap.md
audio/                     Reserved for future local export/output use
assets/                    Reserved for future static assets
tests/                     Reserved for future automated tests
```

## Keyboard shortcuts

| Shortcut | Action |
|---|---|
| Ctrl+Alt+R | Start or Stop Recording (toggle, like the record button on a physical recorder) |
| Ctrl+Alt+Space | Pause or Resume Recording |
| Ctrl+Alt+P | Play or Pause the selected recording |

Shortcuts are suspended while typing in a text field. Every visible button remains fully functional at all times -- shortcuts are a supplement, never a replacement.

If a shortcut doesn't seem to work, the "Keyboard Shortcut Diagnostics" panel at the bottom of the page reports the last shortcut the app detected and what happened as a result -- useful for telling apart a keystroke that never reached the app from one that reached it but had nothing to do yet.

## Recommended next phase

Phase 2 -- editing foundations (trimming and markers), built non-destructively on top of the original recording. See `docs/Roadmap.md` for details.
