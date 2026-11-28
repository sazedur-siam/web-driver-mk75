# MK75 hardware test plan

Manual checks on a real Lingbao MK75. Tick each box as it passes. The automated tests (`npm test`) already
check that the app sends the same bytes as the official LINGBAO driver; these checks confirm the keyboard
behaves as expected.

**Priority:** P0 = must pass to call the driver working · P1 = important · P2 = nice to have

## Before you start

- [ ] Connect by cable, then **Backup & log → Download backup**
- [ ] Keep the official LINGBAO Keyboard Driver installed to reset the keyboard if needed
- [ ] When a test fails: note the test ID, the expected and actual result, and copy the **Backup & log** tab

**Results:** firmware/keyboard batch: ______ · browser and OS: ______ · tester: ______ · date: ______

## 0. Automated

- [ ] **A1** `npm test` passes all tests
- [ ] **A2** `npm run build` completes with no errors

## 1. USB cable connection

- [ ] **C1** (P0) Switch in the middle position, press Fn+W, click **Connect keyboard**. The keyboard appears in the browser picker, the top-right label shows "· USB", and no red error appears.
- [ ] **C2** (P0) **Device** tab model check shows `03 00 00 00 00 c6 (MK75 ✓)`.
- [ ] **C3** (P0) The effect highlighted on the **Lighting** tab is the one running on the keyboard.
- [ ] **C4** (P1) Unplug while connected, plug back in, connect again. The app returns to the start screen without freezing, and reconnecting works.
- [ ] **C5** (P0) **Download backup** saves a `.json` file containing `profile`, `keyMatrix`, `rgbTable` and `macros`, plus `sideLights` on current MK75s (matching the Side lights tab).

## 2. Lighting

- [ ] **L1** (P0) Select each of the 16 effects and **Save**. The keyboard shows the named effect each time.
- [ ] **L2** (P0) Fixed on, brightness 0 → 4. Brightness increases at every step. Note whether 0 means off or just dim: ______
- [ ] **L3** (P1) Rainbow, speed 0 → 4. Speed changes at every step. Note whether 4 is fastest or slowest: ______
- [ ] **L4** (P0) Fixed on, pick each of the 7 swatches. The keyboard shows that colour each time.
- [ ] **L5** (P1) Change palette colour 1 to purple and save. The keyboard turns purple.
- [ ] **L6** (P1) **Colourful** makes the colours random or rainbow.
- [ ] **L7** (P0) **Off** turns off all backlight LEDs. The side light bars stay on; they have their own **Side lights** tab.
- [ ] **L8** (P0) Save a setting, unplug, plug back in. The setting is kept.

## 2b. Side lights (IC2481 boards: cable, 2.4 GHz, Bluetooth)

- [ ] **S1** (P0) **Side lights** tab, click Off, Flow, Neon, Steady and Breathe. The bars change at once and each name matches what they do.
- [x] **S2** (P0) Steady, click each colour. The bars change colour each time: red, green, blue, yellow, purple, cyan, white (confirmed 2026-11-28).
- [ ] **S2b** (P0) Steady, move **Brightness** 1 → 5. The bars get brighter at each step, with one blink per change.
- [ ] **S2c** (P1) Breathe, move **Speed** 1 → 5. The breathing changes speed. Note whether 5 is fastest or slowest: ______
- [ ] **S3** (P1) Change the mode with Fn + Right Shift, then click **Refresh**. The tab shows the new mode.
- [ ] **S4** (P0) Pick a distinctive mode and colour, unplug, plug back in. They're kept.
- [ ] **S5** (P1) Save a profile, change the side lights, apply the profile. The side lights go back.

## 3. Per-key colours

- [ ] **P1** (P0) Paint W, A, S, D and the arrow keys blue, clear the rest, save. Exactly those keys light up blue (not their neighbours), and the effect switches to Self-define.
- [ ] **P2** (P0) Fill all with red, then green, then blue, saving each time. Each colour is correct, which confirms the red/green/blue order.
- [ ] **P3** (P1) Paint Esc, Space and Delete different colours. All three are correct (these are the edge positions of the LED map).

## 4. Key mapping

Use a text editor and a keyboard/mouse tester website.

- [ ] **K1** (P0) Caps Lock → Left Ctrl, save. Caps Lock + C copies text.
- [ ] **K2** (P0) Set a key to Ctrl+Shift+Esc. Pressing it opens Task Manager.
- [ ] **K3** (P0) Set keys to Volume + and Play/Pause. Both work.
- [ ] **K4** (P0) Set a key to each of Left, Middle, Right, Forward and Back. The tester shows exactly that button each time.
- [ ] **K5** (P1) **Disable key** on a letter. The key produces nothing.
- [ ] **K6** (P1) **Reset to default** restores the key's original character.
- [ ] **K7** (P0) After K1–K5, Fn+F10 (mute), Fn+F12 (volume +) and the Fn key itself still work.
- [ ] **K8** (P1) Make changes, then **Revert all** before saving. Nothing changes on the keyboard, and no write appears in the log.
- [ ] **K9** (P0) Keys you didn't touch still type normally.
- [ ] **K10** (P1) **Fn layer**: the F12 key shows "Volume +" and Q/W/E show Android/Windows/macOS mode. Note anything that looks wrong: ______
- [ ] **K11** (P1) Fn layer: set Fn+F12 to Play/Pause and save. Fn+F12 plays/pauses; F12 alone is still F12; Fn+Q/W/E and Fn+B still work.
- [ ] **K12** (P0) **Restore Fn layer** and save. Fn+F12 is Volume + again.

