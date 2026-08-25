# Audio Editing (Pro)

This describes the "Audio Editor" as of the 0.2.0 architectural rebuild
(see `docs/Pro Roadmap.md` for the full history and rationale). It
follows the same Screen Reader First rules as the rest of
AccessibleAudioStudio — see `docs/Screen Reader First Principles.md` —
and does not change anything about the existing recording workflow
(Microphone Setup, Recording, Playback, Recording Library are untouched).

**This document supersedes its own earlier version.** Every previous
description here assumed a single page privately managing several open
documents behind a combo box. That architecture no longer exists. If
you're looking for how document-switching used to work in 0.1.x, see the
0.1.x entries in `docs/Pro Roadmap.md` instead — this file only describes
what's actually in the app now.

## Two kinds of windows

AccessibleAudioStudio Pro is two kinds of windows, not one page:

- **The main window** is the persistent **Recording Studio** —
  Microphone Setup, Recording, Playback, and the Recording Library,
  exactly as in the free edition, plus two buttons: Open Audio and New
  Audio. It stays open the whole time you use the app.
- **Every open audio document is its own separate window** — a real
  operating-system window, not a tab or a panel. Open two files and you
  get two windows, each with its own complete set of editing controls,
  each independently closable, each with its own window title carrying
  that document's filename.

There is no document-switching control inside the app anywhere. Alt+Tab
— the same keystroke you'd use to switch to any other running
application — is how you move between the Recording Studio and any open
editor window. This is a deliberate design decision, not a missing
feature: Alt+Tab is already familiar to a keyboard and screen reader
user, and a window's own title is a more reliable, more visible signal
of "which document is this" than an in-page status line ever was.

## Opening audio

"Open Audio" (button or Ctrl+O, in the Recording Studio window) opens the
real native Windows file picker. WAV, MP3, M4A, FLAC, and OGG can be
selected together in one operation. Every supported file selected opens
as its own new editor window, titled with its filename:

> Interview.mp3 - AccessibleAudioStudio Pro

An unsupported file (an Audacity `.aup3` project file, for example) is
skipped — no window is ever created for it — without blocking any other
selected file from opening. The Open Audio Diagnostics panel (in the
Recording Studio window's footer) reports how many editor windows opened
and how many files were skipped, for troubleshooting a selection that
didn't produce everything you expected.

"New Audio" (button or Ctrl+N, also in the Recording Studio window)
opens one new, empty editor window, titled:

> Untitled Audio 1 - AccessibleAudioStudio Pro

A second New Audio creates "Untitled Audio 2," and so on, numbered across
the whole running application rather than per-window.

## Inside an editor window

Everything below happens inside one editor window, and applies only to
that window's own document — there's no cross-document state inside an
editor window at all (the one deliberate exception is the shared
clipboard, described below).

### Navigation and selection

Position and selection are always spoken as natural language with
millisecond precision:

> Selection start: 1 minute 14.250 seconds.
> Selection end: 1 minute 22.700 seconds.
> Selection duration: 8.450 seconds.

Six navigation buttons move the current position by 10 Seconds, 1
Second, or 100 Milliseconds, forward or back, plus Jump to Beginning and
Jump to End. Each move announces the resulting position once, concisely
(not continuously, and never while audio is actually playing). Position
is also available on demand at any time via "Announce Current Position."

Set Selection Start / Set Selection End set a boundary at the current
position; Select All and Clear Selection are separate explicit commands.
"Announce Selection" reads back start, end, and duration together.
Preview Selection plays only the selected range and stops automatically
at its end.

### Editing

Cut, Copy, Paste, Delete Selection, Trim to Selection, Undo, and Redo are
implemented as both buttons and the standard Windows shortcuts (Ctrl+X/
C/V, Ctrl+Z, Ctrl+Y) — no new shortcut vocabulary. Every announcement is
one short sentence ("Selection cut.", "Edit undone.").

### Copying between documents — now across windows

Copy or Cut audio in one editor window, Alt+Tab to a different editor
window (or a New Audio window), Paste. This works because Copy/Cut now
store the audio in a small piece of shared state on the Rust side (see
`SharedAudioClipboard` in `docs/Pro Roadmap.md`), not in a JavaScript
variable local to one page — which is what makes it possible at all, now
that each document is a genuinely separate webview with no shared memory
of its own. If the copied audio's sample rate or channel count doesn't
match the destination document, it's converted automatically and
announced once — "Audio converted to match destination." — never as a
technical dialog to resolve.

### Saving

Save (Ctrl+S) and Save As (Ctrl+Shift+S) both produce an ordinary WAV or
MP3 file via a normal browser download — never a proprietary project
format for an ordinary edit. A document opened from M4A, FLAC, or OGG
saves as WAV instead, with a clear announcement explaining why.

## Known limitations of this architecture

Stated directly, matching `docs/Pro Roadmap.md`'s own account of what
0.2.0 deliberately does not solve:

- **Opening the same file twice creates two independent editor windows**,
  silently. 0.1.x could detect "this file is already open" within one
  page managing several documents; each document now being a separate
  window with its own JavaScript runtime means this would need its own
  shared cross-window state (the same category of mechanism the
  clipboard uses), which wasn't built as part of this milestone.
- **Closing an editor window with unsaved changes doesn't ask first.**
  0.1.x confirmed before discarding unsaved edits; native window closing
  isn't currently intercepted to do the same. Save your work with Ctrl+S
  before closing a window you've been editing.
- **The Explorer-copy-paste multi-file workflow** (copy files in File
  Explorer, switch to this app, paste into the Open dialog's File Name
  field) is unchanged from 0.1.10 and still has an open, unresolved
  question about why the clipboard's `CF_HDROP` data reports unavailable
  at that point — see `docs/Pro Roadmap.md`. Selecting files directly
  inside the native Open dialog is unaffected and works normally.

## Automated accessibility verification performed

Run against both `index.html` (Recording Studio) and `editor.html`
(editor window), with every normally-hidden panel and form shown:

- **axe-core**, WCAG 2 A/AA + best-practice rules, via a headless
  `jsdom` page load: **0 violations across 36 passing rule checks, on
  each page.**
- Manual review: no duplicate element IDs within either page; each page
  has exactly one `<h1>`; heading hierarchy has no skipped levels; no
  explicit ARIA `region` role exists anywhere in either page (matching
  this app's simplified landmark structure — see `docs/Pro Roadmap.md`'s
  0.1.2 entry for why); every interactive control is a real `<button>`,
  `<select>`, or `<label>`-linked `<input>`.

**Not verified in this environment** (no real browser, no real screen
reader, no real display, and — new to this specific architecture — no
way to create or manage a real multi-window desktop application at all):
JAWS, NVDA, Narrator, or VoiceOver testing; whether Alt+Tab and window
titles genuinely behave the way this document describes on real Windows;
400%/zoom and 320px/280px reflow; Windows forced-colors mode. See
`docs/Pro Roadmap.md`'s status table for exactly which of the 0.2.0
acceptance-test points are `Implemented` versus `Windows build verified`
versus `Screen-reader verified.`
