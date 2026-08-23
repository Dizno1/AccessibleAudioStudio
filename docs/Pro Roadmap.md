# AccessibleAudioStudio Pro Roadmap Status

This tracks progress against **"AccessibleAudioStudio Pro Roadmap.docx"** (the
12-phase product roadmap in this repository) and against the specific Phase 1
engineering directive that was implemented first. See `docs/Roadmap.md` for
the free AccessibleAudioStudio's own status — that application is unchanged
and still fully functional; everything below is additive.

## Phase 1 engineering milestone — Completed

The directive scoped Phase 1 to twelve specific capabilities (deliberately a
subset of the docx roadmap's Phases 1–5, so the editing foundation could ship
as one stable, testable unit before markers, processing, or professional
recording controls are touched). All twelve are implemented:

| # | Capability | Status |
|---|---|---|
| 1 | Opening existing audio | Completed |
| 2 | Opening multiple audio files at once | Completed |
| 3 | Creating a new empty audio document | Completed |
| 4 | Managing multiple open audio documents | Completed |
| 5 | Precise nonvisual audio navigation | Completed |
| 6 | Creating a time-based selection | Completed |
| 7 | Previewing that selection | Completed |
| 8 | Performing basic editing | Completed |
| 9 | Copying audio between documents | Completed |
| 10 | Automatically reconciling ordinary audio-format differences | Completed |
| 11 | Undo and redo | Completed |
| 12 | Saving the resulting audio as an ordinary audio file | Completed |

See `docs/Audio Editing (Pro).md` for exactly how each of these behaves for
a keyboard and screen reader user, and for the limitations below.

### Known limitations of this milestone