## 5. Macros (cable; repeat W8 over 2.4G)

- [ ] **M1** (P0) Record "hello" and assign it to a key with **Play once**. One press types "hello" exactly once.
- [ ] **M2** (P0) Same macro with **Repeat until any key**. It repeats after release until another key is pressed.
- [ ] **M3** (P1) **Toggle**: the first press starts repeating, the second press stops it.
- [ ] **M4** (P1) Macro "A", wait 2000 ms, "B". The gap is about 2 s (±10%).
- [ ] **M5** (P1) Record a left click in the mouse pad. Playing the macro clicks.
- [ ] **M6** (P1) Assign 9 different macros to 9 keys. All 9 play their own content (the 9th tests the second storage page).
- [ ] **M7** (P0) Unplug and replug. Macros still work.

## 6. Live effects

- [ ] **V1** (P0) Rainbow wave → **Start**. The keyboard animates like the on-screen preview, showing at least 25 fps.
- [ ] **V2** (P1) Every mode looks sensible, and **Follow** lights the keys you press.
- [ ] **V3** (P1) **Music** with a shared tab playing music. The lights react to the music.
- [ ] **V4** (P0) **Stop** brings back the saved effect within 1 s.
- [ ] **V5** (P1) Close the browser tab while streaming. Note what happens; the keyboard should return to its saved effect within a few seconds: ______

## 7. Device tab

- [ ] **D1** (P1) Set the sleep timer to 30 s, switch to 2.4G and leave it idle. It sleeps after about 30 s.
- [ ] **D2** (P1) With the sleep timer set to **Never**, it doesn't sleep within 5 minutes.
- [ ] **D4** (P2) Set **Debounce** to level 5 and save, then unplug and replug. It still reads level 5, and the Key tester's chatter check flags fewer double presses than at level 1.
- [ ] **D5** (P1) Set **Knob** to Lighting and save. Turning the knob changes brightness; set Volume, it changes volume again.
- [ ] **D3** (P0) **Load backup** → Restore. Lighting, key mapping, macros and side lights return to the backup state.

## 8. 2.4 GHz receiver

- [ ] **W1** (P0) Switch to 2.4G, plug in the receiver, **Connect**. The label shows "2.4G / BT", no error appears, and the Lighting tab shows the current effect.
- [ ] **W2** (P1) Connect while the keyboard is asleep. A clear "keyboard is not connected" message appears, and connecting works after a key press.
- [ ] **W3** (P0) Change the effect, speed and brightness, then save. The keyboard updates. Only one colour swatch plus Colourful should be offered.
- [ ] **W4** (P0) Repeat P1 over 2.4G. The correct keys light up.
- [ ] **W5** (P0) Repeat K1 over 2.4G. Caps Lock works as Ctrl.
- [ ] **W6** (P1) Connect by cable after W5. Note whether Caps Lock is still Ctrl (the cable and wireless key maps may be stored separately): ______
- [ ] **W7** (P1) Rainbow wave over 2.4G. The keyboard animates (5 fps or more is fine) with roughly correct colours.
- [ ] **W8** (P0) Repeat M1 and M7 over 2.4G. The macro plays, survives a power cycle, and still plays when you switch to the cable (shared storage).
- [ ] **W9** (P2) **Device** tab: note whether a Battery row appears. This tells which receiver type you have: ______

## 9. Bluetooth

- [ ] **B1** (P1) Switch to BT, hold Fn+1 for 3 s, pair "MK75-5.0" in the OS, then **Connect**. The keyboard appears in the browser picker. If it doesn't, note that here (known risk): ______
- [ ] **B2** (P1) If B1 passes, repeat W3. Lighting changes apply.
- [ ] **B3** (P1) Connect over Bluetooth 5 times in a row. Each connect succeeds, with no "timeout reading 0x44" error (issue #32). In the log, `←` reply lines with gaps in the packet index are expected: ______

## 10. Themes and browser

- [ ] **T1** (P2) Click all four colourways, then reload. Each theme looks right, and the choice is remembered after reload.
- [ ] **T2** (P2) Open in Firefox or Safari. A clear "browser not supported" message appears.

## Overall pass criteria

The driver is ready when:

- [ ] Every **P0** test passes
- [ ] No unexpected red errors appear (only the expected ones in W2 and W8)
- [ ] Keys and settings you didn't change stay the same
- [ ] Settings survive unplugging

**Most likely to fail, so report the result even if they pass:** L2, L3, K4, P2, W1, W6, W7, B1, D1.
