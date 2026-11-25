# 17 · Debounce setting

**Priority:** P2 · **Effort:** S · **Depends on:** hardware test · **Status:** needs validation

## What it is
Adjust switch debounce time, which can fix chatter on worn or newly swapped switches (pairs with 05 Key tester).

## What we know
- MK75 KB.ini: `ShowDebounce=0x04000101` (the vendor UI shows a debounce row; encoding likely max/min/step).
- Over the cable the official driver **never sends** debounce (CDev916KB ignores it).
- Over wireless, LED profile layout B has a debounce byte at offset `0x03` (written when ShowDebounce ≠ 0).

## Plan
1. Decode `0x04000101` → allowed range (guess: 1–4, step 1, ms or units).
2. Over 2.4 GHz: read profile byte 0x03, write values in range, verify with the Key tester's chatter stats.
3. Add a Device-tab control (wireless only, "Experimental").

## Done when
- Changing debounce over 2.4 GHz measurably changes chatter detection and persists.
