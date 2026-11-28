# 20 · Side lights (light bars) from the app

| Group | Priority | Effort | Needs hardware? | Branch |
|---|---|---|---|---|
| Lighting | P1 | M (plus about 1 h of hardware probing) | **Yes**: phases 1 and 2 can't be done without a real MK75 | `feat/side-lights` |

## Status (2026-11-28)

| Phase | State |
|---|---|
| 1. Find the bytes | ✅ Done on a real MK75 (cable): `led 0x12` mode 0–4 (0 off, 1 flow, 2 neon, 3 steady, 4 breathe), `led 0x13` colour 0–6. Brightness and speed aren't stored anywhere readable. |
| 2. Prove writes work | ⏳ Built, waiting for a hardware pass: TESTING.md **S1–S5**. Also needed: the names of colours 1–7, to show swatches instead of numbers. |
| 3. Protocol | ✅ `readSideLights` / `writeSideLights` (read-modify-write of only those two bytes, range-checked first), tests in `sideLights.test.ts` and the issue #29 replay. |
| 4. UI | ✅ A **Side lights** tab of its own (the user asked for it to be easy to find, not a card in Lighting). Profiles and backups carry mode and colour. Brightness and speed are shown as keyboard shortcuts. |
| 5. Docs | ✅ PROTOCOL.md, CLAUDE.md, README, MANUAL, TESTING. Still to do on ship: a manual screenshot, and delete this file. |

## Goal

Add a **Side lights** card to the Lighting tab where the user can:

- turn the two bottom-edge light bars on or off
- pick the mode: flow, neon, steady or breathe
- pick the colour (steady and breathe modes)
- set brightness and speed

