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
//
// 0.2.6: hardened against rapid repeated calls to the same region racing
// each other — a real, concrete possibility this file's own code could
// cause (unlike a focused-control being re-announced, which a thorough
// audit of editorWindow.js found no mechanism for — see docs/Pro
// Roadmap.md, 0.2.6). Holding a key like Ctrl+Right Arrow down triggers
// OS keyboard auto-repeat, which can fire keydown events faster than the
// previous 30ms clear-then-set cycle below completes; without tracking
// the pending timeout, a burst of calls could each schedule their own
// `textContent = message` write, landing in an unpredictable order and
// potentially announcing a stale or out-of-sequence position. Each
// region now tracks its own pending timeout and cancels it before
// scheduling a new one, so only the most recent call in a rapid burst
// ever actually reaches the live region — the same "always the latest
// authoritative value, never a stale intermediate one" principle this
// app already applies to the playhead itself.

let politeRegion = null;
let assertiveRegion = null;
let politePendingTimeoutId = null;
let assertivePendingTimeoutId = null;

export function initAnnouncer() {
  politeRegion = document.getElementById("status-announcer");
  assertiveRegion = document.getElementById("alert-announcer");
}

function writeToRegion(region, message, getPendingId, setPendingId) {
  if (!region) return;

  const pendingId = getPendingId();
  if (pendingId !== null) {
    window.clearTimeout(pendingId);
    setPendingId(null);
  }

  // Clearing first ensures the message is re-announced even if it is
  // identical to the previous one (screen readers only announce on change).
  region.textContent = "";
  const id = window.setTimeout(() => {
    region.textContent = message;
    setPendingId(null);
  }, 30);
  setPendingId(id);
}

/** Announce a normal status update (recording/playback state, saves, etc). */
export function announceStatus(message) {
  writeToRegion(
    politeRegion,
    message,
    () => politePendingTimeoutId,
    (id) => (politePendingTimeoutId = id)
  );
}

/** Announce an error or something requiring immediate attention. */
export function announceAlert(message) {
  writeToRegion(
    assertiveRegion,
    message,
    () => assertivePendingTimeoutId,
    (id) => (assertivePendingTimeoutId = id)
  );
}
