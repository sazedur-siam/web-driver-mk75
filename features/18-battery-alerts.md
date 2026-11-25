# 18 · Low-battery alerts

**Priority:** P2 · **Effort:** S · **Depends on:** receiver type (TESTING W9) · **Status:** needs validation

## What it is
Show battery level in the header when connected wirelessly and send a browser notification below 20 % / 10 %.

## What we know
- Battery read = cmd `0x4A` on report-ID `0x13` receivers (`CDev3632`): byte0 = level %, charging flag in byte1.
- On `0x15` ("Combo") receivers `0x4A` is the on-board profile, not battery — no battery read known.
- Already implemented: `Mk75Wireless.readBattery()`, the Device-tab row, and step 2 below (`src/ui/battery.ts`:
  5-minute poll, header pill, one notification per threshold, re-armed by charging; permission button on the
  Device tab). It only runs on `caps.battery` (0x13) receivers and is untested on hardware.

## Plan
1. Confirm which receiver type the MK75 ships with (TESTING W9).
2. If `0x13`: poll every 5 minutes while connected, show a battery icon in the header, Notification API alerts
   (ask permission once), charging indicator.
3. If `0x15`: look for a battery query in `CDevComboFilm` (RE), else document "press Fn+B on the keyboard".

## Done when
- Battery % matches the keyboard's Fn+B indication within ±10 %, and a low-battery notification fires once.
