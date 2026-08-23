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

## Fixed — 0.1.2: the 0.1.1 Open Audio fix wasn't enough, plus duplicate handling and a standards pass

Real screen reader testing of 0.1.1 found multi-file Open Audio was
**still** only opening one file. That's a genuine finding, not a retest of
the same bug: the 0.1.1 fix corrected real problems in how selected files
were *processed* (extension filtering, a decode timeout), verified with
unit tests against mocked File objects — but those tests never exercised
the actual native file-selection mechanism itself, which is exactly what
testing on real Windows/WebView2 caught. Per the correction directive,
this fix does not lean on another round of the same kind of unit test to
call it done — see "What's actually verified" below.

**Root cause:** the app was relying on an HTML `<input type="file"
multiple>` inside the packaged WebView2 app to produce the native Windows
multi-select dialog. That mechanism is a known weak point for multi-file
selection specifically inside embedded webviews (Tauri/WebView2), as
opposed to a full browser tab — Tauri's own documentation recommends its
native dialog plugin for exactly this reason. The HTML input's `multiple`
attribute and the file-processing code behind it were correct; the
selection mechanism above them was not reliable in this runtime.

**Fixed** in `app/js/audioEditorController.js`, `src-tauri/Cargo.toml`,
`src-tauri/src/main.rs`, and `src-tauri/capabilities/default.json`:

- "Open Audio" now calls Tauri's native dialog plugin
  (`window.__TAURI__.dialog.open({ multiple: true, ... })`) directly when
  running in the packaged desktop app, which invokes the real Windows
  picker through Tauri/Rust rather than through the webview's own HTML
  input handling. Selected paths are read into real `File` objects via the
  Tauri fs plugin (`window.__TAURI__.fs.readFile`), then handed to the
  exact same `documentManager.openFiles()` pipeline the HTML-input path
  already used and that 0.1.1 hardened — so extension filtering, the
  decode timeout, and the one-line completion announcement all apply
  identically regardless of which picker was used.
- The HTML `<input type="file" multiple>` fallback is kept, but now used
  only when no Tauri runtime is present (e.g. this same app running as a
  plain web page on GitHub Pages).
- `app.withGlobalTauri` enabled in `tauri.conf.json` so the frontend can
  call `window.__TAURI__.dialog` / `.fs` directly with no npm package or
  bundler — this project has no build step, and this is Tauri's supported
  way to expose plugin JS APIs to a page that isn't bundled.
- `tauri-plugin-dialog` and `tauri-plugin-fs` added as Cargo dependencies
  and registered in `main.rs`; `dialog:default`, `fs:default`, and
  `fs:allow-read-file` granted in `capabilities/default.json`. No static
  filesystem scope was added — the dialog plugin's own `open()` command
  dynamically grants fs scope for exactly the paths the user picks, which
  is the documented, intended pairing of these two plugins.

**What's actually verified (and what isn't):** every JS-side change was
re-run through the same unit tests as 0.1.1 (extension filtering, decode
timeout, one-line summary phrasing) and those still pass — but that only
proves the processing logic, which was never the problem. The actual fix
here is on the Rust/Tauri side, and **this development environment has no
Rust toolchain and cannot compile or run the desktop app**, so the native
dialog integration itself has not been built or exercised anywhere. This
is explicitly not being represented as fixed-and-confirmed — it's fixed
and needs the real Windows build (`.github/workflows/build-windows.yml`)
to prove the Cargo dependencies resolve, the plugins initialize, and the
dialog actually returns multiple paths on a real Windows machine.

### Issue 2 — duplicate files, fixed

`app/js/documentManager.js` now tracks a `sourceKey` per open document —
the full file path when one is known (every file opened via the native
Tauri dialog now carries its real path), falling back to filename alone
only in the browser-fallback path, which is a documented limitation since
browsers don't expose a file's path for security reasons. Before opening
any file, it's checked against every already-open document's `sourceKey`:

- A file that matches nothing already open opens immediately, same as
  before.
- A file that matches an already-open document is held back rather than
  opened or silently renamed — the batch keeps going for every other file
  in the same selection (a mix of new and already-open files in one Open
  operation opens the new ones right away).
