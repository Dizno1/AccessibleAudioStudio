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

## 8. Silence Is an Accessibility Feature

A screen reader user who is recording narration is listening to two things at once: their own voice and the application. Every word the application speaks that the user didn't ask for competes directly with the thing they're trying to capture. The application should be as quiet as it can be while still being fully usable — speaking only when the user needs immediate feedback, and leaving everything else available to read on demand rather than announced automatically. Being "helpful" by narrating more is not a virtue here; it's noise.

## Hard rules

These are not guidelines; they are constraints every feature must satisfy:

- **Never design around drag-and-drop.** If a workflow can only be expressed as drag-and-drop, it needs a different workflow.
- **Never require interpreting a waveform.** No feature may depend on the user visually reading a waveform, spectrogram, or timeline shape.
- **Never hide important information inside graphics.** Anything a sighted user needs to know must exist as real text or accessible markup, not as an image, icon-only button, or canvas drawing.
- **Never move keyboard focus unexpectedly.** Focus only moves as the direct, predictable result of something the user did (e.g. completing a save moves focus to the confirmation/next step). It never jumps because of a background timer, an animation, or an unrelated event.
- **Durations are spoken in natural language.** "2 minutes 36 seconds," never "2:36." Raw digit-based time formatting is not read in a way that makes sense by a screen reader and is never used for anything the user hears or reads as a duration.

### Live-announcement whitelist

Automatic (i.e. not directly requested by the user in the moment) live-region announcements are limited to exactly these state changes, spoken once each:

- Recording started. / Recording stopped. / Recording paused. / Recording resumed.
- Playback started. / Playback paused.
- Recording saved. / Recording discarded. / Recording deleted.

Plus errors that need immediate attention (a denied permission, a failed save) — those aren't optional chatter, they're the specific case of "feedback the user needs right now."

Everything else — which microphone was found, a profile's full description, that a recording was renamed, that playback jumped to a new position, a control's pressed/expanded state, region and landmark names — is either conveyed as ordinary visible/navigable text the user can reach on demand, or left to the screen reader's own native announcement of the control they just activated (e.g. a native toggle button's own pressed-state announcement, which requires the element to persist across re-renders rather than being torn down and rebuilt). It is never pushed into a live region automatically. Before adding any new automatic announcement, ask: does the user need this right now to complete the current step, or can it wait until they choose to go looking for it? If it can wait, it doesn't get announced automatically.
