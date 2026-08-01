# Roadmap

## Status: Phase 1 (web) complete, plus two accessibility refinement passes; Phase 2 (Windows packaging) configured, not yet built

Phase 1 delivers a dependable, fully keyboard- and screen-reader-accessible recording foundation and is considered feature-complete for Version 1.0. Two follow-up refinement passes (below) corrected a real keyboard-shortcut bug, substantially reduced how much the application speaks automatically, and eliminated focus/DOM instability that was causing extra screen-reader chatter beyond the application's own announcements. Phase 2 packages this same, unmodified application as a native Windows desktop app.

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
- Ctrl+Alt+P (Play/Pause) was reported as not firing during initial testing. Two related root causes have since been fixed (the `<select>` suppression bug, and disabling controls that could hold focus), which plausibly explains the original report — but it hasn't been explicitly retested since these fixes landed. Worth confirming with the Keyboard Shortcut Diagnostics panel.

## Design-Standards Compliance Review

An audit against Open Door Design's actual standards found that the CSS in this app was never checked against the DesignPhilosophyAndStandards repository during Phase 1 — it used an arbitrary blue accent color chosen independently, in direct conflict with the standing instruction to treat that repository as the design/accessibility authority for every Open Door Design project, including its blue-and-green color-pairing guardrail. That's a real process miss, not a stylistic judgment call, and it's recorded here as one.

### Fixed

