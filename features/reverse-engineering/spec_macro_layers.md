# MK75 wired: macros, key-matrix layers, Fn function codes

Source: LINGBAO `OemDrv.exe` (MK75 build), class `CDev916KB` (vtable `0x621AB4`).
The AU75 addresses map with +0xA130; all addresses here are MK75 addresses. The +0xA130 shift was verified for:
StMacro_To_HdMacro `0x4961B0` (vt+0x9C), keyinfo_to_hardware_code `0x495BF0` (vt+0x98), FillMatrix `0x4964F0`,
ApplySetting `0x496A10`, SetMacroData `0x495A70`, GetKeyMatrix `0x4957A0`, SetKeyMatrix `0x4956E0`.
The type-9 converter is at `0x468190`.

Labels: **EMULATED** = run in Unicorn, bytes captured. **STATIC** = read from disassembly. **GUESS** = inferred, needs hardware confirmation.

---------------------------------------------------------------------------------------------------

## 1. Macros

### 1.1 Transport (STATIC, framing EMULATED earlier)
- Each macro occupies a fixed **128-byte slot**. 8 slots make one 1024-byte page.
- **32 macros max** (Buffer_ID 1..0x20; the code logs an error if a 33rd is needed).
- Pages are written with `SetMacroData` = data frame `05 <page> 00 40 00 00 00 + 1024 B` on report 0x06.
  Page ids come from ApplySetting (`0x496B31..`):
  `0xDC` (slots 0-7), `0xE0` (8-15), `0xE4` (16-23), `0xE8` (24-31). They look like flash pages 0xDC00/0xE000/0xE400/0xE800.
- Only `ceil(macroCount/8)` pages are written, in order, with a 50 ms sleep after each. There is no read-back command for macro pages.
- Slot address: `page = 0xDC + 4*floor((id-1)/8)`, `offset = ((id-1) % 8) * 128`.
- Buffer_ID assignment (FillMatrix `0x496738..0x496785`, STATIC):
  - Keys are walked in order (0..131). The first time a macro is met with `id < 1`, it gets the next id (1, 2, …).
  - That macro is encoded into the next 128-byte slot.
  - A macro already holding an id is reused without being encoded again.

### 1.2 Key-matrix reference to a macro (STATIC)
`hw = 0x10 | (mode << 16) | ((id-1) << 24)`. Little-endian bytes are `[10, 00, mode, id-1]`.
keyinfo returns `0x10 | mode<<16`, and FillMatrix clears byte3 and ORs in `(id-1)<<24`.

| UI repeat option (keyinfo byte +0x0F) | mode (byte2) |
|---|---|
| 0 "Cycle times" | 1 |
| 1 "Cycle until the key released" | 2 |
| 2 "Cycle until any key pressed" | 4 |
| other | 0 |

Values are STATIC; the mapping to UI wording is GUESS, by text.xml order.
The wired format stores **no cycle count**: see header byte 1 below.

### 1.3 Macro slot byte layout (EMULATED, StMacro_To_HdMacro `0x4961B0`)
```
[0] 0x00                     constant
[1] 0x01                     constant (GUESS: loop count; vendor always writes 1)
[2..] events, 2 or 6 bytes each, until 126 bytes; rest of the 128-byte slot = 0x00 (no explicit terminator)
```
Event (input struct: u16 vk @+0, u16 flag @+2, u32 delay_ms @+4, i32 value @+8; 12-byte stride at macro+0x5C, count at +0x58):
```
2-byte form (delay <= 127 ms):
  b0 = (flag==0 ? 0x80 : 0x00) | max(delay,3)      (delay 0..3 -> 3)
  b1 = HID usage (or 0xF0/0xF1/0xF2 = mouse L/R/M)
6-byte form (delay > 127 ms):
  b0 = (flag==0 ? 0x80 : 0x00) | max(delay % 100, 3)
  b1 = HID usage
  b2 = 0x00, b3 = 0x03                              <- long-delay marker
  b4 = (delay/100) >> 8, b5 = (delay/100) & 0xFF    <- big-endian count of 100 ms units
```
- Total delay is `(b0 & 0x7F) + 100*BE16(b4,b5)` ms. For example, delay 128 encodes as `1C 04 00 03 00 01`, which is 28 + 100.
- Bit 7 of b0 is set when the struct's flag word is 0. GUESS: flag 0 = key **down**, so 0x80 = press and 0x00 = release.
  This is consistent with the wireless encoder, which never sets 0x80 on mouse-move events.
- GUESS: the delay is the wait *after* the event.
- Capacity: a 2-byte event is accepted while the write index is below 0x7E, a 6-byte one while it is below 0x7A. That gives about 62 two-byte events.
- VK→HID uses the table at `0x619150`: 115 pairs `(hid, vk)`, the standard Windows VK→HID usage set including numpad, OEM and IntlRo/Yen.
  Modifiers are special-cased: VK 0x10/0xA0→E1, 0xA1→E5, 0x11/0xA2→E0, 0xA3→E4, 0x12/0xA4→E2, 0xA5→E6, 0x5B→E3, 0x5C→E7.
