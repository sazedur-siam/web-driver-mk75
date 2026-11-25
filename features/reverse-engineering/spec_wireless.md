# MK75 wireless (2.4 GHz dongle / Bluetooth) protocol — from LINGBAO OemDrv.exe v2.0 (2025-07-16)

Labels: **EMULATED** = bytes captured by running the vendor function in Unicorn (tools/emu3.py, w1–w5.py);
**STATIC** = read from disassembly; **GUESS** = inference.

## 0. Architecture (STATIC)

* Wired MK75 (`258A:010C`, usage page 0xFF00) → `CDev916KB` (already ported; frames identical in this build — EMULATED).
* Wireless: the driver classifies each HID interface of a known wireless VID/PID (`VID_Wireless/PID_Wireless`
  = `3554:FA09` for MK75) in `0x40c810` using HIDP_CAPS copied at `0x417052`:
  `rec+0x208` = report ID (from value caps), `+0x20c` InputReportByteLength, `+0x210` OutputReportByteLength,
  `+0x214` FeatureReportByteLength, `+0x218` UsagePage, `+0x21c` Usage.

| Type | Class | UsagePage/Usage | In/Out len (incl. ID) | Report ID | Notes |
|---|---|---|---|---|---|
| 0x5588 | `CDevComboFilm` (vt 0x62258c) | 0xFF02 / 0x0002 | 20 / 20 | **0x15** | "Combo" receiver (keyboard + mouse channels) |
| 0x13632 | `CDev3632` (vt 0x620fb4) | 0xFF02 / 0x0002 | 20 / 20 | **0x13** | has the `bBT` flag; OpenRGB F99 capture matches this one |
| 0x8805 | `CDevG5MS` | 0xFF02 / 0x0002 | in 8, feature 0x208 | – | wired G5 mouse, not MK75 |

  Which one the MK75 dongle exposes cannot be determined from the binary (both are reachable from the same
  VID/PID); **the web driver must pick by the output report ID in the descriptor (0x15 → Combo framing,
  0x13 → 3632 framing)**. Everything below is identical for both except the report-ID byte (EMULATED).
* Both wireless classes delegate keyboard logic to a temporary **`CDevG5KB`** object (type 0x916, vt 0x6235cc)
  whose methods forward to the transport (`[G5KB+0x23c]` = transport) — STATIC (`0x4991b0`, `0x499650`, …).
  Its ApplySetting is `0x49bae0` (STATIC). `CDevComboFilm::ApplySetting` (`0x498550`) uses G5KB when
  `[devrec+0x14]==1` (keyboard) and `CDevG5MS` when `==0` (mouse) — STATIC. `CDev3632::ApplySetting`
  (`0x494c50`) always uses G5KB — STATIC.
* `bBT` (`devrec+0x30c`) is set in `OnNewDongle` and only logged in ApplySetting/used in reconnect logic;
  it does **not** change packets — STATIC. GUESS: it marks a Bluetooth-HID (BLE) enumeration of the same
  vendor collection, so BT uses the exact same 20-byte protocol.

## 1. Packet format

Output report (WriteFile, 20 bytes incl. ID), helper `0x4947c0`, timeout 500 ms — EMULATED:

```
byte 0     report ID: 0x15 (Combo) / 0x13 (3632)
byte 1     cmd
byte 2     total packet count of this transfer (ceil(len/14), 1 for a request)
byte 3     packet index 0..total-1
byte 4     (sub << 4) | dataLen          sub = layer / page / group (0..15); dataLen 0..14
           (3632 writes the same sub nibble on every packet; Combo too)
bytes 5-18 data (zero padded)
byte 19    checksum = (sum of bytes 0..18) & 0xFF
```

Input report (read from the service-thread ring buffer, `0x492f50`) — EMULATED/STATIC (`0x497650`, `0x4934a0`):

```
byte 0     0x13 observed in vendor/OpenRGB traffic (GUESS for Combo; 0xFF = "invalid" → error -4)
byte 1     cmd echo (must equal request cmd; non-matching packets are skipped, up to 20)
byte 2     total packets; bit7 set = device busy/error → -3 (retry if allowed)
byte 3     packet index (3632 checks ack index == sent index)
byte 4     low nibble = data length (≤14)
bytes 5-18 data, byte 19 checksum
```

