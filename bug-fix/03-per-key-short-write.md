# 03 · Per-key write sends 378 of 512 bytes

**Severity:** possible garbage after the colour planes · **Priority:** P2 · **Effort:** S · **Status:** verify on hardware first

## What happens
The per-key colour sector is 512 bytes: R, G and B planes of 126 bytes each (378), then `00 00 5A A5` at
378–381, then whatever the vendor stores in 382–511.

[mk75Wireless.ts:211-213](../src/protocol/wireless/mk75Wireless.ts#L211-L213) `writeLedMatrix()` sends only the
first `LED_GROUP_LEN` = 378 bytes. `Mk75G5Wired` (IC2481 cable) inherits it.

hw-re-docs says every SET rewrites the **whole** 512-byte sector, and that a shorter payload fills the rest
"with leftovers from an earlier transfer". If that's true, `00 00 5A A5` at 378–381 can end up as random bytes
after every per-key save.

## Why this is only P2
- **The vendor app sends 378 bytes too.** Our `g5Wired.ts` header records `per-key 86/06 len 0x17A`, captured
  from `OemDrv.exe`. So the official driver would have the same problem, and nobody has reported broken
  per-key lighting.
- Whether the firmware checks `5A A5` in this sector is unknown.

So this might be a real flash-corruption bug, or harmless. Check before changing anything.

## Plan
1. **Verify (cable, IC2481 board):**
   1. Read GET `0x86` with 512 bytes. Note bytes 378–511.
   2. Do a per-key save from the app over the cable. Read again.
   3. Do a per-key save over 2.4 GHz. Read again on the cable.
   4. Also save a large block first (for example a palette write) and then a per-key write, to see if leftovers
      from that transfer show up in 378–511.
2. **If 378–511 stay unchanged:** not a bug. Delete this file and its row, and add a one-line note to
   `PROTOCOL.md` that short per-key writes are safe.
3. **If they change:** send a full 512-byte payload as a read-modify-write.
   - Cable: read `0x86` (512), replace bytes 0–377 with the new planes, write all 512.
   - 2.4 GHz: the per-key read (`0x42`) returns only 378 bytes, so the tail must come from a cable read. Reuse the
     approach chosen in [02](02-wireless-palette-tail.md) (hard-coded tail, or cached from the last cable read).
   - Live effects stream on `0x08`, not this command, so they're unaffected and must stay fast.

## Tests (only if step 3 happens)
- Teach the simulator the "leftovers" behaviour: on a short `SetColors`, fill the rest of the sector with the
  previous transfer's bytes. Then assert that after `writeLedMatrix()` bytes 378–381 are `00 00 5A A5`.

## Done when
- Either the hardware check shows short writes are safe (file deleted), or a per-key save leaves bytes 378–511
  exactly as they were, on the cable and over 2.4 GHz.
