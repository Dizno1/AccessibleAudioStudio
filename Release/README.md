# Release

This folder is where built Windows installer packages for **AccessibleAudioStudio Pro** go before publishing (e.g. as a GitHub Release, or for direct download from OpenDoorDesign.org). Pro installs side by side with the free AccessibleAudioStudio -- see `README.md`, "Application identity" -- so files here are always the Pro build, distinguishable by name and version from any free-edition installer.

## Why this folder has no installer files in this delivery

Producing a real Windows `.msi`/`.exe` requires actually running the build on Windows -- that's not something that can be done from the Linux environment this repository is assembled in, and it isn't something to fake with placeholder files. **No installer in this folder is real until it was produced by an actual build**, either the automated one below or a manual one on a real Windows machine.

## Recommended: let GitHub build it for you

This repository includes `.github/workflows/build-windows.yml`, which builds the actual installers on a genuine Windows machine (GitHub's own `windows-latest` runners) -- no local Windows install needed on your end at all.

1. Push this repository to GitHub (if it isn't already).
2. Tag a Pro release and push the tag:
   ```
   git tag pro-v0.2.1
   git push origin pro-v0.2.1
   ```
   Use the current version from `src-tauri/tauri.conf.json` -- see `README.md`, "Pro version numbering." Every Pro test build gets its own incremented version and its own tag; never reuse a version number for a different build.
3. GitHub Actions runs automatically, builds both installers on a real Windows VM, and creates a **draft** GitHub Release with them attached.
4. Open the draft release on GitHub, review it, download the two files, and place them here in `Release/` (GitHub Releases is itself a fine place to host the public download links -- mirroring the files here too keeps a local copy in the repo history).
5. When ready, publish the draft release.

You can also trigger a build without tagging -- go to the Actions tab, choose "Build Windows Installer," and click "Run workflow." That builds the installers and attaches them to the workflow run as downloadable artifacts, without creating a release. Good for testing a change before cutting a real version.

Either way, this is a real build on a real Windows machine, producing real, working installer files -- not something assembled or guessed at outside of Windows.

## Alternative: build locally on Windows

If you'd rather build on your own Windows machine instead of using GitHub Actions, follow `README.md`, "Building the Windows Application," which covers installing Rust, the MSVC Build Tools, WiX, and Node, then running `npm run desktop:build`. Copy the resulting files here:

| Expected file | Produced by | Notes |
|---|---|---|
| `AccessibleAudioStudio Pro_0.2.1_x64_en-US.msi` | WiX (msi) target | Recommended installer -- standard Windows Installer package |
| `AccessibleAudioStudio Pro_0.2.1_x64-setup.exe` | NSIS target | Alternate installer -- setup executable |

Exact filenames depend on the Tauri/WiX/NSIS versions and the current version in `src-tauri/tauri.conf.json` at build time -- check `src-tauri/target/release/bundle/msi/` and `src-tauri/target/release/bundle/nsis/` after a successful build and copy whatever was actually produced there, updating the table above (including real file sizes) to match. The filename always reflects the app's current product name and version automatically -- there is nothing to configure separately for this.

## Before publishing a release

- Confirm the version is identical and current across `src-tauri/tauri.conf.json`, `src-tauri/Cargo.toml`, and `package.json` -- see `README.md`, "Pro version numbering." Never publish a build whose version has already been used for a different build.
- Confirm the product name, Tauri identifier, and window title still say "AccessibleAudioStudio Pro" (not "AccessibleAudioStudio") in `src-tauri/tauri.conf.json` and `src-tauri/Cargo.toml`, and that the identifier is still `org.opendoordesign.accessibleaudiostudio.pro` -- this is what keeps Pro from colliding with the free edition on install. See `README.md`, "Application identity."
- Confirm `--color-accent` in `app/css/styles.css` is the actual approved Open Door green, not the placeholder value — see `docs/Roadmap.md`, "Design-Standards Compliance Review."
- Install the generated `.msi` (or `.exe`) on an actual Windows machine (a fresh VM is ideal) and confirm, in order: it installs and appears in the Start Menu as "AccessibleAudioStudio Pro"; it launches with a window titled "AccessibleAudioStudio Pro"; microphone access works; a recording can be started, stopped, and played back; a saved recording appears correctly in the Recording Library; the Audio Editor (Pro) panel opens, edits, and saves audio correctly; Ctrl+Alt+R and Ctrl+Alt+P both work; the app is fully keyboard and screen-reader navigable (JAWS and/or NVDA); and uninstalling through Windows Settings removes only AccessibleAudioStudio Pro, leaving a separately-installed free AccessibleAudioStudio (if present) untouched.
- Run the design-standards testing gaps that couldn't be verified without a real browser/display in front of them: an automated accessibility check (axe or Lighthouse), 400% zoom, 320px/280px CSS reflow, Windows forced-colors/high-contrast mode, and a pass with Narrator and/or VoiceOver and in Edge/Firefox if those are in scope. See `docs/Roadmap.md`, "Design-Standards Compliance Review," for the full list.
- See `README.md`, "GitHub Releases," for how to publish these files alongside release notes and version history.
