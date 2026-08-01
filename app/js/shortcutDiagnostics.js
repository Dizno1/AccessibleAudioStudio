// shortcutDiagnostics.js
// A tiny diagnostic record of the most recent keyboard shortcut the
// application detected, and what happened as a result. This exists so a
// shortcut problem can be quickly classified: did the keystroke never
// reach the app (nothing recorded), was it swallowed while typing in a
// field, was there no handler for it, or did the handler run but decline
// to act (e.g. no recording selected)?
//
// This module only tracks state and notifies listeners — it renders
// nothing itself.

let lastEvent = null;
const listeners = new Set();

/**
 * @param {Object} event
 * @param {string} event.label - e.g. "Ctrl+Alt+R"
 * @param {string} event.description - e.g. "Start or Stop Recording"
 * @param {boolean} event.executed - whether an action actually ran
 * @param {string} [event.reason] - why it was ignored, if not executed
 * @param {string} [event.resultText] - what happened, if executed
 */
export function recordShortcutEvent(event) {
  lastEvent = { ...event, timestamp: new Date() };
  listeners.forEach((fn) => fn(lastEvent));
}

export function getLastShortcutEvent() {
  return lastEvent;
}

/** Subscribe to future shortcut events. Returns an unsubscribe function. */
export function onShortcutEvent(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}
