# 01 · Sleeping keyboard: lighting write wipes the config

**Severity:** data loss (keyboard goes dark) · **Priority:** P0 · **Effort:** S · **Status:** fix shipped to `main` (branch `fix/sleeping-config-wipe`). Simulator tests pass. Waiting for hardware feedback (see *Done when*); delete this file once a real keyboard confirms it.

## What happens
In 2.4 GHz mode the keyboard sleeps after `byte 0x18 × 30 s` with no key press. A sleeping keyboard answers the
LED-profile read (`0x44`, or `0x84` on IC2481 cables) with a **mostly zero** 128-byte block. It still has
`5A A5` at bytes `0x7E–0x7F` but **lacks `FF FF` at bytes `0x38–0x39`**.

Our code accepts that block and writes it back:

- [mk75Wireless.ts:93-100](../src/protocol/wireless/mk75Wireless.ts#L93-L100) `readLedRaw()` only checks `5A A5`.
- [mk75Wireless.ts:127-150](../src/protocol/wireless/mk75Wireless.ts#L127-L150) `writeProfile()` patches the
  zero block and writes it. [Line 144](../src/protocol/wireless/mk75Wireless.ts#L144) forces `0x38/0x39 = FF`,
  which hides the one sign that the block was bad.

Result: effect, colours, brightness, sleep timer and the rest of the config are overwritten with zeros, and the
keyboard stays dark until a good config is written again. `readProfile()` uses the same read, so the UI can also
show an all-zero profile.

`Mk75G5Wired` (IC2481 boards on the cable) inherits this code. Sleep is a wireless-mode feature, so the cable is
lower risk, but the same guard protects it.

## Evidence
- hw-re-docs `PROTOCOL.md`, *Power, Sleep and Charging Quirks*: "A sleeping keyboard returns a mostly-zero
  config. It keeps `5a a5` at bytes 126–127 but lacks `ff ff` at 56–57. Writing that block back wipes the live
  config." Their tools refuse any config write without `ff ff` at 56–57.
- Our own header comment ([mk75Wireless.ts:7](../src/protocol/wireless/mk75Wireless.ts#L7)) already says
  `0x38/0x39 = FF` on a valid block.

## Plan
1. In `readLedRaw()`, treat a block as valid only when `r[0x7e..0x7f] == 5A A5` **and** `r[0x38..0x39] == FF FF`.
   Keep the existing retry loop (5 tries, 100 ms); the first read often wakes the keyboard.
2. If every try fails, throw a clear error: *"The keyboard is asleep. Press any key on it, then try again."*
   Nothing is written. The UI already shows thrown errors from writes; check that `readProfile()` callers do too.
3. Keep line 144 (vendor writes `FF FF` there). It's harmless once the guard is in place.
4. Simulator: add `asleep = false` to `MockWirelessIO`. When true, `GetLed` returns 128 zero bytes with
   `5A A5` at `0x7E`. Optional: clear `asleep` after the first read, to model wake-on-read.

## Tests (`src/protocol/wireless/wireless.test.ts`)
- Asleep for every read: `writeProfile()` rejects, and the simulator receives **no** `SetLed` packet. Its stored
  config is unchanged.
- Asleep for the first read only: `writeProfile()` succeeds after the retry and writes a block with `FF FF` at `0x38`.
- Same two cases through `Mk75G5Wired` in `g5Wired.test.ts`, if its simulator can serve a sleeping block cheaply.

## Risks
- If some firmware build has a valid config without `FF FF` at `0x38`, the guard would block every lighting write.
  The vendor format and both write-ups say it's always `FF FF`, so the risk is low. The error message makes it
  visible instead of silent.

## Done when
- Changing lighting over 2.4 GHz while the keyboard sleeps either wakes it and saves, or shows the "asleep"
  message. It never leaves the keyboard dark.
- On hardware: let the keyboard sleep (set sleep to 30 s), change the effect in the app, confirm the result.
