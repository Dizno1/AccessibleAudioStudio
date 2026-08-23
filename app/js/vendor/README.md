# Vendored third-party code

## lame.min.js

Pure-JavaScript MP3 encoder ("lamejs" by Alex Zhukov, based on the LAME
encoder), vendored here so AccessibleAudioStudio Pro can write MP3 files
entirely in the browser/desktop app with no server and no build step.

- Source: https://github.com/zhuker/lamejs (npm package `lamejs`, version 1.2.1)
- License: LGPL-3.0 (see LICENSE-lamejs.txt in this folder)
- Unmodified from the published npm package.

Loaded as a plain classic script (not an ES module) in index.html, before
main.js. It attaches a single global, `window.lamejs`, exposing
`lamejs.Mp3Encoder`. `app/js/audioCodec.js` is the only file that touches
this global.
