# AccessibleAudioStudio

A professional, browser-based audio recording environment designed from the ground up for keyboard users and screen reader users — fully usable by everyone.

Accessibility is not a layer added on top here. It is the architecture. See `docs/Screen Reader First Principles.md` for the non-negotiable rules every feature follows, and `docs/Vision.md` for the long-term direction.

## Status: Version 1.0 (web) complete; Windows packaging configured

Phase 1 objective: allow a user to confidently create a high-quality recording, entirely from the keyboard, entirely through a screen reader. That objective is met, and the browser-based application is considered feature-complete for Version 1.0.

Phase 2 packages this same, unmodified application as a native Windows desktop application using Tauri — see "Building the Windows Application" below.

A user can currently:

- Enable microphone access and choose a specific microphone
- Choose a Recording Profile (Quick Note, Spoken Word, Natural Voice)
- Start, pause, resume, and stop a recording
- Listen to a just-stopped recording immediately, before naming it or deciding whether to keep it
- Save a recording (with a name and optional notes), Record Again, or Discard it
- Play back the current unsaved recording or any saved recording — play/pause, restart, skip forward/backward, jump to beginning/end
- Browse, rename, annotate, download, and delete recordings in the Recording Library
- Do all of the above with visible buttons or with global keyboard shortcuts

See `docs/Roadmap.md` for the complete list of what was built, known limitations, and the recommended next phase.

## AccessibleAudioStudio Pro: Audio Editor (new)

A new "Audio Editor (Pro)" panel adds file-based audio editing alongside
the recording workflow above, without changing it. A user can currently:

- Open one or several existing audio files at once (WAV, MP3, M4A, FLAC, OGG — mixed formats in a single Open operation), or create a New Audio document. In the packaged desktop app, this uses Tauri's own native file dialog (not just an HTML file input) specifically so multi-file selection is reliable — see "Application identity" below for the plugins this requires
- Work with multiple open audio documents at once, each with its own accessible title
- Navigate precisely by 10 seconds, 1 second, or 100 milliseconds, with position and selection always spoken in natural language ("1 minute 14.250 seconds")
- Set a selection, preview it, and hear its start/end/duration on demand
- Cut, Copy, Paste, Delete, Trim to Selection, Select All, Undo, and Redo — including copying audio between two different open documents
- Have routine format differences (sample rate, mono/stereo) reconciled automatically on paste
- Save or Save As to an ordinary WAV or MP3 file
- Get asked before a file that's already open is opened again as a second copy, rather than silently ending up with two copies open

See `docs/Pro Roadmap.md` for exactly what's implemented vs. deferred against the full 12-phase Pro roadmap, and `docs/Audio Editing (Pro).md` for how it behaves for a keyboard and screen reader user, including known limitations.

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
  shortcutDiagnostics.js   Tracks the last shortcut detected, for the Diagnostics panel
  announcer.js             ARIA live region status/alert announcements
  timeFormat.js             Natural-language duration/date/precise-time formatting
  audioEditorController.js Audio Editor (Pro): DOM wiring for open/new/save, navigation, selection, editing
  documentManager.js       Audio Editor (Pro): the set of open audio documents
  audioDocument.js         Audio Editor (Pro): one open document's state, selection, and undo/redo history
  audioBufferUtils.js      Audio Editor (Pro): pure AudioBuffer editing operations + format reconciliation
  audioBufferPlayer.js     Audio Editor (Pro): Web Audio playback of a document or a selection range
  audioClipboard.js        Audio Editor (Pro): in-application clipboard for Cut/Copy/Paste
  audioCodec.js            Audio Editor (Pro): decode any supported file; encode WAV/MP3
  vendor/lame.min.js       Audio Editor (Pro): vendored pure-JS MP3 encoder (see vendor/README.md)
docs/
  Vision.md
  Screen Reader First Principles.md
  Recording Profiles.md
  Pro Roadmap.md
  Audio Editing (Pro).md
  Roadmap.md
src-tauri/                 Windows desktop packaging (Tauri) -- see "Building the Windows Application"
  Cargo.toml               Rust package manifest
  tauri.conf.json          Window, bundle, and installer configuration
  build.rs                 Required Tauri build script
  src/main.rs              Application entry point (hosts the existing web app; no app logic of its own)
  capabilities/            Tauri v2 permissions -- minimal, since this app calls no Tauri commands
  icons/                   App icon set (placeholder -- see note below)
