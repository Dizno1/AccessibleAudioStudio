// prepare-dist.js
//
// Assembles dist/ — the isolated frontend distribution folder Tauri's
// `build.frontendDist` points at — by copying only the production web
// application files out of the repository root.
//
// Why this exists: Tauri requires frontendDist to be a folder containing
// ONLY the web assets. Pointing it at the repository root (as the initial
// packaging pass did) fails, because the root also contains src-tauri/,
// node_modules/, .git/, .github/, tests/, and docs/ — none of which belong
// in a frontend distribution folder.
//
// Why this is a copy step rather than two hand-maintained copies of the
// app: index.html and app/ at the repository root remain the single
// source of truth — that's what GitHub Pages serves directly, unchanged.
// This script only ever reads from there and writes into dist/, which is
// regenerated fresh before every desktop build (see the
// beforeDevCommand/beforeBuildCommand hooks in src-tauri/tauri.conf.json)
// and is never itself committed or hand-edited. There is exactly one
// place to fix an accessibility bug or add a feature: the root files.
//
// Plain Node.js (no dependencies) so it runs identically on the Windows
// GitHub Actions runner, a local Windows machine, and this repo's own
// Linux/macOS dev environments.

const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const DIST = path.join(ROOT, "dist");

// Only production web application files — nothing else. This list is the
// enforcement point for "do not include src-tauri, node_modules, .git,
// .github, tests, or documentation" — it is an explicit allowlist, not an
// exclude list, so nothing new at the repo root can accidentally leak in.
const INCLUDE = [
  "index.html",
  "app", // app/css and app/js
];

function rmDist() {
  if (fs.existsSync(DIST)) {
    fs.rmSync(DIST, { recursive: true, force: true });
  }
}

function copyRecursive(src, dest) {
  const stat = fs.statSync(src);
  if (stat.isDirectory()) {
    fs.mkdirSync(dest, { recursive: true });
    for (const entry of fs.readdirSync(src)) {
      copyRecursive(path.join(src, entry), path.join(dest, entry));
    }
  } else {
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.copyFileSync(src, dest);
  }
}

function main() {
  rmDist();
  fs.mkdirSync(DIST, { recursive: true });

  for (const relPath of INCLUDE) {
    const src = path.join(ROOT, relPath);
    if (!fs.existsSync(src)) {
      throw new Error(`prepare-dist: expected source path is missing: ${relPath}`);
    }
    copyRecursive(src, path.join(DIST, relPath));
  }

  console.log(`prepare-dist: wrote ${INCLUDE.join(", ")} to dist/`);
}

main();