- If any files were held back, **one** `window.confirm` covers the whole
  set — "`Interview.mp3` is already open. Open another copy?" for a single
  match, or a combined sentence naming all of them for several — never one
  dialog per duplicate. Confirming opens them as explicit extra copies
  (using the existing "(2)" title-uniqueness logic, which is otherwise
  unrelated to duplicate detection); declining leaves them closed and adds
  to the one final completion announcement, e.g. "7 audio files opened. 3
  unsupported files skipped. 1 already-open file not reopened."

Verified with unit tests: opening the same source path twice is caught and
held back; a confirmed reopen correctly produces a second document titled
with "(2)"; a different file that merely shares a name with nothing open
is unaffected; a mixed batch (one new file, one duplicate) opens the new
file immediately and reports the duplicate separately.

### Issue 3 — Design Philosophy and Standards compliance, fixed

Reread the DesignPhilosophyAndStandards repository in full before changing
anything, per the directive — including `Patterns/Navigation.md`,
`Standards/Application Structure Standards.md`, `Standards/Accessibility
Standards.md`, `Patterns/Dialogs.md`, `Patterns/Focus Management.md`, and
`Components/CSS/odd-theme.css` / `odd-layout.css` (the actual shared CSS,
not just the prose standards describing it).

**Landmarks/regions reduced.** The five `aria-labelledby`-bearing
`<section>` panels (Microphone Setup, Recording, Playback, Recording
Library, Audio Editor) each exposed a `region` landmark purely because
they had an accessible name — removing `aria-labelledby` from all five
(in `index.html`) drops that landmark role entirely while leaving the
`<h2>` heading, visual styling, and DOM structure completely unchanged, so
heading-level navigation still works exactly as before. `main` is the only
landmark left inside the page body, plus the standard implicit `header`
(banner) and `footer` (contentinfo) — down from six regions to one.