.github/workflows/
  build-windows.yml        Builds the real .msi/.exe on a GitHub-hosted Windows runner -- see "Building the Windows Application"
scripts/
  prepare-dist.js          Copies index.html + app/ into dist/ for Tauri -- see "Frontend distribution folder"
dist/                       Generated by prepare-dist.js before every desktop build -- gitignored, never hand-edited
package.json                Holds only the Tauri CLI dev dependency and desktop build scripts
Release/                   Built Windows installers go here before publishing (empty until a build -- local or CI -- has actually run)
audio/                     Reserved for future local export/output use
assets/                    Reserved for future static assets
tests/                     Reserved for future automated tests
```

## Keyboard shortcuts

| Shortcut | Action |
|---|---|
| Ctrl+Alt+R | Start or Stop Recording (toggle, like the record button on a physical recorder) |
| Ctrl+Alt+Space | Pause or Resume Recording |
| Ctrl+Alt+P | Play or Pause the current unsaved recording, or the saved recording selected in the library if there is no unsaved recording |

Shortcuts are suspended while focus is in a text field (typing an input or textarea) — not while focus is on a dropdown like the microphone or profile selector, since there's no typing to protect there. Every visible button remains fully functional at all times -- shortcuts are a supplement, never a replacement.

If a shortcut doesn't seem to work, the "Keyboard Shortcut Diagnostics" panel at the bottom of the page reports the last shortcut the app detected and what happened as a result -- useful for telling apart a keystroke that never reached the app from one that reached it but had nothing to do yet.

## A quiet, stable application

AccessibleAudioStudio speaks only when there's something the user needs to know right now -- state changes like "Recording started," "Playback paused," or an error -- never continuously and never to narrate things a screen reader will already announce on its own (like a button's own pressed state) or that are better left as text the user can read on demand.

It also keeps its hands off keyboard focus and the DOM once something's underway: the Start/Stop control is one button that relabels itself rather than two buttons swapped via disable/enable, the microphone and profile selectors stay enabled through a recording instead of being disabled and yanking focus away, and the Recording Library updates existing elements in place instead of rebuilding itself. Disabling or recreating whatever control currently has focus is what was actually causing most of the extra chatter reported during testing -- not the application's own announcements, but the browser and screen reader reacting to focus getting kicked around. See `docs/Screen Reader First Principles.md`, "Silence Is an Accessibility Feature," for the full policy.

## Building the Windows Application

AccessibleAudioStudio's browser-based application (`index.html` and `app/`) is packaged as a native Windows desktop app using [Tauri](https://tauri.app/), which hosts the existing, completely unmodified web app inside a native window using Windows' built-in WebView2 runtime -- no Electron, no Chromium bundled into the app, no rewrite. The HTML, CSS, JavaScript, and all accessibility and keyboard behavior are identical to the browser version. `index.html` and `app/` at the repository root remain the single source of truth -- that's what GitHub Pages serves directly. The desktop build reads from those same files automatically; see "Frontend distribution folder" below for exactly how.

> **This repository includes the complete Tauri packaging configuration (`src-tauri/`), but not a pre-built installer.** A real `.msi`/`.exe` can only be produced by actually running the build on Windows -- there is no way around that. The recommended way to do this is the automated GitHub Actions build below, which needs no local Windows machine at all. See `Release/README.md` for the full walkthrough either way.

### Recommended: automated build via GitHub Actions

`.github/workflows/build-windows.yml` builds the real installers on a genuine Windows machine (a GitHub-hosted `windows-latest` runner) automatically:

- **Push a Pro version tag** (e.g. `git tag pro-v0.1.5 && git push origin pro-v0.1.5`) to build both installers and open a **draft** GitHub Release with them attached, ready to review and publish.
- **Or run it manually** from the Actions tab ("Build Windows Installer" > "Run workflow") to just build and download the installers as workflow artifacts, without creating a release -- useful while testing a change.

This is a real build on a real Windows machine every time -- not a simulation. See `Release/README.md` for the full step-by-step.

### Alternative: build locally on Windows

If you'd rather build on your own Windows machine instead:

### Prerequisites

1. **Windows 10 or 11** (64-bit). Tauri's Windows target builds and runs on Windows; cross-compiling from Linux/macOS is possible but not covered here -- build on Windows directly for the simplest, most reliable result.
2. **WebView2 Runtime.** Windows 11 and recent Windows 10 updates include this already. If it's missing, install it from [Microsoft's WebView2 page](https://developer.microsoft.com/microsoft-edge/webview2/) -- Tauri's installer can also be configured to fetch it automatically, but having it present on the build machine avoids surprises.
3. **Rust.** Install via [rustup](https://rustup.rs/):
   ```
   winget install Rustlang.Rustup
   ```
   or download and run `rustup-init.exe` from rustup.rs. Accept the default installation. Then restart your terminal and confirm:
   ```
   rustc --version
   cargo --version
   ```
4. **Microsoft C++ Build Tools.** Rust on Windows needs the MSVC linker. Install the "Desktop development with C++" workload from the [Visual Studio Build Tools installer](https://visualstudio.microsoft.com/visual-cpp-build-tools/) (you don't need full Visual Studio, just this workload).
5. **WiX Toolset v3** (for the `.msi`). Tauri's `msi` bundler needs this:
   ```
   winget install WiXToolset.WiX
   ```
   The `.exe` (NSIS) target doesn't need WiX -- it's independent, so you can build one, the other, or both.
6. **Node.js** (LTS, 18+) -- only used to run the Tauri CLI via `npm`, not to build the web app itself (which still has no build step):
   ```
   winget install OpenJS.NodeJS.LTS
   ```

### Frontend distribution folder

Tauri requires `build.frontendDist` to point at a folder containing *only* the web application's production files -- nothing else. Pointing it at the repository root (as an earlier version of this configuration did) fails, because the root also contains `src-tauri/`, `node_modules/`, `.git/`, `.github/`, `tests/`, and `docs/`, none of which belong in a frontend distribution folder. That was the exact cause of the GitHub Actions build failure this configuration previously produced.

The fix: `scripts/prepare-dist.js` copies just `index.html` and `app/` into a `dist/` folder, and `src-tauri/tauri.conf.json` points `frontendDist` at it (`"../dist"`). This script runs automatically -- it's wired in as both `beforeDevCommand` and `beforeBuildCommand` in `tauri.conf.json` -- so `npm run desktop:dev` and `npm run desktop:build` always regenerate `dist/` fresh before Tauri reads it. `dist/` is gitignored and never hand-edited; `index.html` and `app/` at the repository root remain the only place to actually change anything, so there's no risk of the desktop build silently drifting from what GitHub Pages serves.

### Build commands

From the repository root, in a terminal on the Windows build machine:

```
npm install
npm run desktop:dev
```

`npm install` fetches only the Tauri CLI (`@tauri-apps/cli`). `desktop:dev` regenerates `dist/` from the current `index.html`/`app/` and launches the app in a live Tauri window for testing -- this is the fastest way to confirm microphone access, keyboard shortcuts, and screen reader behavior all work identically to the browser before producing an installer.

### Release commands

```
npm run desktop:build
```

This compiles the Rust host application and produces the configured bundles. On success, look in:

```
src-tauri\target\release\bundle\msi\      <- the .msi installer
src-tauri\target\release\bundle\nsis\     <- the .exe setup file
```

Copy whichever files were produced into the `Release/` folder at the repository root (see `Release/README.md`) before publishing.

The first build will take several minutes (Rust compiles the whole dependency tree from scratch); subsequent builds are much faster.

### About the app icon

`src-tauri/icons/` currently contains a simple placeholder icon (a white microphone glyph on a dark blue rounded square) so the build works out of the box. Replace these files with Open Door Design's actual icon before shipping a public release -- keep the same filenames (`32x32.png`, `128x128.png`, `128x128@2x.png`, `icon.ico`) or update the `icon` list in `src-tauri/tauri.conf.json` to match new ones. `icon.ico` needs to be a proper multi-resolution Windows icon (16, 24, 32, 48, 64, 128, 256 px) for the Start Menu, taskbar, and installer to all look correct.

### Application identity

**AccessibleAudioStudio Pro is a separate Windows application from the free
AccessibleAudioStudio, on purpose, so both can be installed on the same
machine at once.** Pro's Tauri identifier, product name, and window title
are all distinct from the free edition's — Windows sees them as two
unrelated applications, not two versions of the same one, so installing
Pro will never upgrade, repair, replace, or uninstall the free edition (or
vice versa).

These are already set in `src-tauri/tauri.conf.json` and `src-tauri/Cargo.toml`; update all of them together if any change:

| Field | AccessibleAudioStudio (free) | AccessibleAudioStudio Pro |
|---|---|---|
| Application name | AccessibleAudioStudio | AccessibleAudioStudio Pro |
| Publisher | Open Door Design | Open Door Design |
| Tauri identifier | `org.opendoordesign.accessibleaudiostudio` | `org.opendoordesign.accessibleaudiostudio.pro` |
| Cargo/package name | `accessibleaudiostudio` | `accessibleaudiostudio-pro` |
| Window title | AccessibleAudioStudio | AccessibleAudioStudio Pro |
| Version | 1.0.0 | 0.1.5 (current test build — see "Pro version numbering" below) |

#### Native file dialog (since 0.1.2; rebuilt in Rust in 0.1.4; switched off tauri-plugin-dialog entirely in 0.1.5)

"Open Audio" in the packaged desktop app opens the real native Windows
file picker, instead of relying solely on an HTML `<input type="file"
multiple">` — the HTML input remains only as a fallback for when this
same app is run as a plain web page with no Tauri runtime present (e.g.
GitHub Pages).

