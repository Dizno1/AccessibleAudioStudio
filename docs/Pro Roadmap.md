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

## 0.1.5 — replaced tauri-plugin-dialog entirely with a direct native Windows call

0.1.4's diagnostics were, again, definitive:

> Multi-select requested: yes.
> Native dialog returned: 1 file.
> Passed across the Rust/Tauri boundary: 1 file.
> Files read successfully: 1 of 1.
> Received in JavaScript: 1 file.
> Supported audio files: 1.
> Files decoded: 1.
> Documents opened: 1.

0.1.4 had already moved the dialog call from JavaScript into Rust,
bypassing the JS-global-binding layer 0.1.3's diagnostics had implicated —
and the result was unchanged. That ruled out the JS binding layer
specifically and left `tauri-plugin-dialog`'s own Windows dialog backend
as the remaining suspect, since every stage this app's own code controls
had already been shown clean, twice, in two different architectures.

Per the correction directive for this build: no more changes to the
editor, decoding, document creation, or JS file processing — none of
those were touched. The only change is replacing the one component still
under suspicion.

### What changed

`tauri-plugin-dialog` is no longer a dependency at all. In its place,
`pick_and_read_audio_files` (`src-tauri/src/main.rs`) calls Windows' own
`IFileOpenDialog` COM interface with `FOS_ALLOWMULTISELECT` set — the
same API Explorer's Open dialog and Audacity's Windows build are built
on — through `wfd`, a small, Windows-only crate built specifically
around that one API rather than a large cross-platform abstraction layered
on top of it. `wfd` is scoped to `[target.'cfg(windows)'.dependencies]`
in `Cargo.toml`, since this app currently only ships as Windows
installers and the browser build already has its own separate fallback
(the HTML `<input type="file" multiple>`, used automatically whenever no
Tauri runtime is present).

### How the implementation was chosen, and its real verification status

Before writing any of this, real effort went into actually verifying it
rather than writing it blind and hoping, because "I found it" has now
been said three times about this exact bug:

- **A real Rust toolchain was installed in this environment** (`apt-get
  install cargo rustc`), specifically to attempt genuine `cargo check`
  verification — something not previously available for this project's
  Rust-side changes.
- **Hand-writing the raw `windows` crate COM bindings directly was tried
  first** (`CoCreateInstance`, `IFileOpenDialog`, `IShellItemArray`,
  etc.) and abandoned after confirming, via two separate real compiler
  attempts, that neither the `windows` crate nor `winapi` can be
  meaningfully type-checked on this Linux sandbox: both gate their real
  implementations behind `cfg(windows)` / `std::os::windows`, neither of
  which exist here, and there is no network path in this environment to
  install a Windows Rust target (`rustup`/`static.rust-lang.org` are not
  reachable). This is a genuine, confirmed environmental wall, not a
  guess about one.
- **Given that wall applies equally to any approach touching real Windows
  APIs**, the deciding factor became risk of *authorship* error rather
  than risk of *compilation* error: hand-rolled COM interop has a large,
  easy-to-get-wrong surface (exact module paths, exact method signatures,
  manual memory management for returned strings). `wfd` was chosen
  instead specifically because its entire public API is three items
  (`DialogParams`, `open_dialog()`, `OpenDialogResult`), and its exact
  struct fields were confirmed by directly reading its published source
  on docs.rs — `OpenDialogResult { selected_file_path, selected_file_paths:
  Vec<PathBuf>, selected_file_type_index }` — not inferred from
  documentation prose or guessed from convention.
- **This is source-verified, not compiler-verified.** Say that plainly:
  this build's central change has not been proven to compile, and cannot
  be proven to compile in this environment. What's different from
  previous rounds is that the API surface being called is now confirmed
  correct by reading the actual crate source rather than assumed from
  general Windows/Rust familiarity, and the crate itself is small enough
  that there's very little room left for a mismatch.

### Diagnostics extended per the correction directive

The Open Audio Diagnostics panel now reports, in order: "Windows native
multi-select requested," "Windows picker returned," "Passed across
Rust/Tauri boundary," "Files read successfully," "Received in
JavaScript," then the existing supported/decoded/opened stages — every
line the directive asked for. If the command invocation itself fails
(rather than returning a low count), the panel now says so explicitly
("The picker could not be opened: ...") instead of silently keeping
whatever it last displayed, and the user gets a concise alert — "Multiple-
file selection could not be opened." — rather than the app quietly doing
nothing. There is no old broken path left to silently fall back to:
`tauri-plugin-dialog` was removed, not kept as a fallback.