- **Decoding depends on the browser's own audio engine.** WAV always works.
  MP3, M4A, FLAC, and OGG open successfully wherever the browser (Chrome,
  Edge, Firefox, or Tauri's WebView2) can decode them; a file in a codec the
  running browser doesn't support fails to open with a specific error
  naming that file, rather than silently failing or crashing the batch.
- **Saving writes WAV or MP3 only**, per the directive ("particularly WAV
  and MP3"). A document opened from M4A, FLAC, or OGG saves as WAV instead,
  with a clear announcement that the format changed and why.
- **Save downloads a new file; it does not overwrite the original file on
  disk.** Browsers do not allow silently overwriting an arbitrary file
  outside a user-driven save dialog. "Save" downloads using the same name
  and format as the opened file (a second copy); "Save As" prompts for a
  name and format. This is a real difference from a native desktop
  editor's "Save," and is called out here so it isn't mistaken for a bug.
- **Copy/Cut/Paste use an in-application clipboard**, not the operating
  system clipboard — audio samples cannot be placed on the OS clipboard
  from a web page. Paste only works with audio cut or copied from within
  AccessibleAudioStudio Pro itself, in the same running session.
- **Undo/redo history is capped at 25 steps per document**, to bound memory
  use during a long editing session. Reaching the cap simply means the
  oldest step can no longer be undone; nothing else changes.
- **No automated tests were run against a real JAWS, NVDA, Narrator, or
  VoiceOver session** — that real screen-reader pass is expected to happen
  after this repository is returned, per the engineering directive.
  Automated checks that *were* run (axe-core against the full page,
  including every panel and form) are recorded in
  `docs/Audio Editing (Pro).md`.

## Full 12-phase roadmap status

| Phase | Name | Status |
|---|---|---|
| 1 | Pro Foundation | Completed, except "Recently opened audio" (not started — deferred) |
| 2 | Multiple Audio Files | Completed |
| 3 | Nonvisual Audio Selection | Partially completed — position, selection start/end/clear/select-all, preview, and on-demand announcements are implemented; independently extending/contracting an existing selection, and separate "play before selection"/"play after selection" commands, are not started |
| 4 | Core Editing | Partially completed — Cut, Copy, Paste, Delete, Trim to Selection, Select All, Undo, Redo are implemented; Split at current position, Duplicate selection, and Insert silence are not started |
| 5 | Seamless Format Handling | Completed for the cases named in the roadmap (sample-rate and mono/stereo reconciliation, automatic, on paste). "Advanced conversion options" for users who want explicit control are not started |
| 6 | Markers | Not started |
| 7 | Professional Recording Tools | Not started |
| 8 | Audio Processing | Not started |
| 9 | Export | Not started (Save/Save As from Phase 1 cover the ordinary-file-output requirement this phase would otherwise duplicate; a dedicated Export flow with quality/destination options is still not started) |
| 10 | Projects | Not started |
| 11 | Voice Production Profiles | Not started |
| 12 | Batch Processing | Not started |

No feature above is marked Completed unless it was actually implemented and
exercised — architecture existing for something is not treated as the
feature being done.

## Fixed — Windows desktop identity collided with the free edition

The first real Windows build of this repository succeeded, but it inherited
the free AccessibleAudioStudio's exact desktop identity (product name
`AccessibleAudioStudio`, version `1.0.0`, Tauri identifier
`org.opendoordesign.accessibleaudiostudio`, window title
`AccessibleAudioStudio`) unchanged, because adding the Audio Editor never
touched `src-tauri/`. Depending on installer behavior, installing that build
risked Windows treating it as an upgrade of, repair of, or replacement for
an existing free AccessibleAudioStudio installation, rather than a separate
application — so it was not installed.

Fixed by giving AccessibleAudioStudio Pro its own permanent desktop
identity, separate from the free edition, starting at its own version:

| Field | Free AccessibleAudioStudio | AccessibleAudioStudio Pro |
|---|---|---|
| Product name | AccessibleAudioStudio | AccessibleAudioStudio Pro |
| Tauri identifier | `org.opendoordesign.accessibleaudiostudio` | `org.opendoordesign.accessibleaudiostudio.pro` |
| Cargo/package name | `accessibleaudiostudio` | `accessibleaudiostudio-pro` |
| Window title | AccessibleAudioStudio | AccessibleAudioStudio Pro |
| Version | 1.0.0 | 0.1.0 (first Pro test build) |

Updated consistently across `src-tauri/tauri.conf.json`, `src-tauri/Cargo.toml`,
`src-tauri/capabilities/default.json`, `src-tauri/src/main.rs`, `package.json`,
`.github/workflows/build-windows.yml` (release naming, artifact label, and
tag trigger pattern — `pro-v*` alongside the existing `v*`, so a Pro tag like
`pro-v0.1.0` can never collide with a free-edition tag like `v1.0.0`), and
both `README.md` and `Release/README.md`. See `README.md`, "Application
identity" and "Pro version numbering," for the ongoing process: every
subsequent Windows test build gets its own incremented version, kept in sync
across `tauri.conf.json`, `Cargo.toml`, and `package.json` together, the same
practice already used for AccessibleScreenCapture.

Not yet done: this corrected identity has not yet been built or installed on
a real Windows machine. That's the recommended next action, ideally on a
machine that also has the free AccessibleAudioStudio installed, to directly
confirm the two coexist without collision before any further Pro testing.

## Fixed — Open Audio only opened one file from a multi-file selection (0.1.0 → 0.1.1)

Real screen reader testing of 0.1.0 found that selecting many files at once
in the Windows Open dialog (Ctrl+A across 15 files in a folder) and pressing
Open resulted in only one audio document being opened, with no error shown
for the other 14.

**Root cause:** every selected file, regardless of extension, was handed
straight to the browser's `decodeAudioData()` with no filtering. The Open
dialog's file selection itself worked correctly (`<input type="file"
multiple>` was already in place); the problem was entirely in how the
selected files were processed afterward. The files opened sequentially in
one loop, and a non-audio file partway through the selection — the test
folder included Audacity `.aup3` project files, which are not audio and
were never meant to be opened — could stall on `decodeAudioData()` without
a clean, fast rejection, which halted the rest of the batch silently rather
than skipping that one file and continuing.

**Fixed** in `app/js/audioCodec.js` and `app/js/documentManager.js`:

- Every selected file's extension is checked against an explicit
  supported-format allow-list (WAV, MP3, M4A, FLAC, OGG) **before** it is
  ever handed to the decoder. A file with any other extension — `.aup3`
  included — is sorted straight into a "skipped, unsupported" outcome and
  never touches `decodeAudioData()` at all.
- As a backstop for a file that does have a supported extension but is
  corrupt or otherwise pathological, decoding is now bounded by a 20-second
  timeout per file, so a single bad file can no longer stall the rest of a
  multi-file Open operation indefinitely.
- Every file in a selection is now sorted into exactly one of three
  outcomes — opened, skipped (unsupported), or failed (supported extension,
  decode error) — and the whole batch is reported in one single, concise
  announcement, e.g. `10 audio files opened. 5 unsupported files skipped.`
  This replaced per-file error announcements for failed files, which were
  never appropriate here per the roadmap's "do not announce every
  individual file" rule and are now folded into that same one-sentence
  summary instead.

Verified against a simulated 15-file selection matching the real test case
(10 valid files across all five supported formats, 1 corrupt-but-supported
file, 4 `.aup3` files) using mocked decode/AudioContext behavior: all 10
valid files opened as independent documents, the 4 `.aup3` files were
skipped without ever reaching the decoder, and the 1 corrupt file was
reported as failed — matching the required behavior exactly.

**Not changed, deliberately:** the "Open audio documents" combo box and the
document-switching model are untouched, so this fix can be evaluated with
several documents genuinely open at once before any decision about an
Audacity-style separate-window model.

## Recommended next phase

Real screen reader testing (JAWS, NVDA, Narrator at minimum) of everything
in this milestone, per the engineering directive. After that: markers
(Phase 6), since several editing operations here (set selection start/end,
navigate by increment) already share the underlying mechanics markers will
need, and Undo/Redo now applies just as usefully to real recordings as to
opened files.
