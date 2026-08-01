# Release

This folder is where built Windows installer packages for AccessibleAudioStudio go before publishing (e.g. as a GitHub Release, or for direct download from OpenDoorDesign.org).

## Why this folder has no installer files in this delivery

Producing a real Windows `.msi`/`.exe` requires actually running the build on Windows -- that's not something that can be done from the Linux environment this repository is assembled in, and it isn't something to fake with placeholder files. **No installer in this folder is real until it was produced by an actual build**, either the automated one below or a manual one on a real Windows machine.

## Recommended: let GitHub build it for you

This repository includes `.github/workflows/build-windows.yml`, which builds the actual installers on a genuine Windows machine (GitHub's own `windows-latest` runners) -- no local Windows install needed on your end at all.

1. Push this repository to GitHub (if it isn't already).
2. Tag a release and push the tag:
   ```
   git tag v1.0.0
   git push origin v1.0.0
   ```
3. GitHub Actions runs automatically, builds both installers on a real Windows VM, and creates a **draft** GitHub Release with them attached.
4. Open the draft release on GitHub, review it, download the two files, and place them here in `Release/` (GitHub Releases is itself a fine place to host the public download links -- mirroring the files here too keeps a local copy in the repo history).
5. When ready, publish the draft release.

You can also trigger a build without tagging -- go to the Actions tab, choose "Build Windows Installer," and click "Run workflow." That builds the installers and attaches them to the workflow run as downloadable artifacts, without creating a release. Good for testing a change before cutting a real version.

Either way, this is a real build on a real Windows machine, producing real, working installer files -- not something assembled or guessed at outside of Windows.

## Alternative: build locally on Windows

If you'd rather build on your own Windows machine instead of using GitHub Actions, follow `README.md`, "Building the Windows Application," which covers installing Rust, the MSVC Build Tools, WiX, and Node, then running `npm run desktop:build`. Copy the resulting files here:

| Expected file | Produced by | Notes |
|---|---|---|
| `AccessibleAudioStudio_1.0.0_x64_en-US.msi` | WiX (msi) target | Recommended installer -- standard Windows Installer package |
| `AccessibleAudioStudio_1.0.0_x64-setup.exe` | NSIS target | Alternate installer -- setup executable |

Exact filenames depend on the Tauri/WiX/NSIS versions used at build time -- check `src-tauri/target/release/bundle/msi/` and `src-tauri/target/release/bundle/nsis/` after a successful build and copy whatever was actually produced there, updating the table above (including real file sizes) to match.

## Before publishing a release

- Confirm the version in `src-tauri/tauri.conf.json` and `src-tauri/Cargo.toml` matches the release you're cutting.
- Confirm `--color-accent` in `app/css/styles.css` is the actual approved Open Door green, not the placeholder value — see `docs/Roadmap.md`, "Design-Standards Compliance Review."
- Install the generated `.msi` (or `.exe`) on an actual Windows machine (a fresh VM is ideal) and confirm, in order: it installs and appears in the Start Menu; it launches; microphone access works; a recording can be started, stopped, and played back; a saved recording appears correctly in the Recording Library; Ctrl+Alt+R and Ctrl+Alt+P both work; the app is fully keyboard and screen-reader navigable (JAWS and/or NVDA); and uninstalling through Windows Settings removes it completely.
- Run the design-standards testing gaps that couldn't be verified without a real browser/display in front of them: an automated accessibility check (axe or Lighthouse), 400% zoom, 320px/280px CSS reflow, Windows forced-colors/high-contrast mode, and a pass with Narrator and/or VoiceOver and in Edge/Firefox if those are in scope. See `docs/Roadmap.md`, "Design-Standards Compliance Review," for the full list.
- See `README.md`, "GitHub Releases," for how to publish these files alongside release notes and version history.