### Preserved

Duplicate-file handling, the document-switching combo box, Pro branding
(H1, window/document title), the three skip links, simplified landmark
structure, the Open Door Design footer, approved design tokens, and the
free recording workflow are all unchanged in this build — none of the
files that implement them were touched.

## 0.1.6 — a genuinely different class of Windows API, with real unit-tested logic

0.1.5's diagnostics reported the identical symptom a third time:

> Windows native multi-select requested: yes.
> Native dialog returned: 1 file.
> Passed across the Rust/Tauri boundary: 1 file.
> Files read successfully: 1 of 1.
> Received in JavaScript: 1 file.
> Supported audio files: 1.
> Files decoded: 1.
> Documents opened: 1.

Two independently-implemented multi-select APIs — `tauri-plugin-dialog`
(0.1.2–0.1.4) and `wfd`/`IFileOpenDialog` (0.1.5) — had now both returned
exactly one file regardless of selection size, with every downstream
stage proven clean both times. Per the correction directive for this
build: no changes to the editor, decoding, document creation, JS
processing, recording, playback, Recording Library, duplicate protection,
or document switching — none of those were touched, since 0.1.5's own
diagnostics had already exonerated all of them for a second time.

### What changed

`pick_files_native` (`src-tauri/src/main.rs`) now calls `GetOpenFileNameW`
with `OFN_EXPLORER | OFN_ALLOWMULTISELECT` — the classic, non-COM Common
Dialog Box Library API, the same class of mechanism Audacity's own
Windows build uses for this exact dialog — rather than a third variation
on `IFileOpenDialog`. This is a genuinely different kind of Windows
mechanism: a single function call taking a struct pointer, no COM
interfaces, no COM threading-model initialization at all (`CoInitializeEx`
was part of both previous implementations; this one has no COM dependency
whatsoever). Selected files come back from Windows in one buffer: for a
single file, the complete path with no separator; for multiple files, the
current directory followed by every selected filename, each
NULL-separated, with an extra NULL terminating the whole list — this
exact shape is Microsoft's own documented behavior for
`OFN_ALLOWMULTISELECT` with `OFN_EXPLORER`, and `parse_multi_select_buffer`
implements it directly.

`wfd` is no longer a dependency. The `windows` crate (Microsoft's own
official bindings, `Win32_UI_Controls_Dialogs` feature) is used instead,
scoped to `[target.'cfg(windows)'.dependencies]` in `Cargo.toml` since
this app only ships Windows installers. Buffer size for the multi-select
return value is 65536 UTF-16 code units — generous enough for hundreds of
long filenames, since a too-small buffer is a well-documented way this
specific API silently fails on large selections.

### What was actually verified this time, and how

The buffer-parsing logic (`parse_multi_select_buffer`) is the one
genuinely new, hand-written piece of logic in this build, and it doesn't
depend on any Windows-specific API at all — it's plain Rust operating on
a `&[u16]` slice. That means it's the first piece of this app's
Windows-only Rust code that could actually be extracted and run with a
real compiler in this environment, rather than only reviewed by eye:

- Copied verbatim into a standalone file with no Tauri, no `windows`
  crate, no dependencies at all — just `std`.
- Compiled and run with real `rustc` (installed in this sandbox via
  `apt-get install cargo rustc` specifically for this purpose) against
  six cases: a single file selected (no directory prefix, per Microsoft's
  documented special case), several files, the **exact 15-file selection
  from real Windows testing** (including all four `.aup3` files, verified
  each of the eleven audio files' paths were reconstructed correctly),
  cancellation (empty buffer), an oversized 65536-element buffer with
  real trailing zero padding (to catch any bug that would read garbage
  past the intended content), and filenames containing spaces (a classic
  risk area for NULL-splitting logic). All six passed.
- Confirmed programmatically — not by eye — that the tested copy is
  character-for-character identical to what's actually in
  `src-tauri/src/main.rs` (a diff of the two function bodies showed only
  comment differences, zero logic differences).

This is a different, stronger claim than previous builds could make about
their own Rust code: not "the API surface looks right based on reading
documentation," but "this exact logic was executed against realistic and
edge-case input and produced the correct output." What remains unverified
is unchanged from every previous Rust-side build: the actual Windows API
calls (`GetOpenFileNameW`, the `OPENFILENAMEW` struct field assignments)
cannot be compiled or run in this environment, confirmed directly —
`windows-rs` gates its real implementation behind `cfg(windows)`, which
doesn't evaluate true on this Linux host, and there's no network path
here to a Windows Rust target. The struct field names and the
`OFN_EXPLORER`/`OFN_ALLOWMULTISELECT`/`OPEN_FILENAME_FLAGS` constant path
were confirmed against Microsoft's own generated Rust API documentation
before being used, the same standard applied in 0.1.5.

### Diagnostics

Extended to the exact field names requested: "Win32 multi-select
requested," "Win32 picker returned," through the existing
boundary/read/decoded/opened stages — a simple rename from 0.1.5's
wording, not a structural change, so the panel's behavior (collapsed,
on-demand, never auto-announced) is unchanged.

