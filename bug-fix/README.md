# Bug backlog: Lingbao MK75 web driver

One file per known bug, numbered `NN-short-name.md`. When a fix ships, delete its file and its row here.
New features go in `../features/`, not here.

## Index

| # | Bug | Affects | Severity | Priority | Effort | Needs hardware? |
|---|---|---|---|---|---|---|
| 01 | [Sleeping keyboard: lighting write wipes the config](01-sleeping-config-wipe.md) | 2.4 GHz (and IC2481 cable) | Data loss: keyboard goes dark | P0 | S | To confirm only. **Fix shipped, waiting for hardware feedback** |
| 02 | [Wireless palette write zeroes the identity tail](02-wireless-palette-tail.md) | 2.4 GHz | Maybe harmless: vendor app does the same | P2 | S | Yes (verify first) |
| 03 | [Per-key write sends 378 of 512 bytes](03-per-key-short-write.md) | 2.4 GHz + IC2481 cable | Possible garbage after the colour planes | P2 | S | Yes (verify first) |

Severity is what a user sees. Priority is fix order. Effort: S ≈ 1 day or less.

## Order

1. **01 first.** It's the only one that turns the lights off for a user, and the fix is a read guard plus a test.
2. **02 and 03: hardware check first, code only if it fails.** In both, our write matches what the vendor app
   sends (02: `spec_wireless.md` §4.2; 03: the `0x17A` per-key length in `g5Wired.ts`), so both may be harmless.
   One session on a cable-connected IC2481 board answers both: read GET `0x8A` and GET `0x86` (512 bytes each)
   before and after a save from the app.

## Source of these bugs

All three come from a third-party hardware write-up of the same keyboard:
[randalthor17/hw-re-docs, lingbao-mk75/PROTOCOL.md](https://github.com/randalthor17/hw-re-docs/tree/master/lingbao-mk75)
(sections *Write Rules*, *Power, Sleep and Charging Quirks*, *Palette*, *Per-Key Colours*). It has no licence:
use the facts, don't copy its code or text.

## Workflow (same as features)

- Branch `fix/<short-name>`, fix, `npm test`, `npm run build`, check in the browser with the simulator, then
  `git merge --no-ff` into `main` and push as `sazedur-siam`.
- Every fix gets a test against `MockWirelessIO` (`src/protocol/wireless/mockWireless.ts`) or `MockMk75`. When
  the bug is a hardware behaviour the simulator doesn't have, teach the simulator that behaviour first so the
  test fails before the fix.
- Delete the bug's file and its row in this index when it ships.
