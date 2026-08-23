# Audio Editing (Pro)

This describes the new "Audio Editor (Pro)" panel added in the Phase 1
engineering milestone (see `docs/Pro Roadmap.md`). It follows the same
Screen Reader First rules as the rest of AccessibleAudioStudio — see
`docs/Screen Reader First Principles.md` — and does not change anything
about the existing recording workflow (Microphone Setup, Recording,
Playback, Recording Library are untouched).

## Where it lives

A new panel, "Audio Editor (Pro)," sits below the Recording Library on the
existing single page. A user who only wants to record never has to enter
it — it starts collapsed to just two buttons (Open Audio, New Audio) and a
status line ("No audio documents are open."). The full editing controls
(navigation, selection, edit commands, save) only appear once at least one
audio document is open — progressive disclosure, not a second application
bolted on.

## Opening audio

"Open Audio" (button or Ctrl+O) opens the operating system's standard file
picker via a native `<input type="file" multiple>`, which is what actually
produces the real Windows file-selection dialog in the packaged desktop
app. WAV, MP3, M4A, FLAC, and OGG can all be selected together in one
operation. Each file that opens successfully becomes its own audio
document; a file that fails to decode is reported individually by name
("Could not open 'x.m4a'. …") without blocking the other files in the same
selection from opening.

"New Audio" (button or Ctrl+N) creates an empty audio document immediately,
for assembling audio from other documents via copy/paste.

## Multiple documents

Open documents appear in a single labeled dropdown ("Open audio
documents"). Selecting a different one switches the active document; every
editing command always acts on whichever document is currently active.
Each document's accessible title follows the roadmap's exact convention,
e.g. "Interview.wav - AccessibleAudioStudio Pro" — and while a document has
unsaved changes, its title also says so: "Interview.wav (unsaved changes) -
AccessibleAudioStudio Pro". The browser/window title bar mirrors whichever
document is currently active, so a screen reader user gets the same
information a sighted user would get from a window title.

Closing a document with unsaved changes asks for confirmation
(`window.confirm`) before discarding them, consistent with how the
existing recording workflow already confirms Delete and Record Again.

## Navigation and selection

Position and selection are always spoken as natural language with
millisecond precision, exactly as specified in the roadmap:

> Selection start: 1 minute 14.250 seconds.
> Selection end: 1 minute 22.700 seconds.
> Selection duration: 8.450 seconds.

Six navigation buttons move the current position by the roadmap's minimum
increment set — Back/Forward 10 Seconds, 1 Second, and 100 Milliseconds —
plus Jump to Beginning and Jump to End. Each move announces the resulting
position once, concisely (just the time — not while audio is actually
playing, per "do not continuously announce position information while
audio is playing"). Position is also available on demand at any time via
"Announce Current Position," without needing to move first.

Set Selection Start / Set Selection End set a boundary at the current
position; Select All and Clear Selection are separate explicit commands.
"Announce Selection" reads back start, end, and duration together, in the
exact phrasing shown above. Preview Selection plays only the selected
range and stops automatically at its end.

## Editing

Cut, Copy, Paste, Delete Selection, Trim to Selection, Undo, and Redo are
implemented as both buttons and the standard Windows shortcuts (Ctrl+X/C/V,
Ctrl+Z, Ctrl+Y) specified in the roadmap's Keyboard Philosophy — no new
shortcut vocabulary was invented. Every announcement is one short sentence
("Selection cut.", "Edit undone."), matching the roadmap's example list.

Copying between documents works exactly as the roadmap describes: select
part of one document, Copy or Cut, switch documents (or create a New
Audio document), Paste. If the copied audio's sample rate or channel count
doesn't match the destination document, it is converted automatically and
announced once — "Audio converted to match destination." — never as a
technical dialog the user has to resolve.

## Saving

Save (Ctrl+S) and Save As (Ctrl+Shift+S) both produce an ordinary WAV or
MP3 file via a normal browser download — never a proprietary project
format for an ordinary edit. See the "Known limitations" section in
`docs/Pro Roadmap.md` for exactly how this differs from a native desktop
app's in-place Save, and for the M4A/FLAC/OGG-source behavior.

## Automated accessibility verification performed

Run against the full `index.html`, with every normally-hidden panel and
form shown (so the Audio Editor's controls were included, not just the
default view):

- **axe-core**, WCAG 2 A/AA + best-practice rules, via a headless
  `jsdom` page load: **0 violations across 35 passing rule checks.**
- Manual review: no duplicate element IDs anywhere in `index.html`; heading
  hierarchy is a clean h1 → h2 (per panel) → h3 (per editor subsection) →
  h4 (Save As form only) with no skipped levels; every new interactive
  control is a real `<button>`, `<select>`, `<label>`-linked `<input>`, or
  the file input, so no ARIA `role` overrides were needed anywhere in this
  panel; every button whose purpose isn't obvious from its own label
  (navigation increments, Save vs. Save As) has a plain-language label
  rather than a symbol or abbreviation.

**Not verified in this environment** (no real browser, no real screen
reader, no real display available): JAWS, NVDA, Narrator, or VoiceOver
testing; 400%/zoom and 320px/280px reflow; Windows forced-colors mode.
These are the same categories of gap already tracked for Phase 1 of the
free app in `docs/Roadmap.md`, and now apply to this panel too.
