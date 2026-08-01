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
];

// Reserved for future phases. Intentionally NOT wired to any key combo yet;
// listed here so the architecture already accounts for them and adding
// each one later is a config addition, not a redesign.
export const RESERVED_FUTURE_ACTIONS = [
  "previousMarker",
  "nextMarker",
  "insertMarker",
  "restartPlayback",
  "skipForward",
  "skipBackward",
  "jumpToBeginning",
  "jumpToEnd",
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
  if (tag === "input" || tag === "textarea" || tag === "select") return true;
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

/** Attach the single global keydown listener. Safe to call once at startup. */
export function initShortcutService() {
  if (listenerAttached) return;
  window.addEventListener("keydown", handleKeydown);
  listenerAttached = true;
}

/** Look up the display label (e.g. "Ctrl+Alt+R") for an action, for use in button text. */
export function getShortcutLabel(action) {
  const shortcut = SHORTCUTS.find((s) => s.action === action);
  return shortcut ? shortcut.label : "";
}
