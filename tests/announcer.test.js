// tests/announcer.test.js
// Real, runnable tests (node --test tests/) for announcer.js — added in
// 0.2.6 to verify, rather than merely assert, the specific behaviors the
// correction directive for that build asked about: a single, clean
// standards-based live region per purpose, and no interleaved/queued
// intermediate announcements during rapid repeated calls (the concrete,
// verifiable improvement 0.2.6 could make — see docs/Pro Roadmap.md for
// what could and couldn't be confirmed about the originally-reported
// "focused control gets announced" symptom itself).

import { test } from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";

async function freshAnnouncer() {
  const dom = new JSDOM(
    '<div id="status-announcer" role="status" aria-live="polite" aria-atomic="true"></div>' +
      '<div id="alert-announcer" role="alert" aria-live="assertive" aria-atomic="true"></div>',
    { url: "http://localhost/" }
  );
  global.window = dom.window;
  global.document = dom.window.document;

  // Re-import fresh each time (module-level state in announcer.js would
  // otherwise leak between tests) by busting the module cache via a
  // unique query string.
  const mod = await import(`../app/js/announcer.js?t=${Date.now()}-${Math.random()}`);
  mod.initAnnouncer();
  return { dom, mod, politeRegion: document.getElementById("status-announcer"), alertRegion: document.getElementById("alert-announcer") };
}

test("only one polite and one assertive live region exist, per the app's own markup", async () => {
  const { dom } = await freshAnnouncer();
  const liveRegions = dom.window.document.querySelectorAll("[aria-live]");
  assert.equal(liveRegions.length, 2, "expected exactly one polite and one assertive region, no competing extras");
});

test("announceStatus writes only the given message, nothing prepended", async () => {
  const { mod, politeRegion } = await freshAnnouncer();
  mod.announceStatus("1 minute 30 seconds");
  await new Promise((resolve) => setTimeout(resolve, 60));
  assert.equal(politeRegion.textContent, "1 minute 30 seconds");
});

test("a rapid burst of announceStatus calls (simulating OS key-repeat) results in exactly one announced value, not several queued intermediate ones", async () => {
  const { mod, politeRegion } = await freshAnnouncer();

  const written = [];
  let realText = "";
  Object.defineProperty(politeRegion, "textContent", {
    get() {
      return realText;
    },
    set(v) {
      realText = v;
      if (v !== "") written.push(v);
    },
    configurable: true,
  });

  // ~15ms apart — faster than the 30ms clear-then-set cycle, matching
  // realistic OS keyboard auto-repeat timing for a held Ctrl+Right.
  mod.announceStatus("10 seconds");
  await new Promise((r) => setTimeout(r, 15));
  mod.announceStatus("20 seconds");
  await new Promise((r) => setTimeout(r, 15));
  mod.announceStatus("30 seconds");
  await new Promise((r) => setTimeout(r, 60));

  assert.deepEqual(
    written,
    ["30 seconds"],
    "only the final value in a rapid burst should ever reach the live region"
  );
});

test("announceStatus and announceAlert do not interfere with each other's pending timeouts", async () => {
  const { mod, politeRegion, alertRegion } = await freshAnnouncer();
  mod.announceStatus("Selection cut.");
  mod.announceAlert("There is no selection to cut.");
  await new Promise((resolve) => setTimeout(resolve, 60));
  assert.equal(politeRegion.textContent, "Selection cut.");
  assert.equal(alertRegion.textContent, "There is no selection to cut.");
});