This took three tries to get right, and each one was grounded in what the
previous attempt's own diagnostics actually proved, not a guess:

- **0.1.2/0.1.3** called `window.__TAURI__.dialog.open({ multiple: true
  })` directly from JavaScript, via the auto-injected `withGlobalTauri`
  bindings. Real Windows testing — using the Open Audio Diagnostics panel
  0.1.3 introduced — proved that call only ever returned one file path to
  JavaScript, regardless of how many files were selected.
- **0.1.4** moved the same `tauri-plugin-dialog` call into Rust directly
  (`DialogExt::file().blocking_pick_files()`), bypassing the JS-binding
  layer 0.1.3 implicated entirely. Real Windows testing still reported
  exactly one file, with every stage after "native dialog returned"
  matching it — proof the loss was inside `tauri-plugin-dialog`'s own
  Windows dialog backend, not anywhere in this app.
- **0.1.5** stopped using `tauri-plugin-dialog` for this function
  altogether. `pick_and_read_audio_files` (see `src-tauri/src/main.rs`)
  now calls Windows' own `IFileOpenDialog` COM API with
  `FOS_ALLOWMULTISELECT` directly, via the small, Windows-only `wfd`
  crate — the same underlying API Explorer and Audacity themselves use —
  and reads every selected file's bytes with `std::fs::read`, all in one
  Rust command. The frontend calls this one command via
  `window.__TAURI__.core.invoke(...)` and gets back a plain array of
  `{ name, path, data }` objects — see `app/js/audioEditorController.js`.
  `tauri-plugin-dialog` and `tauri-plugin-fs` are no longer dependencies
  at all. `app.withGlobalTauri` remains `true` in `tauri.conf.json`,
  since `window.__TAURI__.core.invoke` still needs it. `wfd` is
  Windows-only (`[target.'cfg(windows)'.dependencies]` in
  `src-tauri/Cargo.toml`); Cargo fetches it automatically on the next
  Windows build, no separate install step needed.

