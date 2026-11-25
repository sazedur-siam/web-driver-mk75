# MK75 wired: live streaming, device info, reset, sleep/debounce, timing

Binary: LINGBAO Keyboard Driver v2.0 (20250716) `app/OemDrv.exe`. Wired class `CDev916KB`
(vtable 0x621AB4, type id 0x9160). Addresses = AU75 build + 0xA130 for CDev916KB code.
Labels: **EMULATED** (Unicorn run of the vendor function, HidD_* hooked), **STATIC** (read from
disassembly), **GUESS**.

## 1. Live LED streaming (music visualiser + "real-time effect")

### 1.1 Transport — vt slot 16 = `0x495B30` "SendMusicData" (args: buf, len, mode)
- **EMULATED**: `HidD_SetFeature(hMusic, frame, 0x17E)`, where hMusic is the collection whose
  feature report is 0x17E bytes incl. ID.
  ```
  report 0x08, 381 payload bytes:  0A 7A 01 | data[378]   (rest zero)
  ```
  `0A 7A 01` is constant (0x017A = 378 = 126 LEDs x 3). `len` > 0x17A → rejected; shorter `len`
  copies `len` bytes and zero-fills the rest. The 3rd arg (`mode`) is ignored by the wired class.
- **STATIC** data layout (wired, RT effect PlayThread 0x46F040, branch `dev+0x234 == 1` = wired):
  **RGB triplets indexed by LED index**, not planes:
  `data[3*led + MusicRGBIndex[0]] = R, [.. +[1]] = G, [.. +[2]] = B`.
  `MusicRGBIndex` defaults to `RGBIndex` (MK75 KB.ini `RGBIndex=0,1,2`) → plain R,G,B order.
  LED index = KB.ini key index (same as the matrix/LED index used everywhere else; 126 slots,
  ctor sets obj+0x2A4/0x2A8 = 0x7E).
- No checksum, no reply read.

### 1.2 Enable / disable
- **STATIC**: neither the RT-effect PlayThread nor CMusicDlg::StartMusic (0x44D1A0) sends any
  enable command before streaming; frames are just sent. Stopping music calls vt slot 18
  (`0x4A5A00`, a stub returning 1 on CDev916KB) → **no stop command on wired**.
- Music and RT effect are mutually exclusive host loops (global flag 0x66F9A8: RT PlayThread only
  sends while it is 1; StartMusic(start) clears it, stop sets it). **STATIC**