- **Color:** `--color-accent` changed from blue (`#1c4e80`) to green (`#1b5e20`), used consistently for primary buttons, button-links, focus outlines, and the selected-recording border. Verified at ~7.9:1 contrast against white (comfortably past AA). **This is a placeholder, not the actual approved Open Door green** — this development environment has no access to fetch the real token from the DesignPhilosophyAndStandards repository. Replace `--color-accent` in `app/css/styles.css` with the real value and re-verify contrast once available.
- **Touch targets:** buttons, button-links, and form controls now have `min-height`/`min-width: 3rem` (48px), matching the standing 3rem touch-target standard (stricter than the 44px/48px range a design review suggested, and used instead of it).
- **Post-save focus target:** after saving, focus now moves to the saved recording's own heading in the library (a real, named element — e.g. "Quick Note – 8/1/2026") instead of an empty generic container. The previous approach technically worked (a `tabindex="-1"` was set immediately before the `.focus()` call), but landing on content with no accessible name of its own wasn't a meaningful destination.
- **Page title:** changed from `AccessibleAudioStudio` to `Audio Recording - AccessibleAudioStudio`, per the Application Structure Standard's page-name-first convention. The installed desktop app's window title is unaffected (still "AccessibleAudioStudio" — see `src-tauri/tauri.conf.json`).
- **Reduced motion and forced-colors:** added a `prefers-reduced-motion` reset (defensive — there's no motion in the app currently, but this closes the gap for anything added later) and an explicit `forced-colors: active` rule keeping the focus outline and selected-recording border visible under Windows High Contrast rather than relying on their default color-based rendering alone.
- Disabled-control text darkened slightly (`#666` → `#595959`) for a more comfortable ~5.3:1 contrast, even though WCAG doesn't require AA contrast for disabled controls.

### Accepted for Version 1.0, not fixed

- **Native browser dialogs** (`window.prompt`/`window.confirm` for Rename, Edit Notes, Delete, Record Again) don't fully follow the documented Open Door Dialog Pattern (named application dialog, predictable focus return, Escape behavior, reflow/zoom support, consistent Open Door styling). Explicitly accepted as a Version 1.0 limitation rather than a blocker — a future maintenance release could replace them with an accessible in-app dialog component.

### Still open — requires real-environment testing this text-based environment cannot perform

- Automated accessibility checks (axe, Lighthouse, etc.)
- 400% zoom and 320px/280px CSS reflow
- Windows forced-colors / high-contrast mode (the CSS change above is a starting point, not a verified pass)
- Narrator, VoiceOver (if mobile use is expected), and cross-browser testing in Edge and Firefox (JAWS/NVDA/Chrome have been tested)

None of these are confirmed defects — they're gaps in what could be verified without a real browser, a real screen reader, and a real display in front of them, exactly as flagged in the review that prompted this pass. They belong in the pre-publish checklist in `Release/README.md` alongside the existing Windows-installer testing steps.

## Phase 2: Windows Packaging (Tauri)

Packages the exact same, unmodified web application from Phase 1 as a native Windows desktop app, using Tauri to host it in Windows' built-in WebView2 runtime rather than a browser tab. See `README.md`, "Building the Windows Application," for full instructions.

### Completed

- `src-tauri/` — complete Tauri v2 project: `Cargo.toml`, `tauri.conf.json`, `build.rs`, `src/main.rs`, and a minimal `capabilities/default.json` (this app calls no Tauri commands at all — microphone, recording, playback, and storage are all standard web APIs the WebView2 runtime provides directly, so almost no Tauri permissions are needed).
- Window configured per the spec: titled "AccessibleAudioStudio," 1000×800 default, 700×500 minimum, resizable, centered on first launch.
- Size and position persistence across launches via `tauri-plugin-window-state`, rather than custom code.
- No browser chrome by construction (Tauri windows never have tabs/address bar/menus — there's no browser present to have them), and devtools are stripped automatically from release builds.
- Bundle configuration for both a `.msi` (WiX) and a `.exe` (NSIS) installer, both configured to create Start Menu shortcuts, register normally with Windows, and support uninstall through Windows Settings; NSIS additionally offers an optional desktop shortcut during setup.
- Application identity (name, publisher, version, description) set to match the spec exactly, in both `tauri.conf.json` and `Cargo.toml`.
- A placeholder icon set (`src-tauri/icons/`) so the project builds out of the box — a simple microphone glyph, clearly flagged in the README as needing to be swapped for Open Door Design's real branding before a public release.
- Root `package.json` with the Tauri CLI as its only dependency and `desktop:dev`/`desktop:build` scripts — the web app itself still requires no build step.
- `scripts/prepare-dist.js` — copies `index.html` and `app/` into a gitignored `dist/` folder before every desktop dev/build run. `index.html` and `app/` at the repository root remain the single source of truth (what GitHub Pages serves); `dist/` is a disposable, always-fresh copy, never hand-edited.
- `Release/` folder with a README documenting exactly what installer files belong there and a pre-publish testing checklist.
- `README.md` updated with full build prerequisites, build/release commands, icon-replacement notes, and a documented GitHub Releases process.
- `.github/workflows/build-windows.yml` — a GitHub Actions workflow that builds the actual installers on a real, GitHub-hosted Windows machine (`windows-latest`) and, on a version-tag push, opens a draft GitHub Release with them attached automatically. This is the recommended path to a real installer, since it needs no local Windows machine.

### Fixed — `frontendDist` build failure

The first real GitHub Actions build attempt failed immediately with a Tauri configuration error: `frontendDist` was set to `"../"` (the repository root), and Tauri correctly refused to bundle a frontend directory that also contained `src-tauri/`, `node_modules/`, and other non-web-asset folders.

Root cause: the initial packaging pass pointed `frontendDist` straight at the repository root instead of an isolated folder, since the app has no build step and everything needed (`index.html`, `app/`) already lived there. That convenience is exactly what the error was catching.

Fix: `frontendDist` now points at a dedicated `dist/` folder (`"../dist"` in `src-tauri/tauri.conf.json`), populated by `scripts/prepare-dist.js` immediately before every `tauri dev`/`tauri build` run via the `beforeDevCommand`/`beforeBuildCommand` hooks. `dist/` contains only `index.html` and `app/` — nothing else — and is regenerated fresh every time rather than committed, so there's no second copy of the app to keep in sync by hand. GitHub Pages is unaffected: it still serves `index.html`/`app/` directly from the repository root, unchanged.

### Not done — a real installer has never been built

**No `.msi` or `.exe` exists yet, anywhere.** Multiple build attempts have been made in this project's development environment (a Linux sandbox with no Rust toolchain and no network access to install one); all correctly concluded that a real Windows installer cannot be produced there, and none fabricated placeholder or fake binary files to paper over that — a fake `.msi` would be worse than no `.msi` at all. Tauri's Windows installer targets require Windows itself to build.

The `.github/workflows/build-windows.yml` workflow exists specifically to close this gap without requiring anyone to own a Windows dev machine: pushing a version tag runs a genuine build on a genuine Windows VM and produces genuine installer files. The first real run of that workflow failed with the `frontendDist` error described above — now fixed. **The workflow has not yet been re-run since the fix**, so it still hasn't successfully produced installer files. The concrete next action is the same as before: push this repository (with the fix) to GitHub and either push a tag or trigger the workflow manually — see `README.md`, "Building the Windows Application," and `Release/README.md`.

Until a build has actually run and the result has been installed and tested on real Windows with a real screen reader, treat Phase 2 as configured but unverified — not done.

## Planned future phases (not yet scheduled)

These are directional, not committed:

- **Phase 3 — Editing foundations:** trimming, markers (previous/next/insert), non-destructive edit history, still screen-reader-first with no waveform interaction required.
- **Phase 4 — Transcription:** on-device or opt-in cloud transcription, transcript displayed and navigable as text.
- **Phase 5 — Audio enhancement:** normalization, noise reduction as an explicit, reviewable action (never automatic/invisible).
- **Phase 6 — VoiceOfOpenDoor integration:** connecting recorded material to Open Door Design's synthetic voice project where relevant.
- **Ongoing — Customizable shortcuts:** a settings UI reading and writing the shortcut configuration described above.

## Recommended next phase

**Immediately: supply the actual approved green token (and any other CSS values worth double-checking) from the DesignPhilosophyAndStandards repository**, so `--color-accent` in `app/css/styles.css` can be corrected from its current placeholder. In parallel, **push this repository to GitHub and run the Windows build workflow** (tag push or manual trigger — see `README.md`, "Building the Windows Application") to produce the first real installer files, then run through `Release/README.md`'s pre-publish checklist — including the design-standards testing gaps above and a real screen reader pass — before treating Phase 2 as done. After that, **Phase 3: Editing foundations (trimming and markers)**, building directly on the reserved shortcut actions and the "Preserve Original Recordings" principle — edits should be represented as non-destructive instructions layered on top of the original audio, never as in-place modification of the saved recording.