#### Pro version numbering

Every Windows test build of Pro increments the version — it is never
rebuilt under the same version number as a previous test build. This is
the same practice already used for AccessibleScreenCapture, and for the
same reason: it lets a bug report like "this happened in 0.1.3 but not
0.1.2" point at an exact, reproducible build.

- `0.1.0` — initial Pro editor (Open/New Audio, navigation, selection, editing, Save/Save As)
- `0.1.1` — fixed Open Audio only opening one file out of a multi-file selection (see `docs/Pro Roadmap.md`)
- `0.1.2` — real fix for multi-file Open (native Tauri dialog, not just the HTML input), duplicate-file handling, and a Design Philosophy and Standards compliance pass (landmarks, skip links, footer, branding) — see `docs/Pro Roadmap.md`
- `0.1.3` — diagnostic instrumentation for the Open Audio pipeline (0.1.2's fix still wasn't confirmed working on real Windows), a real document-title bug fix, and hardened per-file dialog-result handling — see `docs/Pro Roadmap.md`
- `0.1.4` — moved native file picking and file reading entirely into Rust (0.1.3's diagnostics proved the JS-side dialog call itself was the point of loss, not this app's file-processing code), removed the now-unused fs plugin dependency, and extended the diagnostics panel — see `docs/Pro Roadmap.md`
- `0.1.5` — replaced `tauri-plugin-dialog` entirely with a direct native Windows `IFileOpenDialog` call (0.1.4's diagnostics proved the loss was inside that plugin's own Windows backend, not this app's code), extended diagnostics further, and added a real error path instead of a silent fallback — see `docs/Pro Roadmap.md`
- `0.1.6`, … — subsequent test/fix builds
- `0.2.0` — a meaningful new feature milestone (e.g. markers)
- eventually `1.0.0` — first production Pro release

The version must always be updated in the same three places together —
`src-tauri/tauri.conf.json` (`version`), `src-tauri/Cargo.toml`
(`[package] version`), and `package.json` (`version`) — so the number
shown by Windows, the compiled binary, and the npm scripts never drift
apart. The generated installer filenames always include whichever version
is currently set (see "GitHub Releases" below), so there's no separate
place to remember to update.

### What the packaging preserves

- **Window:** titled "AccessibleAudioStudio Pro," 1000×800 default, resizable, 700×500 minimum, centered on first launch. Size and position from the previous session are restored automatically on later launches (via `tauri-plugin-window-state`), and saved again as the window is moved, resized, or closed.
- **No browser chrome:** Tauri windows never have tabs, an address bar, or browser menus -- there's no browser present to have any, unlike wrapping the app in an actual browser window. Devtools are available in development builds for troubleshooting and automatically stripped from release builds.
- **Microphone access, keyboard shortcuts, and screen reader accessibility:** all provided by WebView2 running the exact same `index.html`/`app/` as the browser version, so this behavior doesn't need to be (and wasn't) reimplemented.
- **Installer behavior:** both the `.msi` and the `.exe` (NSIS) create Start Menu shortcuts and register the app with Windows so it appears in, and can be removed from, Settings > Apps, the standard uninstall path -- as **"AccessibleAudioStudio Pro,"** distinct from the free edition's own Start Menu and Settings entry. A desktop shortcut is offered as an option during NSIS setup.