* **Write** (`SendData`: Combo `0x497ba0`, 3632 `0x493930`): split into 14-byte chunks; before each packet a
  busy-wait of `delay` ms (15 ms; 10 ms for 0x88/0x8E) — STATIC `0x4051c0`. After each packet wait for an
  ack packet with the same cmd (timeout 1500 ms Combo; 2000 ms or 7000 ms 3632). No ack is awaited when
  cmd bit7 is set (0x88, 0x8E) or cmd == 6 (3632). On busy/timeout retry the packet up to 5× when the
  retry flag is set (all keyboard writes set it) — STATIC.
* **Read** (`ReadData`: Combo `0x497e60`, 3632 `0x493cc0`): send one request `[id][cmd][01][00][sub<<4]…[chk]`,
  then collect `total` reply packets, copying `len&0xF` bytes each in index order, until the requested length
  is filled; timeout 1000 ms per packet, 3 attempts — EMULATED/STATIC.
* **Online query**: `cmd 0x07`, read 2 bytes (Combo: byte0 = keyboard online, byte1 = mouse online) or 1 byte
  (3632) — EMULATED (`0x4984a0`, `0x40c9af`, `0x494490`).

## 2. Command table (keyboard channel; Combo adds +0x10 for the mouse channel) — EMULATED unless noted

| Cmd | Dir | sub | Payload | Vendor fn | Example (Combo) |
|---|---|---|---|---|---|
| 0x01 | W | layer 0-3 | key matrix layer, 512 B | SetMatrix `0x4980c0` / 3632 `0x493fe0` | `15 01 03 00 0e …` (layer 0), `15 01 01 00 2e …` (layer 2) |
| 0x41 | R | layer | key matrix layer | GetMatrix `0x498110` / `0x494020` | req `15 41 01 00 10 00… 67` (layer 1) |
| 0x02 | W | group | per-key colours, 0x17A B (R[126] G[126] B[126]) | `0x4983e0` / `0x494280` | `15 02 1b 00 0e …` (27 pkts) |
| 0x42 | R | group | per-key colours | `0x498420` / `0x4942c0` | |
| 0x03 | W | chunk idx | macro buffer, 0x200-byte chunks, 100 ms between chunks | SetMacro `0x498200`→`0x498150` / `0x4940f0` | `15 03 25 00 0e …` |
| 0x43 | R | 0 | macro buffer | `0x498240` / `0x494130` | req `15 43 01 00 00… 59` |
| 0x04 | W | 0 | LED profile, **128 B** | SetLED `0x498270` / `0x494150` | `15 04 0a 00 0e …` (10 pkts) |
| 0x44 | R | 0 | LED profile, 128 B | GetLED `0x4982d0` / `0x4941a0` | req `15 44 01 00 00… 5a` |
| 0x09 | W | 0 | RGB palette table, 0x200 B (CRC) / 0x1A4 B | `0x498440` / `0x4942e0` | `15 09 25 00 0e …` (37 pkts) |
| 0x49 | R | 0 | RGB palette table | `0x498480` / `0x494320` | req `15 49 01 00 00… 5f` |
| 0x0A | W | 0 | 1 B on-board profile index | SetOnBoard `0x498310` / `0x4941d0` | `15 0a 01 00 01 03 00… 24` |
| 0x4A | R | 0 | 1 B on-board profile (3632: 2 B = battery %, status) | GetOnBoard `0x498370`; 3632 ReadPower `0x4943c0` | req `15 4a 01 00 00… 60` |
| 0x07 | R | 0 | online flags | `0x4984a0` | req `15 07 01 00 00… 1d` |
| 0x88 | W, no ack | mode | live LED stream (music/real-time effect) | `0x4984f0` (only if not applying) | `15 88 03 00 0e …` |
| 0x8E | W, no ack | mode | live stream variant | `0x498520` | `15 8e 03 00 1e …` |
| 0x06 | W, no ack | item | factory reset (**3632 only**; Combo vt+0x34 is a stub returning 0) | 3632 `0x494450` | `13 06 01 00 10 00… 2a` (item 1) |

