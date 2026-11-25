# 16 · Knob remapping

**Priority:** P2 · **Effort:** S · **Depends on:** hardware test · **Status:** needs validation

## What it is
Choose what the multifunction knob does (volume, brightness, scroll, zoom…), from the knob drawn on the keyboard.

## What we know
- Knob = matrix index 90 (K82 "Wheel"), code `07 00 00 14` (likely "volume knob" firmware function).
- The official UI can't select it (no key rect). KB.ini `KnobIndex`/`WheelMode` are unset for the MK75.
- The MK75 has a built-in mode switch: hold the knob 3 s to toggle multimedia ↔ lighting mode.
- Rotation directions aren't separate slots in the wired matrix, so per-direction mapping is unlikely.

## Plan
1. Hardware experiment (with backup): write other `07 00 00 xx` function codes to slot 90 and observe
   (e.g. codes used by the Fn table). Document results.
2. If only a few modes work, expose them as a dropdown on the knob (`Keyboard` already supports `onKnob`).
3. Always offer "Restore knob default (`07 00 00 14`)".

## Risks / open questions
- Unknown codes may disable the knob until restored; keep restore one click away.

## Done when
- At least one alternative knob function confirmed and switchable both ways on hardware.
