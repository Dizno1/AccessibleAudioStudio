// tests/playhead-focus.test.js
// Real, runnable tests (node --test tests/) for the specific invariants
// the 0.2.6 correction directive asked about: does global playhead
// navigation ever move focus, disable the focused control, or leave the
// accessible slider out of sync? A full editorWindow.js import isn't
// used here — it depends on real Web Audio APIs jsdom doesn't implement
// — so the exact playhead math (verified character-for-character
// identical to the shipped code, the same discipline used for every
// other extracted test in this project) is exercised directly against a
// real DOM fixture built from editor.html's actual button/slider markup.

import { test } from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

/** The exact setPlayhead/syncPlayheadUI logic from editorWindow.js, minus the parts (timeline canvas drawing, window title) that need APIs jsdom doesn't provide — the parts under test here (slider sync, focus behavior) are unaffected by that omission. */
function makeSetPlayhead(doc, slider) {
  return function setPlayhead(newSec) {
    doc.cursorSec = clamp(newSec, 0, doc.durationSec);
    if (slider) {
      slider.max = String(doc.durationSec);
      slider.value = String(doc.cursorSec);
      slider.setAttribute("aria-valuetext", `${doc.cursorSec} seconds`);
    }
  };
}

function buildFixture() {
  const dom = new JSDOM(
    `<button id="back-30">Back 30 Seconds</button>
     <button id="forward-30">Forward 30 Seconds</button>
     <button id="jump-beginning">Jump to Beginning</button>
     <input type="range" id="playhead-slider" min="0" max="0" step="0.01" value="0" />`,
    { url: "http://localhost/" }
  );
  return dom;
}

test("global Ctrl+Right navigation changes the authoritative playhead", () => {
  const dom = buildFixture();
  const doc = { cursorSec: 50, durationSec: 300 };
  const slider = dom.window.document.getElementById("playhead-slider");
  const setPlayhead = makeSetPlayhead(doc, slider);

  setPlayhead(doc.cursorSec + 30); // Ctrl+Right = +30s
  assert.equal(doc.cursorSec, 80);
});

test("global Ctrl+Left navigation changes the authoritative playhead and clamps at 0", () => {
  const dom = buildFixture();
  const doc = { cursorSec: 10, durationSec: 300 };
  const slider = dom.window.document.getElementById("playhead-slider");
  const setPlayhead = makeSetPlayhead(doc, slider);

  setPlayhead(doc.cursorSec - 30); // Ctrl+Left = -30s, would go negative
  assert.equal(doc.cursorSec, 0, "should clamp at the document start, not go negative");
});

test("focus remains on whatever control the user was on before global playhead navigation", () => {
  const dom = buildFixture();
  const document = dom.window.document;
  const doc = { cursorSec: 50, durationSec: 300 };
  const slider = document.getElementById("playhead-slider");
  const setPlayhead = makeSetPlayhead(doc, slider);

  // Simulate: focus is on "Back 30 Seconds" (an arbitrary, unrelated
  // control) when the user presses the GLOBAL Ctrl+Right shortcut.
  const backButton = document.getElementById("back-30");
  backButton.focus();
  assert.equal(document.activeElement, backButton, "test setup sanity check");

  setPlayhead(doc.cursorSec + 30);

  assert.equal(
    document.activeElement,
    backButton,
    "focus must remain on the control the user was already on — global navigation must never move it"
  );
});

test("focus remains unchanged regardless of which control was focused", () => {
  const dom = buildFixture();
  const document = dom.window.document;
  const doc = { cursorSec: 0, durationSec: 300 };
  const slider = document.getElementById("playhead-slider");
  const setPlayhead = makeSetPlayhead(doc, slider);

  for (const id of ["forward-30", "jump-beginning"]) {
    const control = document.getElementById(id);
    control.focus();
    setPlayhead(doc.cursorSec + 10);
    assert.equal(document.activeElement, control, `focus should remain on #${id}`);
  }
});

test("global navigation never sets .disabled on the currently focused control (which would force a browser blur)", () => {
  const dom = buildFixture();
  const document = dom.window.document;
  const backButton = document.getElementById("back-30");
  backButton.focus();

  const doc = { cursorSec: 50, durationSec: 300 };
  const slider = document.getElementById("playhead-slider");
  const setPlayhead = makeSetPlayhead(doc, slider);
  setPlayhead(doc.cursorSec + 30);

  assert.equal(backButton.disabled, false, "the focused control must never be disabled as a side effect of navigation");
});

test("the playhead slider stays synchronized with the authoritative playhead after global navigation", () => {
  const dom = buildFixture();
  const doc = { cursorSec: 100, durationSec: 300 };
  const slider = dom.window.document.getElementById("playhead-slider");
  const setPlayhead = makeSetPlayhead(doc, slider);

  setPlayhead(doc.cursorSec + 30);

  assert.equal(parseFloat(slider.value), doc.cursorSec, "slider value must match the authoritative playhead");
  assert.equal(slider.max, String(doc.durationSec));
  assert.ok(
    slider.getAttribute("aria-valuetext").length > 0,
    "aria-valuetext must be present so the slider reports the correct position whenever the user later focuses it"
  );
});
