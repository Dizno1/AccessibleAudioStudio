// shortcutService.js
// Centralized keyboard shortcut service.
//
// Design rules (do not violate these when adding future shortcuts):
//  - All shortcuts are declared in ONE config array below. Nothing outside
//    this file attaches its own keydown listeners for global shortcuts.
//  - Handlers are registered by action name via registerAction(), keeping
//    this file decoupled from the rest of the app. A handler returns
//    { executed: boolean, reason?: string, resultText?: string } so this
//    service can report what actually happened to the diagnostics module.
//  - Shortcuts never fire while focus is inside an editable field, so
//    normal typing is never interrupted. That case is still reported to
//    diagnostics (without running the handler or calling
//    preventDefault()), so a "shortcut did nothing" report can be told
//    apart from "shortcut never reached the app".
//  - Visible controls always remain the primary, fully-functional way to
//    do everything a shortcut does. Shortcuts are a supplement.
//  - This structure is built to support future user-customizable shortcuts:
//    SHORTCUTS below is the single place a remapping UI would need to read
//    and write.
//
// Ctrl+Alt+R is a toggle, deliberately mirroring the single Record button
// on a physical recorder: not recording -> starts recording; recording
// (or paused) -> stops recording. There is no separate "stop" shortcut.

import { recordShortcutEvent } from "./shortcutDiagnostics.js";

export const SHORTCUTS = [
  {
    action: "toggleRecording",
    combo: { ctrl: true, alt: true, key: "r" },
    label: "Ctrl+Alt+R",
    description: "Start or Stop Recording",
  },
  {
    action: "togglePauseResume",
    combo: { ctrl: true, alt: true, key: " " },
    label: "Ctrl+Alt+Space",
    description: "Pause or Resume Recording",
  },
  {
    action: "togglePlayPause",
    combo: { ctrl: true, alt: true, key: "p" },
    label: "Ctrl+Alt+P",
    description: "Play or Pause the selected recording",
  },

  // Audio Editor (Pro) — ordinary Windows document/editing conventions,
  // per the Pro roadmap's Keyboard Philosophy: reuse familiar shortcuts
  // rather than inventing new ones. Every one of these also has a plain
  // button in the Audio Editor panel.
  {
    action: "openAudio",
    combo: { ctrl: true, key: "o" },
    label: "Ctrl+O",
    description: "Open Audio",
  },
  {
    action: "newAudio",
    combo: { ctrl: true, key: "n" },
    label: "Ctrl+N",
    description: "New Audio",
  },
  {
    action: "saveAudio",
    combo: { ctrl: true, key: "s" },
    label: "Ctrl+S",
    description: "Save",
  },
  {
    action: "saveAudioAs",
    combo: { ctrl: true, shift: true, key: "s" },
    label: "Ctrl+Shift+S",
    description: "Save As",
  },
  {
    action: "copySelection",
    combo: { ctrl: true, key: "c" },
    label: "Ctrl+C",
    description: "Copy",
  },
  {
    action: "cutSelection",
    combo: { ctrl: true, key: "x" },
    label: "Ctrl+X",
    description: "Cut",
  },
  {
    action: "pasteSelection",
    combo: { ctrl: true, key: "v" },
    label: "Ctrl+V",
    description: "Paste",
  },
  {
    action: "undoEdit",
    combo: { ctrl: true, key: "z" },
    label: "Ctrl+Z",
    description: "Undo",
  },
  {
    action: "redoEdit",
    combo: { ctrl: true, key: "y" },
    label: "Ctrl+Y",
    description: "Redo",
  },

  // Stage 1 (Pro Roadmap): playhead navigation and audible scrubbing.
  // Deliberately bare, unmodified keys, matching the specified design —
  // see the "known risk" note in docs/Pro Roadmap.md's Stage 1 entry:
  // every one of these is exactly the category of keystroke a screen
  // reader's virtual cursor is most likely to intercept for its own
  // navigation before this app's own keydown handler ever sees it. This
  // has not been verified with real JAWS in this environment.
  {
    action: "navBack10",
    combo: { key: "arrowleft" },
    label: "Left Arrow",
    description: "Move playhead back 10 seconds",
  },
  {
    action: "navForward10",
    combo: { key: "arrowright" },
    label: "Right Arrow",
    description: "Move playhead forward 10 seconds",
  },
  {
    action: "navBack30",
    combo: { ctrl: true, key: "arrowleft" },
    label: "Ctrl+Left Arrow",
    description: "Move playhead back 30 seconds",
  },
  {
    action: "navForward30",
    combo: { ctrl: true, key: "arrowright" },
    label: "Ctrl+Right Arrow",
    description: "Move playhead forward 30 seconds",
  },
  {
    action: "jumpBeginning",
    combo: { key: "home" },
    label: "Home",
    description: "Move playhead to the beginning",
  },
  {
    action: "jumpEnd",
    combo: { key: "end" },
    label: "End",
    description: "Move playhead to the end",
  },
  {
    action: "scrubBack1",
    combo: { key: "u" },
    label: "U",
    description: "Audibly scrub backward 1 second",
  },
  {
    action: "scrubForward1",
    combo: { key: "i" },
    label: "I",
    description: "Audibly scrub forward 1 second",
  },
  {
    action: "scrubBack100ms",
    combo: { shift: true, key: "u" },
    label: "Shift+U",
    description: "Audibly scrub backward 100 milliseconds",
  },
  {
    action: "scrubForward100ms",
    combo: { shift: true, key: "i" },
    label: "Shift+I",
    description: "Audibly scrub forward 100 milliseconds",
  },
  {
    action: "scrubBack10ms",
    combo: { ctrl: true, shift: true, key: "u" },
    label: "Ctrl+Shift+U",
    description: "Audibly scrub backward 10 milliseconds",
  },
  {
    action: "scrubForward10ms",
    combo: { ctrl: true, shift: true, key: "i" },
    label: "Ctrl+Shift+I",
    description: "Audibly scrub forward 10 milliseconds",
  },
  {
    action: "auditionPlayback",
    combo: { key: " " },
    label: "Space",
    description: "Audition from the current position, without changing it",
  },
  {
    action: "locateAndLand",
    combo: { key: "x" },
    label: "X",
    description: "Play, then land the playhead where playback stops",
  },
  {
    action: "setMarkStart",
    combo: { key: "[" },
    label: "[",
    description: "Set the start Mark at the current position",
  },
  {
    action: "setMarkEnd",
    combo: { key: "]" },
    label: "]",
    description: "Set the end Mark at the current position",
  },
];