- The wired format supports **mouse buttons L/R/M only** (event VK 0xF0/0xF1/0xF2 → usage 0xF0/F1/F2). Back/forward (0xF3/0xF4), X/Y move and wheel are not in the wired table.
  The encoder hits "can't find" and leaves a stray flag byte without advancing (EMULATED: `80` left past the end).
  The wireless encoder does support them, in a different 4-byte event format. That belongs to the wireless spec.

Emulated samples (input → slot bytes):
```
A down 50ms, A up 50ms           00 01 b2 04 32 04
A down 0ms,  A up 3ms            00 01 83 04 03 04
A down 127,  A up 128            00 01 ff 04 1c 04 00 03 00 01
A down 1234, A up 6553500        00 01 a2 04 00 03 00 0c 03 04 00 03 ff ff
Ctrl,Shift,RShift,Win down 10    00 01 8a e0 8a e1 8a e5 8a e3
mouse L down, R up, M down       00 01 8a f0 0a f1 8a f2
Enter, F1, Num1 down             00 01 8a 28 8a 3a 8a 59
70 events x 5ms                  length capped at 126 (62 events)
```

---------------------------------------------------------------------------------------------------

## 2. Key matrix (1024 B, `84/04 D4`)

| Byte range | Slots | Content | Source |
|---|---|---|---|
| 0x000-0x20F | 0..131 (0x84) | base layer, slot = KB.ini matrix index (`col*6+row`) | STATIC |
| 0x210-0x2CF | 132..179 | "Fn Matrix (Single key func)": 48 slots | STATIC; size = MaxFnNum*4 |
| 0x2D0-0x38F | 180..227 | "Fn Matrix (Fn Combo key func)": 48 slots | STATIC |
| 0x390-0x3FF | | unused / preserved | |

- `MaxFnNum` defaults to **0x30 = 48** (INI parse `0x412095`: `GetPrivateProfileInt("MaxFnNum", 0x30)`). The MK75 KB.ini doesn't override it.
  Other defaults: MatrixLen 0x80, LayerMask 0, WheelMode 0, MaxEftKeyIndex 0 (STATIC).
- **Redirect slots** (STATIC, FillMatrix `0x496600`):
  - If the base slot *read from the device* has byte0 == 0x02, then `n = (int8)byte3`, and the key's user-editable function is stored in `FnSingle[n]` (slot 132+n).
  - A negative n, or n ≥ MaxFnNum, means the write is skipped.
  - The vendor never creates or modifies redirect entries; the firmware owns them.
  - GUESS: a key with redirect n has its normal function in FnSingle[n] and its Fn+key function in FnCombo[n] (slot 180+n).
- **The vendor writes only the base layer.**
  - ApplySetting calls FillMatrix once (`0x496B59`).
  - FillMatrix first reads the matrix (`0x49657A` → GetKeyMatrix), then walks only the 0x84 base keys of the profile (`profile+0x38`, 16-byte keyinfo each).
  - It writes base slots, or FnSingle[n] through a redirect, plus macro byte3. FnCombo is never written (STATIC).
  - So FN1/FN2/Tap remapping isn't supported by the vendor tool for this class.
- The `[FN1]`, `[FN2]` and `[TAP]` INI sections are loaded into device-description tables (`dev+0x900`, `+0x1200`, `+0x1B00`, 0x90 × 16 B each; `0x412B25..`).
  They are used for display (showing what Fn+key does), not sent (STATIC: no reference from CDev916KB write paths).
  The MK75 INI has only `[FN1]`.
- **Fn key** (KB.ini VK 0xFA) is encoded by keyinfo as `0x00000020`. VK 0xFB (Fn2) → `0x20010000` (STATIC). The web UI must never change the Fn key.
- **Knob**: K82 "Wheel" has no rect, matrix index 90, INI type-9 code 0x07000014 → hw `0x14000007` (LE `07 00 00 14`) (EMULATED).
  - It is a single base slot. The vendor UI can't select it, because its rect is 0,0,0,0.
  - `KnobIndex` (4 numbers → `dev+0x2D88`) is absent from the MK75 INI.
  - GUESS: func 0x14 = "volume knob" (firmware handles CW/CCW = vol±, press = mute). Rotation directions aren't separately mapped in the wired matrix.
- `KeyNotToSet` (commented out in MK75 INI: `1..12` = Esc..F12 ids) lists keys the vendor UI refuses to remap. `FnNotToSet` is a similar flag. Neither is active for the MK75.

---------------------------------------------------------------------------------------------------

## 3. Type-9 function codes (KB.ini) → hw (EMULATED, converter `0x468190` = byte-swap)