**Skip links added**, using the real multi-link markup from
`Components/CSS/odd-layout.css` (`.skip-links` wrapping `.skip-link`
anchors, revealed on focus via `transform: translateY`, replacing this
app's older off-screen-position technique): "Skip to main content," "Skip
to Recording," and "Skip to Audio Editor" — the two genuinely major
working areas, per the directive, without turning every panel into its own
skip target. `tabindex="-1"` added to `#main-content`, `#recording-heading`,
and `#editor-heading` so activating a skip link reliably moves focus, not
just scroll position.

**Footer added**, inside the existing `<footer>` (already a landmark by
being a direct child of `<body>`): one line reading "Open Door Design —
Copyright © 2026 Open Door Design. AccessibleAudioStudio Pro, version
0.1.2." — plain text, no new landmark, no decoration, ahead of the
existing Keyboard Shortcuts / Diagnostics disclosures which are
unchanged. The version string is not templated (this project has no build
step), so it must be updated by hand in `index.html` alongside every other
version-bump location — added to the synchronized-fields list this repo
already tracks.

**Branding corrected.** The `<h1>` now reads "AccessibleAudioStudio Pro"
(was "AccessibleAudioStudio"), matching the installed desktop identity;
the unsupported-browser notice heading and the `<title>` were corrected
the same way.

**Real design tokens applied**, replacing the placeholder colors flagged
as provisional since the free app's Phase 2: `--color-accent` is now
`#0B5D3B` (Open Door Design's actual primary green, from
`odd-theme.css`), and focus indicators use a separate, distinct token,
`#8A5A00`, rather than reusing the accent color — this repository's own
tokens keep those two deliberately different, which this app's CSS didn't
before.

**Not done as part of this pass, deliberately:** no new dialog component,
no additional panels, no explanatory or permanent instructional text —
per "Interface Simplicity," the duplicate-file confirmation still uses the
same plain `window.confirm` this app already uses elsewhere, not the full
`role="dialog"` pattern documented in `Patterns/Dialogs.md`, consistent
with this app's existing, already-accepted native-dialog limitation.

**Verified:** axe-core re-run against the full page (every normally-hidden
panel and form shown, same as previous passes) — 0 violations across 36
checks; confirmed 0 explicit `region`-role sections remain; confirmed
exactly one `<h1>` reading "AccessibleAudioStudio Pro"; confirmed all
three skip links are present with working `href` targets. **Not
verified:** a real screen reader pass over any of this — per the
directive, that happens after this build is returned, not before.

## 0.1.3 — instrumentation, a real title bug fix, and honest open questions

Real Windows testing of 0.1.2 found the multi-file Open Audio problem
**still present** — the native dialog rewrite in 0.1.2 was a real, correct
architectural fix (confirmed: the file-type filter dialog in that test
session was genuinely the native Windows picker, and it did filter to
`*.wav;*.mp3;*.m4a;*.flac;*.ogg` as configured), but the end result was
still "1 audio file opened." after a 15-file selection. Per the
correction directive for this build, the response here is instrumentation
and one confirmed root-cause fix — not another round of guessing.

### One real, confirmed bug found and fixed: the document/window title

JAWS announced the title as "Audio Recording - AccessibleAudioStudio —
Web content" with no "Pro" — even though the H1 correctly said Pro. This
was traceable, not speculative: `index.html`'s static `<title>` tag *was*
correctly changed to include "Pro" in 0.1.2, but
`app/js/audioEditorController.js`'s `render()` function overwrites
`document.title` on every render (including the very first one, at
startup, before any document is open) with a fallback string that was
never updated to match — `"Audio Recording - AccessibleAudioStudio"`,
missing "Pro". That stale fallback silently overwrote the correct static
title the moment the page finished loading, which is exactly the observed
symptom. Fixed by correcting the fallback string (now a single named
constant, `DEFAULT_DOCUMENT_TITLE`, so there's one place to keep this
right instead of two copies that can drift again) and removing the
now-redundant duplicate assignment that existed in both `render()` and
`renderDocumentOptions()`.

### Multi-file Open: instrumented, hardened, not re-guessed

Two concrete, non-speculative changes, plus the diagnostic reporting the
correction directive asked for instead of another blind fix:

- **The Tauri dialog's return value is now explicitly normalized** for
  all three documented cases (`null` when cancelled, a single string, or
  an array of strings) via a named `normalizeDialogResult()` function,
  rather than the previous inline ternary. Checked against Tauri's own
  published type signature (`OpenDialogReturn<T>`, `multiple: true` →
  `string[] | null`) — the shape assumption was already correct, but it's
  now explicit and named rather than implicit.
- **Reading the selected files is no longer fail-fast.** The previous
  code used `Promise.all()` to read every selected path via the fs
  plugin — if even one file failed to read, the *entire* batch would
  reject and none of the 15 files would open, which would produce a
  different symptom (an error alert) than what was actually observed, but
  was still a real reliability gap worth closing regardless of whether it
  explains this specific report. Switched to `Promise.allSettled()`, so
  every successfully-read file still opens even if others fail, and
  failures are counted rather than aborting the batch.
- **A new "Open Audio Diagnostics" panel** (collapsed `<details>` in the
  footer, matching the existing Keyboard Shortcut Diagnostics pattern —
  see `index.html` and `updateOpenAudioDiagnostics()` in
  `audioEditorController.js`) reports, after every Open Audio operation,
  on demand and never auto-announced:
  - Native dialog returned: N files (or "not applicable" for the browser
    fallback path)
  - Files read from disk: N (with a failure count if any)
  - JavaScript received: N files
  - Supported audio files: N
  - Files decoded: N (with a failure count if any)
  - Unsupported files skipped: N
  - Already-open files found / reopened / declined, when relevant
  - Documents opened: N

  This directly answers "where exactly do files 2 through 15 fall
  through the floor" on the next real test, instead of another delivery
  that claims a fix without proof.

**What this does and does not claim:** the title fix is confirmed correct
by direct code inspection — the bug and the fix are both traceable to an
exact line. The multi-file dialog-result handling is more defensive and
more correct than before, and the diagnostics will make the actual
failure point visible on the next real run — but **this environment still
has no Rust toolchain and cannot build or run the Tauri desktop app**, so
whether the native dialog itself returns all 15 paths on real Windows
remains unconfirmed here. That is explicitly the open question 0.1.3
exists to answer, not something this build claims to have resolved.

## 0.1.4 — moved native file picking into Rust, based on 0.1.3's own evidence

0.1.3's diagnostics did their job. Real Windows testing reported, verbatim:

> Native dialog returned: 1 file.
> JavaScript received: 1 file.
> Files read from disk: 1 of 1.
> Supported audio files: 1.
> Files decoded: 1.
> Documents opened: 1.

Every stage downstream of "native dialog returned" matched it exactly —
proof that this app's own file-processing pipeline was never the problem,
across three straight builds of trying to harden it. The loss was
upstream of all of it: in the `window.__TAURI__.dialog.open({ multiple:
true })` call itself, or in the JS-global-binding layer between it and
this app. 0.1.3 was correct not to touch decoding or filtering again on
the strength of a guess — the diagnostics existed specifically to prevent
another round of that, and they did.

**Fixed** by removing that layer rather than continuing to poke at it:

- A single new Rust command, `pick_and_read_audio_files` (see
  `src-tauri/src/main.rs`), now does both the native file picking and the
  file reading, entirely in Rust, in one round trip. It calls
  `tauri-plugin-dialog`'s Rust API directly —
  `app.dialog().file().add_filter(...).blocking_pick_files()`, the
  variant the plugin's own docs recommend for use inside a command rather
  than the main event loop — and reads each resulting path with
  `std::fs::read`. The frontend (`app/js/audioEditorController.js`) calls
  this one command via `window.__TAURI__.core.invoke(...)` and receives a
  plain array of `{ name, path, data }` objects, which get wrapped in
  ordinary `File` objects and handed to the exact same
  `documentManager.openFiles()` pipeline every other Open Audio path
  already used.
- `tauri-plugin-fs` is no longer a dependency — nothing in this app calls
  its JS-exposed commands anymore, since file bytes are read directly in
  Rust now. Removed from `Cargo.toml`, `main.rs`, and the now-unused
  `fs:*` / `dialog:*` capability grants were removed from
  `capabilities/default.json` (custom app commands like this one are
  allowed by default under `core:default` alone — no plugin-specific
  permission entry was ever required for it).
- A single failed file read no longer aborts the whole batch: each
  path's read result is recorded independently (`files` for successes,
  `read_errors` for failures) rather than one Rust-side operation
  aborting on the first error.
