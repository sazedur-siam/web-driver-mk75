# Lingbao MK75 protocol (reverse-engineered)

The MK75 uses the same vendor framework and firmware family as the AULA AU75; the wired frames of the
official LINGBAO Keyboard Driver v2.0 (2025-07-16) were emulated and are byte-identical to the AU75 build
(functions shifted by +0xA130). Sections below were first derived from the AU75 build and re-verified on the MK75 one.

Source: `AULA AU75 3 IN 1 Setup v2.0 20250805.exe` (Inno Setup) → `OemDrv.exe` (32-bit MFC, unpacked)
plus `Dev/kb/AU75/KB.ini`. The device class inside the driver is `CDev916KB` (vtable `0x6133CC`).

Wire bytes were confirmed by **emulating the driver's own functions in Unicorn** with
`HidD_SetFeature`/`HidD_GetFeature` hooked, so the frames below are what the vendor tool sends, not guesses.
Field semantics come from static analysis of the code that fills those buffers.

## USB

| | VID:PID | Notes |
|---|---|---|
| Wired | `258A:010C` | Sinowealth. Supported by this port. |
| 2.4 GHz dongle | `3554:FA09` | Different 20-byte checksummed protocol. **Not implemented.** |

The driver opens HID top-level collections with usage page `0xFF00`, usage `0x01`:

| Handle | Feature report | Length (Windows caps) | Use |
|---|---|---|---|
| `hCmd` (+0x294) | `0x05` | short | 6-byte commands |
| `hDev` (+0x290) | `0x06` | `0x408` incl. ID | 1031-byte data frames |
| `hMusic` (+0x298) | `0x08` | `0x17E` incl. ID | live LED stream `[0A 7A 01][378 B]` (music mode, unused here) |

The keyboard must be in Windows mode (Fn+W). The vendor UI says so (`tc_tap_tips`).

## Framing

```
command  (report 05, 6 B):     op  sub 00 00 00 00
data     (report 06, 1031 B):  op  sub 00 FL 00 00 00  payload…
```

* **Read**: send `op|0x80, sub` on report 05, sleep (per-device delay), `GetFeature(06)`.
  The reply starts with the echoed `op|0x80`, and the payload starts at offset 7.
* **Write**: send the full data frame on report 06. `FL` is `0x40` for 1 KiB pages and `0x00` for the profile.
* The driver retries each HID call 3 times with a 200 ms back-off.

| Function (driver addr) | Read | Write | Payload |
|---|---|---|---|
| Profile / lighting (`0x48B400`/`0x48B360`) | `83 B6` | `03 B6 00 00` | 254 B |
| Key matrix (`0x48B670`/`0x48B5B0`) | `84 D4` | `04 D4 00 40` | 1024 B |
| LED palette "rgbTab" (`0x48B830`/`0x48B760`) | `88 B8` | `08 B8 00 40` | ≤1024 B |
| Per-key colours "SetLedMatrix" (`0x48B4F0`) | none | `09 BC 00 40`, `09 C0 00 40` | 2 × 1024 B |
| Macro data "SetMacroData" (`0x48B940`) | none | `05 <page> 00 40` | 1024 B per page |
| Password check (`0x48B260`) | `05 81 …` on report 05 → reply `[01, psd×6]` | | compared to `Psd=3,0,0,0,0,c6` |

The `sub` bytes look like flash page addresses (`0xB600`, `0xB800`, `0xBC00`, `0xC000`, `0xD400`).

## Profile block (254 B), patched by `0x48C710`

| Offset | Meaning |
|---|---|
| `0x04` | 1 if the active effect is Self-define (`GaoshouIndex`=18), else 0 |
| `0x05` | hardware effect ID (`LedOptN` first column) |
| `0x06` | custom colour group = `StartGp` + group (`0x20` on MK75; `0` on AU75) |
| `0x11` | sleep code, written only if `ShowSleep` (AU75: off) |
| `0x14`, `0x15` | always `0xFF` |
| `0x16+2i` | effect *i* colour: palette index 0–6, or `RandomVal` (7) = colourful |
| `0x17+2i` | effect *i* `(SpeedHW[speed] << 4) \| LightHW[brightness]`, levels 0–4 (identity tables) |

*i* is the LedOpt index. The driver writes *i* < (number of visible effects) = 17. Everything else is read-modify-write.

### Effects (`LedOptN = hw, preview, speed, light, direct, random, color`)

| i | Name | hw | i | Name | hw |
|---|---|---|---|---|---|
| 0 | Fixed on | 1 | 10 | Neon stream | 11 |
| 1 | Respire | 2 | 11 | Reaction | 12 |
| 2 | Rainbow | 3 | 12 | Sine wave | 13 |
| 3 | Flash away | 4 | 13 | Retinue scanning* | 14 |
| 4 | Raindrops | 5 | 14 | Rotating windmill | 15 |
| 5 | Rainbow wheel* | 6 | 15 | Colorful waterfall | 16 |
| 6 | Ripples shining | 7 | 16 | Blossoming | 17 |
| 7 | Stars twinkle | 8 | 17 | Rotating storm* | 18 |
| 8 | Shadow disappear | 9 | 18 | Self-define | 21 |
| 9 | Retro snake | 10 | 19 | Off | 0 |

\* hidden by `LedMask=0x22020`.

## Palette ("rgbTab")

Effect *i*'s 7 colours sit at `0x15*(i+1) + 3k`, in R,G,B order (`RGBIndex=0,1,2`). The first 0x15 bytes are zero.
The driver writes it only when the active effect is not Self-define.