// Reserved for future phases. Intentionally NOT wired to any key combo yet;
// listed here so the architecture already accounts for them and adding
// each one later is a config addition, not a redesign. "skipForward",
// "skipBackward", "jumpToBeginning", "jumpToEnd" are now implemented above
// (navBack10/navForward10/jumpBeginning/jumpEnd) and removed from this list.
export const RESERVED_FUTURE_ACTIONS = [
  "previousMarker",
  "nextMarker",
  "insertMarker",
  "restartPlayback",
  "trimStart",
  "trimEnd",
  "normalizeAudio",
  "exportRecording",
];

const actionHandlers = new Map();
let listenerAttached = false;

/** Register the function to run when a given action's shortcut fires. */
export function registerAction(action, handler) {
  actionHandlers.set(action, handler);
}

function isEditableTarget(target) {
  if (!target) return false;
  const tag = target.tagName ? target.tagName.toLowerCase() : "";
  // Only literal text-entry controls need protection so normal typing (and
  // AltGr-style Ctrl+Alt character combos on some keyboard layouts) is
  // never interrupted. A <select> has no typing to protect — arrowing
  // through its options doesn't use Ctrl+Alt+<letter> — so shortcuts must
  // keep working while focus is on one. Suppressing them there was
  // effectively random: whichever control the user happened to have
  // focused (often a select, right after choosing a microphone or
  // profile) silently swallowed the next shortcut.
  if (tag === "input" || tag === "textarea") return true;
  if (target.isContentEditable) return true;
  return false;
}

function matchesCombo(event, combo) {
  const key = event.key ? event.key.toLowerCase() : "";
  const comboKey = combo.key.toLowerCase();
  return (
    !!event.ctrlKey === !!combo.ctrl &&
    !!event.altKey === !!combo.alt &&
    !!event.shiftKey === !!(combo.shift || false) &&
    key === comboKey
  );
}

function handleKeydown(event) {
  const shortcut = SHORTCUTS.find((s) => matchesCombo(event, s.combo));
  if (!shortcut) return; // not one of our combos; nothing useful to log

  if (isEditableTarget(event.target)) {
    // Recognized combo, but suppressed so normal typing is never
    // interrupted. Still reported so this is distinguishable from a
    // keystroke that never reached the app at all.
    recordShortcutEvent({
      label: shortcut.label,
      description: shortcut.description,
      executed: false,
      reason: "Focus was in a text field, so the shortcut was ignored and typing was not interrupted.",
    });
    return;
  }

  const handler = actionHandlers.get(shortcut.action);
  if (!handler) {
    recordShortcutEvent({
      label: shortcut.label,
      description: shortcut.description,
      executed: false,
      reason: "No handler is registered for this action.",
    });
    return;
  }

  event.preventDefault();
  const result = handler() || {};
  recordShortcutEvent({
    label: shortcut.label,
    description: shortcut.description,
    executed: !!result.executed,
    reason: result.reason,
    resultText: result.resultText,
  });
}

/**
 * Attach the single global keydown listener. Safe to call once at startup.
 *
 * Registered on the CAPTURE phase, not the default bubble phase — added
 * specifically because real Windows/JAWS testing (0.2.3) found bare
 * Left/Right Arrow silently not moving the playhead with the JAWS
 * virtual cursor off, while every other bare-key shortcut (Space, X,
 * U/I scrubbing) worked correctly in the same test. Direct simulation
 * of matchesCombo()/SHORTCUTS against real ArrowLeft/ArrowRight events
 * (see docs/Pro Roadmap.md, 0.2.4) proved the matching logic itself is
 * correct, and this page has no ARIA toolbar/tablist-style role and no
 * scrollable/overflow container that would explain native arrow-key
 * interception either — ruling those out left the event itself as the
 * remaining explanation: some native default handling for arrow keys
 * specifically (a well-documented category of behavior in embedded
 * WebView controls) most likely consumes/redirects the keydown before a
 * bubble-phase `window` listener ever runs. Listening on the capture
 * phase runs this handler, and its `preventDefault()` call, as early in
 * the event's lifecycle as JavaScript can — before any other handler,
 * native or otherwise, gets a chance to intercept it — which is the
 * standard, minimal fix for exactly this class of issue. This changes
 * nothing about which keys map to which actions, or what any handler
 * does; only when this one listener runs.
 */
export function initShortcutService() {
  if (listenerAttached) return;
  window.addEventListener("keydown", handleKeydown, true);
  listenerAttached = true;
}

/** Look up the display label (e.g. "Ctrl+Alt+R") for an action, for use in button text. */
export function getShortcutLabel(action) {
  const shortcut = SHORTCUTS.find((s) => s.action === action);
  return shortcut ? shortcut.label : "";
}