## GitHub Releases

Pushing a Pro version tag (`git tag pro-v0.1.5 && git push origin pro-v0.1.5`) triggers `.github/workflows/build-windows.yml`, which builds both installers on a real Windows runner and opens a **draft** GitHub Release with them already attached -- so most of this process is automatic. Using the `pro-v*` prefix (rather than plain `v*`) keeps Pro's version tags from ever colliding with a free-edition tag like `v1.0.0` in this same repository's tag history. What's left to do by hand:

1. After the workflow finishes, open the draft release on GitHub (Releases tab).
2. Confirm the title is clear, e.g. "AccessibleAudioStudio Pro 0.1.5 (Windows)," and adjust if needed.
3. Complete the pre-publish checklist in `Release/README.md` -- install and test the actual attached `.msi` on a real Windows machine (or VM) with a screen reader running, including uninstall through Windows Settings -- before publishing. If the free AccessibleAudioStudio is also installed on that machine, confirm both apps still work independently afterward.
4. Write release notes covering what's new or changed since the last Pro build, any known issues, and which Windows versions were tested.
5. Publish the release. Keep every previous release's assets attached to its own tagged release rather than overwriting them, so there's a complete version history to link back to or roll back to if needed.
6. The published release's asset URLs (e.g. `.../releases/download/pro-v0.1.5/AccessibleAudioStudio Pro_0.1.5_x64_en-US.msi`) are stable direct-download links suitable for linking from OpenDoorDesign.org.

## Recommended next phase

Build 0.1.5 via GitHub Actions — this environment has no Rust toolchain (confirmed by direct attempt; see `docs/Pro Roadmap.md`), so this genuinely needs a real Windows build, and this build's central change (a new Windows-only crate calling `IFileOpenDialog` directly) is completely unverified until it compiles and runs there. Before anything else: select several files in one Open Audio operation and open the Open Audio Diagnostics panel in the footer immediately after. "Windows picker returned" is now the critical number, coming from a call that no longer touches `tauri-plugin-dialog` at all — the component 0.1.4's diagnostics implicated. If it still reports 1 regardless of selection size, that's strong evidence the issue is even lower-level (the underlying Windows shell/COM behavior on this specific machine), and worth a completely different kind of investigation than another code change. If it reports the real count, confirm every later stage matches through to "Documents opened," and confirm nothing from 0.1.2's standards pass (H1, skip links, footer, landmark structure) or the document/window title fix regressed. See `docs/Pro Roadmap.md` for the full history. After multi-file opening is confirmed working for real: a fair trial of the current document-switching combo box, then markers (Phase 6).