- `LightBarMusicCmd` (default 0, MK75 INI doesn't set it) → no light-bar command. **STATIC**
- Reverting to the stored effect when streaming stops: not handled by the driver; presumably a
  firmware timeout (OpenRGB reports ~1 s on the F75 with a similar stream). **GUESS** — keep
  sending at least every ~200–500 ms while live mode is on, and re-write the profile (03 B6) on
  exit if the keyboard doesn't revert on its own.

### 1.3 Frame pacing
- **STATIC**: CalcThread (0x46F4E0) loop sleeps 20 ms (`Sleep(0x14)`) per step and signals the
  PlayThread event (obj+0x54F4), which sends one frame per signal → ~50 fps. PlayThread start
  delay 4000 ms (`Sleep(0xFA0)`). Music thread uses its own audio-driven cadence (WASAPI loopback,
  "RecordAudioStream", re-starts on default-endpoint change).

### 1.4 RT effects (CRTEffectDlg) — computed on the host
- Modes (text.xml `tc_rteffect_mode1..9`): Static, Stars, Snow, Breathing, Shrink, Aspect, Follow,
  Rotating, None. Effects are user-built per key ("New Effect", "Please select the key you want to
  apply first"), saved to `*.dse` files.
- **STATIC** per frame: the effect engine fills a 0x84-byte per-key intensity array (0..255),
  then for each key: `out = baseColor * intensity / 255` per channel (helper 0x46EFD0, divide by
  255 via 0x80808081), written as triplets (1.1).
- Key-group files drive the spatial effects (**STATIC**: init routines log which file is missing):
  Snow → `Cartoon/stream_unit.txt`, Flower/"Fou" → `flower_unit.txt`, Stream →
  `stream_unit.txt`, Xy/Rotating → `wheel_unit.txt`; also `breath_unit.txt`, `fixon_unit.txt`,
  `rotate_unit.txt`. Format: each line = one unit (group of key names, see KB key-name table
  `esc, ~, tab, caps, shift, ctrl, win, alt, space, ralt, fn, rctrl, left, up, down, right, del,
  home, end, pgup, pgdn, back, enter, |, f1..f12, k45 ...`), optional `:R,G,B`; units without a
  colour get interpolated colours. Units are animated in order (wave across groups).
- Exact per-mode maths (speeds, decay curves) not extracted. **GUESS** reimplementation:
  Static = constant; Breathing = sine on intensity; Stars = random keys flash & decay;
  Snow/Stream = intensity wave stepping through stream_unit lines; Rotating = wheel_unit lines in a
  rotating sweep; Shrink/Aspect = flower_unit rings inward/outward; Follow = reactive (key press
  lights key then decays); None = off.

### 1.5 Music modes (CMusicDlg)
- Modes `tc_music_mode1..10`; controls Gain, Smooth, Auto Gain, Colour / ColorFull, Effect.
  Audio = WASAPI default render endpoint loopback. Key layouts from `ET/audiobar.txt` (columns
  `a,b:c,d:...` = bars bottom→top), `ET/flower.txt` (rings), `ET/stream_h.txt` (horizontal
  stream), `ET/happy.txt`. **STATIC** (file names/strings); algorithms **GUESS**: FFT/level →
  gain (×Gain, or auto-normalised) → smoothing (IIR with "Smooth") → per-layout mapping
  (audiobar = per-column spectrum bars; flower = level → ring radius; stream = level scrolls
  horizontally; happy = beat-triggered groups) → colour (fixed or rainbow) → triplets.
- Wireless note (out of scope here): same vt+0x40 is used with a compact format when not wired:
  groups `[R,G,B,count,idx×count]`, ≤64 groups, total ≤ 0xC8 bytes, `mode` = 2 (matches the
  OpenRGB F99 wireless capture). **STATIC**

## 2. Device info
- **Firmware version — STATIC**: vt slot 9 `0x495210` "GetVersionNumber" = `HidD_GetAttributes`
  on hDev → `VersionNumber` (USB **bcdDevice**). No HID command. WebHID does not expose bcdDevice,
  so the web app cannot show it (KB.ini `Fw=24` is the expected value; `FwVerNeedToUpdate` is
  commented out for MK75).
- **Model / password check — EMULATED** (`0x495390`, called during open when Psd ≠ 0; MK75
  `Psd=3,0,0,0,0,c6`):
  ```
  SetFeature(hCmd)  report 05: 05 81 00 00 00 00 00 00   (8 payload bytes as sent; pad/truncate
                                                           to the report-05 size on WebHID)
  GetFeature(hCmd)  report 05: 01 03 00 00 00 00 C6       (7 payload bytes)
  ```
  Accepted iff `reply[0] == 0x01`; `reply[1..6]` must equal Psd, else "Psd unmatch" and the device
  is not used. Emulation with that reply → returns 1 and stores `03 00 00 00 00 C6`.
- **Battery — STATIC**: none on wired CDev916KB (`ShowPower=0`; no ReadPower/GetPower in its
  vtable; `SetBattery` UI path is used by wireless classes only).

## 3. Factory reset
- **STATIC**: CDev916KB has **no reset command**. vt slot 13 (the reset slot used by CDevG5KB's
  "Reset using cmd", gated by KB.ini `CmdReset`) is the stub `0x4931D0` (`xor eax,eax; ret 4`) on
  CDev916KB; its ApplySetting (`0x496A10`) handles only flags 1 (macros+key matrix), 2 (profile),
  0x10 (per-key LED pages), 0x40 (RGB table) — no 0x20 reset flag. `CmdReset` is parsed (dev+0x2D78,
  default 0, unset for MK75). The vendor "Reset/Restore" button therefore restores the driver's
  default settings and re-applies them via the normal writes. Web app: implement reset as writing
  defaults (factory-ish profile, default key matrix from KB.ini, palette) — **GUESS** for exact
  default values (best: snapshot from a fresh keyboard).

## 4. Sleep timer / debounce
- **Sleep — STATIC** (profile patch `0x4968F0`, same logic as AU75):
  `profile[0x11] = 0xFF` if the "sleep" checkbox is off (ui+0x333C ≠ 0), else
  `SleepHW[idx]` (byte table dev+0x2DD4). Written only when `ShowSleep` (dev+0x2D8C) ≠ 0 —
  **default 1**, MK75 KB.ini doesn't override → **MK75 writes byte 0x11**.
  Default tables (no SleepUI/SleepHW in MK75 INI), device type ≠ 0x16:
  | UI (seconds) | 30 | 60 | 90 | 120 | 180 | 240 | 300 | 600 | 900 | 1200 |
  |---|---|---|---|---|---|---|---|---|---|---|
  | HW code = s/30 | 1 | 2 | 3 | 4 | 6 | 8 | 10 | 20 | 30 | 40 |
  (type 0x16 variant: UI 1..10, HW 1..10.) UI shows the row when ShowSleep && (type 0x16 or a
  wireless VID/PID is configured — true for MK75). Text: "In wireless mode, keyboard will go into
  sleep after idle for a specified time". `SleepTime` default 120 (dev+0x2D90) = default choice.
- **Debounce — STATIC**: MK75 `ShowDebounce=0x04000101` (dev+0x2D28) only enables a settings row
  (ui+0x3340 = selected index, shown as index+1 with a unit string). CDev916KB::ApplySetting never
  reads ui+0x3340 and no wired function sends it → **debounce is not transmitted on wired** in this
  driver build (only CDevG5KB's `FillCfg_LowDaly` Cfg[2] uses a debounce value). Encoding of
  0x04000101 (likely max/min/step) **GUESS**.

## 5. Timing (wired)
- **STATIC/EMULATED**: ctor `0x494DD0` sets obj+0x2A0 = **0x19 = 25 ms** (delay between the read
  command on report 05 and GetFeature on report 06). Confirmed in MK75 build.
- Every HidD_Set/GetFeature retried 3× with `Sleep(200)` on failure. **EMULATED** (wrapper 0x495270).
- ApplySetting sequence delays (**STATIC**, same as AU75): Sleep(30) at start; macro pages
  Sleep(50) after each; key matrix then Sleep(50); Sleep(30) before profile read (83 B6); Sleep(20)
  before RGB table, Sleep(100) after; Sleep(30) before per-key LED pages, Sleep(50) after each page;
  Sleep(30) before profile write. Live stream ~20 ms/frame.