3632 ReadPower (EMULATED): reply `13 4a 01 00 02 55 10 …` → battery = byte0 (0x55 = 85 %), "charging"
flag = (byte1 & 0xF0) && !(byte1 & 0x0F) (STATIC 0x494426). MK75 KB.ini has `ShowPower=0`.

## 3. G5KB ApplySetting sequence (`0x49bae0`, STATIC; nFlag bits same as wired: 1 keys, 2 profile, 0x10 custom colours, 0x20 colour groups, 0x40 palette)

1. If `CmdReset` INI flag: reset (vt+0x34) — not set for MK75.
2. `nFlag & 1`: FillMatrix (`0x49af80`) → for each layer 0..3 not masked by `LayerMask` and dirty:
   `cmd 0x01` sub=layer, len = `MatrixLen*4` (MatrixLen default 0x80 → **512 B**); 50 ms sleep after each.
   Then macros: `cmd 0x03` with the whole macro buffer (≤ MacroBufferSize, max 0x2800) in 512-byte chunks.
3. Colour groups when (`nFlag&0x10` and active effect is Self-define) or `nFlag&0x20`: for each group g < GaoshouGroupNum
   whose dirty bit is set: `cmd 0x02` sub=g, 0x17A bytes.
4. `nFlag & 0x102` and not Self-define and `nFlag&0x40`: sleep 120 ms, build palette, `cmd 0x09`.
5. LED profile: `cmd 0x44` read 128 B; retry (≤5, 100 ms) until bytes `[0x7E]=0x5A, [0x7F]=0xA5`;
   patch (layout B below); sleep 60 ms (100 ms if palette was written); `cmd 0x04` write 128 B.
6. ApplySetting wrapper (`0x498550`): sets "applying" flag (+0x1c, suppresses 0x88/0x8E streaming), Sleep 200 ms
   before, 50 ms after.

## 4. Data layouts

### 4.1 LED profile, 128 B (cmd 0x04/0x44)
Two layouts, chosen by INI `SubFw` (`dev+0x2d77`; default 0). **MK75 has no SubFw → layout B (`0x49b6b0`)** — STATIC.

Layout B (MK75):

| Offset | Meaning | Source |
|---|---|---|
| 0x03 | debounce value (if ShowDebounce≠0; MK75 `ShowDebounce=0x04000101`) | STATIC |
| 0x09 | 1 if active effect is Self-define (GaoshouIndex) else 0 | STATIC |
| 0x0A | hardware effect ID (LedOpt hw column) | STATIC |
| 0x0B | StartGp + colour group | STATIC |
| 0x16 | sleep: 0 if sleep disabled else sleep value (ShowSleep) | STATIC |
| 0x17 | auto-detect flag (only if ShowAutoDetect==1; MK75 not) | STATIC |
| 0x18 | sleep code (table) or 0 | STATIC |
| 0x1A | knob/wheel mode (only if WheelMode set; MK75 not) | STATIC |
| 0x38, 0x39 | always 0xFF | STATIC |
| 0x3A+2i | effect i brightness (LightHW[0..4]), i = LedOpt index 0..18 | STATIC |
| 0x3B+2i | effect i `(SpeedHW[speed] << 4) \| (colourful ? RandomVal(7) : 0)` | STATIC |
| 0x7E, 0x7F | signature 0x5A 0xA5 (validated on read, preserved) | STATIC |

No per-effect palette index is sent in layout B: colour nibble is 0 (first palette colour) or 7 (colourful) — STATIC.
(Layout A, `0x49b4c0`, indexes per-effect bytes at `0x53+2*hw`, active hw at 0x21 — not used by MK75.)

**Not the same as wired** (254 B: custom@4, hw@5, group@6, FF@0x14/15, pairs@0x16 `[colourIdx, speed<<4|bright]`).

