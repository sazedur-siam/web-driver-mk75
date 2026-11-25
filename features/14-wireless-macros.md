# 14 · Macros over 2.4 GHz / Bluetooth

**Priority:** P1 · **Effort:** M · **Depends on:** reverse-engineering + a real MK75 with receiver · **Status:** needs RE

## What it is
Write macros without the cable. Today the app edits macros over wireless but refuses to write them.

## What we know (from the wireless spec)
- Command `0x03` (write) / `0x43` (read), 512-byte chunks, 100 ms between chunks.
- The blob is ≤ `MacroBufferSize` (≤ 0x2800): a table of u32 `[addr:u16][size:u16]` per macro; each macro at `addr`
  = `[nameLen][name…][events…]`.
- The wireless event format differs from wired (4-byte events; supports mouse move X/Y and wheel).
- Vendor encoder around `0x49A6F7` / `0x49AE0D` in the MK75 `OemDrv.exe`.
- Key reference codes for macros in the wireless matrix: not yet decoded.

## Plan
1. RE: emulate the G5KB macro encoder with synthetic macros (Unicorn harness in `reverse-engineering/tools/emu3.py`) to capture exact bytes; decode the event format and the key-matrix macro reference.
2. Read-back: `0x43` exists on wireless, so we can also *read* macros (better than wired).
3. Implement `encodeWirelessMacros()` + `Mk75Wireless.writeMacroPages()`; set `caps.macros = true`.
4. Extend the macro editor with mouse move / wheel events when connected wirelessly.

## Risks / open questions
- Do cable and wireless share macro storage? (Related to TESTING W6.)
- Bigger buffer means more flash writes per save; only write when changed.

## Done when
- A macro written over 2.4 GHz plays correctly, survives power cycle, and reads back identically.