### Compile fix (same 0.1.7, no version change)

The first real GitHub Actions Windows build of this code failed —
genuinely useful news, since it's the first time this specific code
reached an actual Windows compiler at all, and the failure was a precise,
fixable type error rather than another silent runtime mismatch. The
compiler reported:

> error[E0308]: mismatched types
> expected `*mut c_void`, found `HDROP`

in `read_clipboard_file_list`, at the line constructing the `HDROP`
wrapper from `GetClipboardData`'s return value. The bug: `HDROP(handle.0
as isize)` — casting the pointer to an integer (`isize`) before passing
it to `HDROP`'s constructor, which the `windows` crate defines as `pub
struct HDROP(pub *mut c_void)` — a pointer field, not an integer one.
`HANDLE` (what `GetClipboardData` returns) is defined identically, `pub
struct HANDLE(pub *mut c_void)` — confirmed directly, not assumed — so
`handle.0` is already the exact pointer type `HDROP` needs. Fixed by
removing the stray cast: `HDROP(handle.0)`, a direct, type-correct
field-for-field construction.

This was exactly the kind of narrow, mechanical error a real compiler
catches immediately and this environment's inability to compile
Windows-target code could not — the acknowledged uncertainty flagged for
this function when 0.1.7 was written was about `DragQueryFileW`'s buffer
parameter shape, not this particular pointer/integer mix-up, which is a
reminder that "confirmed against documentation" and "confirmed by a
compiler" are genuinely different confidence levels, not interchangeable
ones. Nothing else in the file was touched: the diff between this
correction and the submitted 0.1.7 is exactly one line changed, one
explanatory comment added.

## 0.1.7 — the workflow was different than every prior build assumed

0.1.6's diagnostics were read correctly on real Windows, but the actual
tested workflow turned out to be different from what every build through
0.1.6 had addressed. Not "select multiple files inside the dialog's own
list view" — that had genuinely never been confirmed broken — but:

1. Select multiple files in File Explorer.
2. Ctrl+C.
3. Activate AccessibleAudioStudio Pro, activate Open Audio.
4. The dialog opens; focus lands in the "File name:" edit combo.
5. Ctrl+V.
6. Accept the dialog.

Result: one file opened. Audacity reportedly supports this same gesture.

### Why this can't work by pasting text, confirmed from an authoritative source

This is not a bug in this app's dialog implementation, in either 0.1.6's
`GetOpenFileNameW` or any earlier attempt. It's a direct consequence of
how Windows clipboard formats work, documented by Microsoft itself:
Raymond Chen (a long-time Windows engineer), in a piece titled
**"Windows Explorer Doesn't Do Text,"** explains that when Explorer
copies files to the clipboard, "the resulting data object offers, among
other things, [HDROP], the file contents, and a file group descriptor.
But one of the formats you won't see offered by the data object is
text." Separately, Microsoft's own reference for `WM_PASTE` — the
message any ordinary edit control or combo box (including a dialog's
File Name field) uses to handle Ctrl+V — states plainly: "Data is
inserted only if the clipboard contains data in CF_UNICODETEXT format."
Put together: Explorer's multi-file copy never places a text format on
the clipboard, and a plain text field's paste handling requires one to
insert anything at all. No text-based paste into any ordinary Windows
edit control can recover a multi-file list this way — not in this app,
not in any app relying on ordinary text-field paste behavior.

### What was implemented

`read_clipboard_file_list` (`src-tauri/src/main.rs`) reads a Windows
Shell copied-file list — `CF_HDROP` — directly from the clipboard, via
`OpenClipboard`, `GetClipboardData`, and `DragQueryFileW` (the same
functions any ordinary clipboard-reading utility uses; confirmed against
Microsoft's Rust API documentation, and cross-checked against a small,
independent, real-world C example using the identical
`IsClipboardFormatAvailable` → `OpenClipboard` → `GetClipboardData` →
`DragQueryFile` loop → `CloseClipboard` sequence). This check now runs
the moment Open Audio is activated, *before* any dialog is shown. If two
or more files are found there, they are used directly — the native
dialog never opens for that activation, so there is no paste step
needed at all. If nothing usable is on the clipboard (nothing copied, or
only one file), the 0.1.6 `GetOpenFileNameW` dialog opens exactly as
before, completely unchanged, for ordinary manual browsing.

### The one deliberate deviation from the literally-described workflow, stated plainly

The directive for this build explicitly authorized, and described in
detail, an alternative: hooking the *live* native dialog (via
`OFN_ENABLEHOOK`/`lpfnHook`, subclassing the File Name combo box) to
intercept Ctrl+V at the moment it happens and read `CF_HDROP` right
then — which would reproduce the exact keystroke sequence originally
described (dialog open → paste inside it → accept).

That was not attempted. Dialog hook procedures are widely documented as
one of the most failure-prone corners of Win32 UI programming — a hook
that mishandles a single message, deadlocks, or crashes doesn't just
fail to add a feature, it can hang or corrupt the entire native dialog.
Given this environment cannot compile, run, or test any of this app's
Windows-specific code (confirmed directly across every build since
0.1.4, not assumed), shipping a hand-written dialog hook with zero
ability to verify it wouldn't break the dialog entirely was judged too
risky relative to the clipboard-on-activate approach — which is
architecturally simpler, uses well-documented standalone functions, and
critically, **cannot break the existing working dialog even if it has a
bug**: if clipboard reading fails or finds nothing, the code falls
straight through to the unchanged 0.1.6 path.

The practical result is a different, shorter gesture that reaches the
same outcome: Explorer Ctrl+C → switch to this app → Ctrl+O — every
copied file opens, no dialog and no paste step required at all. This is
not the same keystroke sequence as originally specified, and that is
being stated directly rather than presented as a full match. Whether
this satisfies the actual underlying need (open the group of files just
copied in Explorer, without reselecting them one at a time) is for real
testing to determine.

### Diagnostics

Extended with every field requested: "Windows Shell clipboard file list
detected," "Files present in Windows Shell clipboard," "Open dialog
multi-select enabled," "Open dialog returned" (reported as "not
applicable" when the clipboard path was used instead, since the dialog
genuinely wasn't shown), "Clipboard file paths supplied to application,"
through the existing boundary/read/decoded/opened stages. Still
collapsed, still on-demand, never auto-announced.

### What was and wasn't verified

The clipboard-reading code carries more uncertainty than 0.1.6's dialog
code, and that's worth stating clearly rather than glossing over: the
exact Rust function signature for `DragQueryFileW` (specifically,
whether its output buffer parameter is a combined slice or two separate
raw pointer/length parameters) could not be confirmed with full
certainty from available documentation, unlike `GetOpenFileNameW`'s
signature in 0.1.6, which was seen directly. The implementation uses the
convention that matches the majority of comparable windows-rs buffer-API
usage patterns encountered during research. As with every Windows-specific
change since 0.1.4, this environment cannot compile or run any of this
code — confirmed directly, not assumed. What differs in 0.1.7 specifically
is that this one function has a real, acknowledged signature ambiguity
that 0.1.6's did not.

## Recommended next phase

Build 0.1.7 via GitHub Actions and, on real Windows, reproduce the exact
workflow that surfaced this: select several audio files in File Explorer,
Ctrl+C, switch to AccessibleAudioStudio Pro, activate Open Audio. No paste
step is needed this time — the clipboard is checked automatically the
moment Open Audio activates. Open the Open Audio Diagnostics panel
immediately after: "Windows Shell clipboard file list detected" should say
yes, and the file count should match what was actually copied. If it says
no, or the count is wrong, that is a specific, actionable finding about
the clipboard-reading code (most likely the one acknowledged uncertainty —
`DragQueryFileW`'s exact buffer parameter shape) rather than a repeat of
"picker returned 1." Also confirm the original 0.1.6 manual-browse dialog
behavior (Ctrl+O with nothing relevant on the clipboard) is completely
unchanged, and that document/window title, H1, skip links, footer, and
landmark structure are all still correct. After multi-file intake is
confirmed working for real via this workflow: a fair trial of the current
document-switching combo box, then markers (Phase 6), since several
editing operations here (set selection start/end, navigate by increment)
already share the underlying mechanics markers will need.
