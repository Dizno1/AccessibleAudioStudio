# Screen Reader First Principles

These principles govern every feature in AccessibleAudioStudio, in every phase. They are not a checklist applied at the end of development — they are the starting point for every design decision.

## 1. Screen Reader First

Every feature is designed by asking "how does this work through a screen reader?" before "how does this look?" A feature that works visually but cannot be operated non-visually is not done.

## 2. Keyboard First

Everything must be fully operable from the keyboard. Mouse or touch interaction may be added, but never as the only way to do something. Focus order follows a logical, predictable sequence that matches the visual and heading structure.

## 3. Browser Standards First

Use native HTML elements and ARIA only where native semantics fall short. Native controls (`button`, `select`, `details`/`summary`, `audio`) carry accessibility support for free and behave predictably across screen readers. Custom widgets are used only when no standard element covers the need, and only when built to full ARIA authoring practices.

## 4. Local First

Recordings and their metadata live on the user's own device. No cloud dependency, no account, no network requirement to record, play back, or manage a library.

## 5. Preserve Original Recordings

A saved recording's audio data is never silently modified. Metadata (name, notes) can be edited; the underlying audio the user recorded is preserved exactly as captured.

## 6. Progressive Disclosure

Show what is needed for the current task first. Secondary or advanced information (like the keyboard shortcut reference) is available but tucked behind a single, clearly labeled disclosure rather than crowding the primary workflow.

## 7. Professional Features Without Visual Dependence

Capability is never traded away for accessibility, and accessibility is never traded away for capability. Every professional feature — recording profiles, a real library, precise playback control — must be expressed in a way that is fully meaningful without sight.

## Hard rules

These are not guidelines; they are constraints every feature must satisfy:

- **Never design around drag-and-drop.** If a workflow can only be expressed as drag-and-drop, it needs a different workflow.
- **Never require interpreting a waveform.** No feature may depend on the user visually reading a waveform, spectrogram, or timeline shape.
- **Never hide important information inside graphics.** Anything a sighted user needs to know must exist as real text or accessible markup, not as an image, icon-only button, or canvas drawing.
- **Never move keyboard focus unexpectedly.** Focus only moves as the direct, predictable result of something the user did (e.g. completing a save moves focus to the confirmation/next step). It never jumps because of a background timer, an animation, or an unrelated event.
- **Dynamic updates are announced only when they are meaningful.** No continuous chatter during recording or playback (no ticking timers, no per-frame updates). Status changes — started, paused, stopped, saved, an error — are announced once, clearly, and only once.
- **Durations are spoken in natural language.** "2 minutes 36 seconds," never "2:36." Raw digit-based time formatting is not read in a way that makes sense by a screen reader and is never used for anything the user hears or reads as a duration.