## Per-key colours

Buffer `0x762` B = up to 5 groups × (`R[126]`, `G[126]`, `B[126]`) planes, indexed by the key's LED index
(same as the matrix index in KB.ini). It is split into pages `0xBC` (bytes 0–1023) and `0xC0` (1024–2047).
The AU75 has 1 group.

Vendor apply order: palette (if not custom) → per-key pages (if custom) → profile.

## Key matrix (1024 B)

Little-endian u32 slots. Slots 0–131 are the base layer, indexed by matrix index (`index = column*6 + row`).
If a slot's low byte is `0x02`, it redirects to slot `132 + (int8)byte3`. The driver (`FillMatrix`) writes the
real code there. Fn single and Fn combo tables follow.

| Low byte | Meaning | Example |
|---|---|---|
| `00` | key: byte2 = HID modifier mask, byte3 = HID usage | Alt+F4 `3D040000` |
| `04` | consumer: byte2 = usage lo, byte3 = usage hi | Play `CD000004`, Email `8A010004` |
| `06` | modifier alone: byte3 = `E0`–`E6` | `E0000006` |
| `07` | mouse: byte3 = `F0`–`F4` | left `F0000007` |
| `10` | macro: byte2 = repeat mode (1/2/4), byte3 = macro slot | |
| `02` | Fn-slot redirect | |
| `00000000` | disabled | |

## Macros (wired)

32 macros × 128-byte slots, 8 per 1 KiB page, written with `05 DC/E0/E4/E8 00 40` (only `ceil(n/8)` pages; no read-back).
Slot = `00 01` + events: `[down?0x80:0 | max(delay,3), usage]`, or for delays > 127 ms
`[flag | max(delay%100,3), usage, 00, 03, hi, lo]` (BE count of 100 ms). Mouse: F0 left, F1 middle, F2 right.
Key reference in the matrix: `[10, 00, mode, id-1]`, mode 1 = once, 2 = while held, 4 = until any key. Ids are assigned in key order.

## Live lighting (music / real-time effects)

Wired: feature report `0x08` = `0A 7A 01` + 126 × RGB triplets indexed by LED index, ~50 fps, no enable/disable command.
Wireless: cmd `0x88` sub 1 = groups `[R, G, B, count, led…]`, ≤ 200 bytes.

## Misc

* Model check: report 05 `05 81 …` → `01 03 00 00 00 00 C6` (KB.ini `Psd`).
* Sleep: profile byte `0x11` = `FF` (off) or seconds/30 (30 s … 20 min). Read delay 25 ms.
* Firmware version = USB `bcdDevice` only. No factory-reset command on the wired class.

## 2.4 GHz receiver / Bluetooth

Usage page `0xFF02` usage `0x02`, 20-byte output/input reports. Output report ID `0x15` (receiver, `CDevComboFilm`)
or `0x13` (`CDev3632`); pick by the descriptor.

```
[id][cmd][total][index][(sub<<4)|len][14 data][sum(bytes 0..18) & 0xFF]
```

Replies echo `cmd`; bit 7 of `total` = busy. Writes: 14-byte chunks, 15 ms apart, per-packet ack, ≤ 5 retries.
Reads: one request, then `total` reply packets.

| Write / read | Content |
|---|---|
| `01` / `41` (sub = layer 0-3) | key matrix layer: 128 × u32, last = `A55A0000` |
| `02` / `42` (sub = group) | per-key colours, R/G/B planes of 126 |
| `03` / `43` | macro store block, block number 0–7 in the layer nibble (see below) |
| `04` / `44` | LED profile, 128 B, signature `5A A5` at 0x7E |
| `09` / `49` | palette 0x200 B (wired offsets `0x15*hw`), `5A A5` at 0x1FA |
| `07` | online (byte0 = keyboard connected) |
| `88` / `8E` | live stream (no ack) |
| `4A` | on-board profile; battery on `0x13` receivers: `[percent, flags]`, flags `01` battery, `10` charging, `11` charged |
| `06` | factory reset (`0x13` receivers only) |

LED profile (MK75 "layout B"): `0x09` custom flag, `0x0A` hw effect, `0x0B` colour group, `0x03` debounce 0–4, `0x16` tap/hold threshold, `0x18` sleep (`0` = never),
`0x38-39 = FF`, per effect `0x3A+2i` brightness and `0x3B+2i` = `speed<<4 | (colourful ? 7 : 0)`.
Macro store (IC2481 cable op `05`/`85`, wireless `03`/`43`; hw-re-docs, tested on a real MK75): up to 8 blocks
of 512 B (never block 8+, that's firmware). `[N × (offset u16, length u16)]` then bodies
`[2 × nameChars][name UTF-16LE][4-byte events]`; event `[release<<7 | type<<4 | delay>>16, delay>>8, delay, code]`,
type 0 key, 1 modifier, 2 mouse mask (1 L, 2 R, 4 M). Key cell `03 mode count id` (id 0-based; mode 1 once,
2 loop until another key, 4 toggle).
Key codes are `[type][mods][x][hid]`: key `hid<<24 | mods<<8`, consumer `…|0x02`, mouse `clicks<<16 | button<<8 | 0x01`
(1 left, 2 middle, 3 right, 4 back, 5 forward).

## Not yet decoded / not ported

* Fn-layer remapping (the official driver doesn't offer it for the MK75 either). The knob has two firmware modes, layout B byte `0x1A`: 0 media (volume), 1 lighting
* Debounce on CDev916KB boards (the vendor never sends it there; layout B has it at byte `0x03`, 0–4), firmware update