- The Open Audio Diagnostics panel was extended with two more stages
  Dean's correction directive specifically asked for — "multi-select
  requested" and "passed across the Rust/Tauri boundary" — so the very
  first number reported after the next real test ("Native dialog
  returned: N") is now coming from a fundamentally different code path
  than the one that produced "1" three builds in a row, and every stage
  after it stays visible for comparison.

**What this build does and does not claim**, stated as plainly as
possible per the correction directive: this is a real architectural
change on the Rust side, grounded in what 0.1.3's own diagnostics
actually proved rather than another guess — but **this development
environment has no Rust toolchain and cannot compile or run the desktop
app**, so whether `blocking_pick_files()` itself returns every selected
path on real Windows is unverified here. If the next real test still
reports "Native dialog returned: 1 file," that is now strong evidence the
issue sits below the Rust plugin layer entirely — in the `rfd` crate
`tauri-plugin-dialog` uses internally, in a Windows-specific dialog
backend behavior, or in something about this specific Windows
environment — which would be the next place to look, not this app's code
again. That is a real, distinct next branch, not a hedge.

## Recommended next phase

Build 0.1.4 via GitHub Actions and, on real Windows, select several files
in one Open Audio operation, then open the Open Audio Diagnostics panel in
the footer immediately after. "Native dialog returned" is now the
critical number: it comes from a Rust command that bypasses the
JS-dialog-binding layer 0.1.3's diagnostics implicated, so this is a
genuinely different test than the last three builds, not a repeat. If it
still reports 1 regardless of selection size, the next place to look is
below `tauri-plugin-dialog` itself — the `rfd` crate or a Windows-specific
dialog backend behavior — not this app's code again. If it reports the
real count, confirm every later stage matches through to "Documents
opened," and confirm the document/window title still says
"AccessibleAudioStudio Pro" from first launch. After the real multi-file
count is confirmed working: a fair trial of the current document-switching
combo box, then markers (Phase 6), since several editing operations here
(set selection start/end, navigate by increment) already share the
underlying mechanics markers will need.
