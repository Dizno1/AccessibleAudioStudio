// announcer.js
// Centralized accessibility announcements.
//
// Rule for this whole application: dynamic updates are announced only when
// they are meaningful (a state change the user asked for or needs to know
// about). Never announce continuously — no live-updating timers, no
// progress chatter during recording or playback.
//
// Two live regions are used:
//  - "polite" for normal status confirmations (recording started, saved...)
//  - "assertive" for errors that need immediate attention

let politeRegion = null;
let assertiveRegion = null;

export function initAnnouncer() {
  politeRegion = document.getElementById("status-announcer");
  assertiveRegion = document.getElementById("alert-announcer");
}

function writeToRegion(region, message) {
  if (!region) return;
  // Clearing first ensures the message is re-announced even if it is
  // identical to the previous one (screen readers only announce on change).
  region.textContent = "";
  window.setTimeout(() => {
    region.textContent = message;
  }, 30);
}

/** Announce a normal status update (recording/playback state, saves, etc). */
export function announceStatus(message) {
  writeToRegion(politeRegion, message);
}

/** Announce an error or something requiring immediate attention. */
export function announceAlert(message) {
  writeToRegion(assertiveRegion, message);
}