### 4.2 Palette, cmd 0x09/0x49 (`0x49c22c`, STATIC)
Buffer 0x400 zeroed; for each LedOpt i (0..18) not masked by LedMask: 7 colours × RGB (RGBIndex 0,1,2 = R,G,B) at
**`0x15 * hw`**. Sent length 0x1A4 (hw 0..19); with INI `CRC=1` (MK75 has CRC=1) the 0x1A4 bytes are copied into a
0x200 buffer with `[0x1FA]=0x5A, [0x1FB]=0xA5` and 0x200 bytes are sent. For hw 1..18 this is byte-identical to the
wired table offset `0x15*(i+1)`; the wired parse/patch functions can be reused (pad to 0x200 + signature).

### 4.3 Per-key colours, cmd 0x02 (`0x49c006`, STATIC)
Per group g: R plane[126] @0, G @0x7E, B @0xFC (GameRGBIndex 0,1,2) indexed by LED index (KB.ini last column),
0x17A bytes, sub = g. Identical to one group of the wired 0x762 buffer → reuse `buildLedMatrix()` first 0x17A bytes.

### 4.4 Key matrix, cmd 0x01/0x41 (`0x49af80`, STATIC + EMULATED encoder)
Per layer: MatrixLen (128) little-endian u32, indexed by key matrix index (< 0x90). Layers 0..3 (GUESS: 0 = base,
1 = FN1, 2 = FN2, 3 = Tap, matching the UI tabs). With CRC=1 the last u32 of each layer = **0xA55A0000**.
Codes come from the G5 encoder (`0x49a4d0`), which **differs from the wired encoder** (`0x495bf0`) — EMULATED:

| Input | wired 916KB | wireless G5KB |
|---|---|---|
| key A | 04000000 | 04000000 |
| Ctrl+C (mods 0x01) | 06010000 | 06000100 |
| any key + mods m | `hid<<24 \| m<<16` | `hid<<24 \| m<<8` |
| modifier only (LCtrl) | e0000006 | 00000100 (`m<<8`) |
| VK LCtrl/RShift… | e0000000/e5000000 | same |
| consumer usage U | `lo<<24\|hi<<16\|0x04` | `lo<<24\|hi<<16\|0x02` (e.g. Play cd000002, Email 8a010002) |
| mouse left/middle/right/fwd/back | f0/f1/f2/f3/f4 000007 | 00010101 / 00010201 / 00010301 / 00010501 / 00010401 |
| double / triple left click | – | 32020101 / 32030101 |
| scroll up / down | – | 00000801 / 00000901 |
| preset Ctrl+Z / Ctrl+S | 1d010000 / 16010000 | 001d0100 / 00160100 |
| disabled | 0 | 0 |
| KB.ini type-9 code X (Fn layer) | bswap32(X) | bswap32(X) (e.g. 0x07000014→14000007) |

So on the wireless link, bytes (LE) are `[type][mods][x][hid]`: type 0x00 key, 0x01 mouse, 0x02 consumer.

### 4.5 Macro buffer, cmd 0x03/0x43 (STATIC, partial)
Single blob ≤ MacroBufferSize (devrec+0x2dc; ≤ 0x2800): table of u32 `[addr:u16][size:u16]` per macro, each macro at
`addr` = `[nameLen][name…][events…]`. Event encoding not decoded (GUESS: same as wired macro pages).

## 5. Reuse summary for the web code
* Transport: new — 20-byte output reports with report ID 0x15 or 0x13 (WebHID `sendReport`), replies via
  `inputreport` events; checksum; 14-byte chunking; per-packet ack; 15 ms pacing.
* Palette & per-key planes: **same layout** as wired (pad palette to 0x200 + 5A A5 at 0x1FA when CRC=1).
* LED profile: **different** (128 B, layout B above, signature 5A A5 at 0x7E).
* Key matrix: **different** container (4 × 512 B layers + A55A0000 trailer) and **different code encoding** (§4.4).

## 6. Out-of-scope observations for the wired port
* Wired mouse button codes: F0 left, F1 **middle**, F2 **right**, F3 forward, F4 back (EMULATED from 0x495bf0,
  inputs 0x11..0x15 = left, right, middle, forward, back). The current web UI maps index 1 ("Right click") to F1.
* Wired/INI Fn-layer codes use type 0x02 for consumer keys (`bswap32` of KB.ini values, e.g. 0x020000cd → cd000002);
  the web code's "low byte 0x02 = Fn redirect" assumption (from FillMatrix) should be re-checked against real reads.