`hw = bswap32(ini)`. Byte layout of hw (LE): `[type, b1, b2, b3]`.
The type-9 codes are the firmware's native Fn-table format. Two things in them differ from the format keyinfo produces for user assignments:
- consumer codes use type **0x02** here, but **0x04** from keyinfo
- keys are `[00, mods, 00, hid]` here, but `[00, 00, mods, hid]` from keyinfo

This needs hardware confirmation. Read the device matrix and compare, for example the F1 Fn entry. Note that in the *base* table the vendor treats byte0 == 0x02 as a redirect.

| Key | INI | hw (LE bytes) | Meaning |
|---|---|---|---|
| Esc | 07000004 | 07 00 00 04 | GUESS: factory reset (Fn+Esc hold) |
| ` | 07000008 | 07 00 00 08 | GUESS: 2.4 GHz mode |
| 1 / 2 / 3 | 07000005/6/7 | 07 00 00 05/06/07 | GUESS: Bluetooth channel 1/2/3 |
| Backspace | 07000013 | 07 00 00 13 | GUESS: battery level / USB mode |
| Q / W / E | 07000016 / 0E / 0F | 07 00 00 16/0E/0F | GUESS: W = Windows mode (AU75 text "Fn+W Windows mode"); Q/E = Mac / other OS modes |
| G | 0700000A | 07 00 00 0A | GUESS: game mode / Win-lock variant |
| B | 07000011 | 07 00 00 11 | GUESS: battery check |
| LWin | 07000001 | 07 00 00 01 | GUESS: Win-key lock ("Lock Win") |
| Knob | 07000014 | 07 00 00 14 | GUESS: volume knob |
| F1 | 02000223 | 02 00 02 23 | consumer 0x0223 WWW Home (STATIC usage) |
| F2 | 0200018A | 02 00 01 8A | consumer 0x018A Mail |
| F3 | 0004002B | 00 04 00 2B | Alt+Tab (mods 0x04 + HID 0x2B) |
| F4 | 00080008 | 00 08 00 08 | Win+E (mods 0x08 + HID 0x08) |
| F5 / Down | 08030200 | 08 03 02 00 | GUESS: LED brightness down |
| F6 / Up | 08030100 | 08 03 01 00 | GUESS: LED brightness up |
| RAlt | 08030001 | 08 03 00 01 | GUESS: brightness group, b3=1 (cycle?) |
| Left | 08040200 | 08 04 02 00 | GUESS: LED speed down |
| Right | 08040100 | 08 04 01 00 | GUESS: LED speed up |
| RCtrl | 08040001 | 08 04 00 01 | GUESS: speed group, b3=1 |
| \ | 08000000 | 08 00 00 00 | GUESS: next LED effect |
| RShift | 08000001 | 08 00 00 01 | GUESS: effect group, b3=1 (prev effect / LED on-off) |
| Tab | 08020000 | 08 02 00 00 | GUESS: LED colour cycle |
| / | 08020001 | 08 02 00 01 | GUESS: colour group, b3=1 |
| F7 / F8 / F9 | 020000B6/CD/B5 | 02 00 00 B6/CD/B5 | consumer Prev / Play-Pause / Next |
| F10 / F11 / F12 | 020000E2/EA/E9 | 02 00 00 E2/EA/E9 | consumer Mute / Vol- / Vol+ |
| U / I / O | type2 VK 2C/91/13 | key PrintScreen / ScrollLock / Pause | STATIC (VK→HID) |
| Delete / End | type2 VK 2D/24 | key Insert / Home | STATIC |

Pattern for `08 AA BB CC` (GUESS): AA = LED parameter (00 effect, 02 colour, 03 brightness, 04 speed); BB = 01 increase / 02 decrease; CC = 01 alternate action.
No name table exists in the binary. The only other hits for these constants are in the wireless encoder.

---------------------------------------------------------------------------------------------------

## 4. Safe editing rules for a web UI

1. Always read-modify-write the 1024-byte matrix (`84 D4` then `04 D4`), as the vendor does.
2. Base-layer edits: for key index i, if `matrix[i].byte0 == 0x02`, write `FnSingle[(int8)byte3]` (if the slot is within 0..47). Otherwise write `matrix[i]`. Never alter the redirect word itself.
3. Never write the Fn key slot (index 59) or the knob slot (90). The vendor can't select the knob; leave it unless a knob-remap feature is validated on hardware.
4. FnCombo (slots 180-227) and the FN1 functions are firmware-owned; the vendor never writes them. Editing FnCombo[n] for a redirected key is GUESS-level. Ship it only behind an "experimental" switch, after confirming on a device that a read of the matrix shows the INI [FN1] codes there (for example, look for `02 00 00 E9` = Vol+ for F12).
5. Macros:
   - Encode each macro per §1.3 into slot id-1 of a 4096-byte buffer.
   - Write `ceil(n/8)` pages `05 DC/E0/E4/E8`.
   - Set each key's code to `[10, 00, mode, id-1]` through rule 2.
   - Max 32 macros, about 62 short events each.
   - Wired supports only keyboard keys, modifiers and mouse L/R/M.