Today this only works with the keyboard shortcuts **Fn + RShift** (mode), **Fn + /** (colour), **Fn + RCtrl**
(speed) and **Fn + RAlt** (brightness). They're listed in `DeviceTab.tsx` `SHORTCUTS`.

## What we know

- **The vendor driver has no side-light control.** `OemDrv.exe` never sends a light-bar command
  (`LightBarMusicCmd` isn't set in the MK75 KB.ini; see `reverse-engineering/spec_live_misc.md` §1.2). There's no
  vendor capture to copy, so every byte here has to be found on real hardware.
- **The firmware has to keep the side-light state somewhere,** because the setting survives a power cycle (to be
  confirmed in phase 1). The best candidate is the 128-byte "layout B" LED block (wireless `44`/`04`, IC2481
  cable `84`/`04`). The app already reads and writes that block for debounce and knob mode.
- **Three real dumps of that block exist** in `src/protocol/fixtures/` (issue #29 USB, #31 2.4 GHz, #35
  Bluetooth). These bytes are not decoded yet:

  | Offset | #29 USB | #31 2.4G | #35 BT | Guess |
  |---|---|---|---|---|
  | `0x01`, `0x02` | `03 03` | `03 03` | `03 03` | ? |
  | `0x04`, `0x05` | `00 00` | `00 00` | `00 00` | side-light mode / on-off? |
  | `0x06`, `0x07`, `0x08` | `04 04 07` | `04 04 07` | `04 04 07` | **side-light brightness, speed, colour?** Same shape as an effect (brightness 4, speed 4, colour 7 = colourful) |
  | `0x0C` | `01` | `01` | `01` | OS mode (Fn + W = Windows)? |
  | `0x0E` | `00` | `01` | `02` | **connection mode** (0 USB, 1 2.4 GHz, 2 BT). Not side lights; never write it |
  | `0x12` | `01` | `01` | `01` | ? |
  | `0x14`, `0x15` | `04 04` | `04 04` | `04 04` | side-light brightness and speed? |
  | `0x17` | `FF` | `FF` | `FF` | ? |
  | `0x74`…`0x7D` | `04` ×10 | `04` ×10 | `04` ×10 | past the 19 per-effect pairs; per-mode side-light values? |

  These are guesses. Phase 1 proves or rejects them.
- **CDev916KB boards** (1031-byte report 0x06, 254-byte profile) have no layout B block. Every real MK75 seen
  so far is IC2481 (layout B), so this feature targets layout B only.

## First hardware run (2026-11-28, IC2481 MK75 on the cable)

Guided probe, first version. It read 500 ms after each press, which turned out to be too early: the keyboard
sends its input reports at once but updates the config block later, so some changes landed on the next step.
The probe now waits for the block to settle. Findings so far, to be confirmed by a clean re-run:

| Byte | Values seen | Shortcut | Reading |
|---|---|---|---|
| `led 0x12` | `01 02 03` | Fn + Right Shift | side-light **mode** (likely) |
| `led 0x13` | `00 01 02 04 06` | Fn + / | side-light **colour** (likely; the skipped values may be lag) |
| `led 0x14`, `0x15`, `0x75` | `04 → 00`, `04 → 01`, `04 → 03 → 04` | unclear | possibly the Fn + F6 control step, credited late |
| none | — | Fn + Right Ctrl, Fn + Right Alt | side-light **speed** and **brightness** changed on the keyboard but not in any readable block |

Every Fn shortcut makes the keyboard send input reports `02 00 00` and `03 08 00 01` on the vendor interface.
Mode and colour presses also send `06 0A 07 00 00 00 00 00`; speed and brightness don't. That report looks like a
"config saved" notice, which would mean speed and brightness aren't stored (re-plug test pending).

## Phase 1: find the bytes (hardware, read-only)

Nothing is written to the keyboard in this phase.

1. **Build a probe. ✅ Done.** "Contribute device data" → **Side-light probe** (`SideLightProbePanel.tsx`,
   logic and tests in `sideLightProbe.ts`). It shows on layout B connections only (`dev.readConfigBlock`, which
   wraps `readLedRaw()`, so the sleeping-keyboard check and the Bluetooth packet merge apply).
   - Each read records what the user pressed and what the side lights showed.
   - It lists the bytes that changed since the previous read, plus a summary table of every offset that moved,
     its values and which shortcut moved it.
   - The reads go into the device-data file as `probe` (documented in `DEVICE_DATA.md`), so other owners can send
     results too.
2. **Run the test script below on the USB cable** (fastest and most reliable), then repeat steps a and b on
   2.4 GHz to confirm it's the same block.

   | Step | Press | Record |
   |---|---|---|
   | a | Fn + RShift, 5 times, reading after each press | mode byte and its value for flow / neon / steady / breathe / off |
   | b | Switch to steady, then Fn + / until it wraps around | colour byte, the number of colours, and the order (write down what you see) |
   | c | Fn + RCtrl until it wraps around | speed byte and its range |
   | d | Fn + RAlt until it wraps around | brightness byte and its range; check whether 0 is off |
   | e | Change the main effect and the brightness with the app | confirm the side-light bytes don't move (no overlap with the backlight) |
   | f | Unplug, wait, plug back in, read | the values persist (stored in flash, not RAM) |

3. **If no bytes change** in the LED block, probe the other readable blocks with the same diff: palette `49`/`8A`
   (tail after `0x1FA`), keymap layer 0/1 tails, and the on-board profile `4A`. If the state isn't in any of
   them, the firmware keeps it where the host can't reach it. Stop there: document it in `PROTOCOL.md`
   ("Not yet decoded") and close the feature as not possible.

**Exit:** a table of offsets, value ranges and the colour list, added to `PROTOCOL.md` and
`spec_wireless.md` §4.1, labelled **HARDWARE** (a new label next to EMULATED / STATIC / GUESS).

## Phase 2: prove that writes work (hardware, one byte at a time)

The firmware may read these bytes only at boot, or it may ignore host writes to them.

1. Add a dev-only helper (`window.__mk75.dev`) that does read-modify-write of **one** discovered byte, within its
   observed range, through the existing `writeSettingsNow` path. Don't add a UI yet.
2. For each field, write a new value and note whether the bars change:
   - right away
   - only after the next effect change
   - only after a re-plug
   - never
3. Write the original block back and confirm the keyboard is unchanged, using a second read and a diff.
4. Repeat one write over 2.4 GHz. Try Bluetooth too, but it isn't required: Bluetooth writes are still
   unconfirmed (CLAUDE.md §5).

**Exit:** each field is marked "live", "after re-plug" or "read-only". Read-only fields are shown in the UI but
can't be edited. If nothing is writable, ship only a read-only display of the current side-light state, or
drop the feature.

## Phase 3: protocol (no hardware needed)

1. **Types** (`src/protocol/device.ts`):
   - Add `SideLights { mode; colour; brightness; speed }` to `KeyboardSettings`, using the hardware values. Keep
     the names for UI labels in one table in `lighting.ts`, like `LED_MODES`.
   - Add `caps.sideLights: boolean`. It's true for `Mk75Wireless` and `Mk75G5Wired`, false for CDev916KB boards
     and the 0x15 receiver if phase 2 shows it doesn't forward the block.
2. **Adapter** (`src/protocol/wireless/mk75Wireless.ts`):
   - Decode the fields in `readSettings()`.
   - Encode them in `writeSettingsNow()`, reusing its range checks (`RangeError` on out-of-range values).
   - Change only the discovered offsets. Never touch `0x0E` or other bytes we don't understand (CLAUDE.md
     rule 1).
   - `Mk75G5Wired` inherits this through the adapter.
   - Update the header comment that lists the layout B offsets.
3. **Simulators:** `MockWirelessIO` and the G5 wired mock store the block already. Seed them with the #29 block
   so the defaults look real.
4. **Tests** (new `sideLights.test.ts`, plus additions to the issue replay tests):
   - All three fixtures decode to the same side-light values.
   - Writing one field changes exactly one byte; diff against the fixture.
   - Out-of-range values throw, and nothing is sent.
   - A write keeps `0x0E`, the debounce and knob bytes, and the `5A A5` signature.
   - Writing side lights and debounce together produces one block write, not two.
   - Byte-exact frame against a hardware capture, if phase 2 produced one.

## Phase 4: UI

1. **Lighting tab** (`LightingTab.tsx`): add a **Side lights** card below the effect controls, or show a short
   "Not available on this connection" hint when `caps.sideLights` is false. It contains:
   - an **On** toggle (maps to the "off" mode value, or to brightness 0, depending on phase 1)
   - a **Mode** segmented control: Flow · Neon · Steady · Breathe
   - **Colour** swatches with the firmware's fixed colours from phase 1, enabled for Steady and Breathe only
     (match what Fn + / allows)
   - **Brightness** and **Speed** sliders with the same step count as the hardware
   - Saving uses the tab's existing **Save** button and the existing busy and error handling
2. **Read on connect:**
   - Show the current state from `readSettings()`.
   - The user can still change the bars with the shortcuts, so read the block again when the tab gets focus,
     the same way debounce is shown today.
3. **Profiles and backups:**
   - Add `sideLights` to saved profiles (`profileStore.ts`; bump the version and read old profiles without the
     field).
   - Add it to the backup format (`BackupTab.tsx`).
   - In `applyProfile.ts`, merge it into the LED block write, which already goes last in vendor order, so a
     profile switch stays one write.
   - Skip the write when nothing changed.
4. **Lighting Off:** decide whether **Off** in the Lighting tab also turns off the side lights. Recommendation:
   no, keep them independent, but add a one-line hint next to the card.
5. **Shortcuts table:** keep the side-light rows in `DeviceTab.tsx` and add "or use Lighting → Side lights".

## Phase 5: docs and release

- `PROTOCOL.md`: the layout B table, plus remove side lights from "Not yet decoded".
- `CLAUDE.md` §4 (layout B fields), §5 (move side lights to confirmed, or say what's still inferred), and §9 if
  phase 2 found a re-plug quirk.
- `TESTING.md`: rewrite **L7** and add **S1–S5**: each mode, colour, brightness, speed, and persistence after a
  re-plug.
- `MANUAL.md` (plus a new `public/manual/lighting.webp` screenshot) and the `README.md` feature list.
- Delete this file and its row in `features/README.md` when the feature ships (CLAUDE.md §8).
- Workflow: `npm test`, `npm run build`, browser check with the USB and 2.4 GHz simulators, then a PR into
  `main`.

## Risks

| Risk | What we do |
|---|---|
| Side-light state isn't in any readable block | Stop after phase 1 and document it. The shortcuts stay the only way. |
| Bytes are readable but the firmware ignores writes, or applies them only at boot | Ship read-only, or show a "re-plug to apply" note. Decide after phase 2. |
| A wrong byte breaks something (connection mode, debounce) | Read-modify-write; only bytes that phase 1 proved; range checks; restore-and-diff in phase 2. |
| Different firmware builds use different offsets | Check against every new "Contribute device data" upload. Hide the card if the decoded values are out of range. |
| Bluetooth drops reply packets (issue #32) | The existing merged read handles it. Writes stay unconfirmed, as for every other block. |

## Done when

- [ ] The probe exists, and phase 1 results (offsets, ranges, colours) are recorded in `PROTOCOL.md`.
- [ ] Phase 2 shows which fields can be written, and the restore-and-diff check is clean.
- [ ] The Side lights card changes the bars on a real MK75 over USB and 2.4 GHz.
- [ ] The setting survives a re-plug, and profiles and backups carry it.
- [ ] Tests pass (`npm test`), `npm run build` is clean, and the docs above are updated.
