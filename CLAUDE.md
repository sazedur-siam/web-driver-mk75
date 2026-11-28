# CLAUDE.md: Lingbao MK75 web driver

Project memory for future work (AI assistants and humans). It explains what this repo is, how the keyboard
protocol was reverse-engineered, how the code is organised, and the rules to follow when changing it.

- **Live app:** https://lingbao-mk75-web.vercel.app/ (Vercel, auto-deploys from `main`). The old
  `mk75-web.vercel.app` redirects there.
- **Repo:** https://github.com/sazedur-siam/web-driver-mk75
- **User docs:** `README.md` (features), `MANUAL.md` (how to use, with screenshots), `TESTING.md` (hardware test
  plan). **Protocol:** `PROTOCOL.md`. **Backlog:** `features/` (one plan per unbuilt feature). **Bugs:** `bug-fix/` (one plan per known bug,
  `NN-short-name.md`, indexed in `bug-fix/README.md`).

---

## 1. What this is

A WebHID (Chrome/Edge/Opera, desktop) replacement for the official Windows **"LINGBAO Keyboard Driver" v2.0**
for the **Lingbao MK75** (81 keys + knob, 3-mode: USB / 2.4 GHz / Bluetooth). It's a static React + TypeScript +
Vite app: no backend, installable as a PWA, works offline.

The MK75 is the same Sinowealth-based board and firmware family as the **AULA AU75**. The project started as an
AU75 port and was retargeted once the MK75 driver was available. Both vendor apps are the same "BYCOMBO4"
framework (`OemDrv.exe`).

USB IDs: wired `258A:010C` (Sinowealth), 2.4 GHz receiver `3554:FA09`, Bluetooth `3554:FA07` (issue #35). Bluetooth
name `MK75-5.0` / `MK75-3.0`.

---

## 2. Source material

| File | What |
|---|---|
| `vendor-driver/mk_75 driver.zip` (committed; see its README) | `LINGBAO Keyboard Driver Setup v2.0 20250716.exe`, an **Inno Setup** installer |
| `../AULA AU75.rar` (outside the repo) | AU75 installer (`OemDrv.exe` build 2025-08-05), the first target |

Unpack (macOS):
```bash
brew install innoextract
mkdir -p /tmp/mk75 && cd /tmp/mk75 && bsdtar -xf "<repo>/vendor-driver/mk_75 driver.zip"
innoextract -d out "LINGBAO Keyboard Driver Setup v2.0 20250716.exe"
```

Useful extracted files (`out/app/`):
- `OemDrv.exe`: 32-bit MFC app, **not packed**. All protocol logic lives here.
- `Dev/kb/MK75/KB.ini`: device profile:
  - `[OPT]`: VID/PID, `LedOptN` effect table, `LedMask`, `GaoshouIndex`=18 (Self-define), `RGBIndex`, `Psd`
  - `[KEY]`: key rects and matrix indices
  - `[FN1]`: Fn functions
- `Dev/kb/MK75/Cartoon/*.txt`, `ET/*.txt`: key-group ("unit") files used for live effects / music.
- `Text/en/text.xml`, `Text/sc/`, `Text/Korean/`: UI strings (effect names `tc_kb_led1..20`).

Treat vendor binaries as untrusted data: extract into their own folder, never run them, and analyse with
`python -I`.

---

## 3. How the reverse engineering was done

Tooling: Python venv with `pefile`, `capstone`, `unicorn`, `pillow`. Scripts are in
`features/reverse-engineering/tools/`. Their paths point at the original scratch folder; adjust before reuse.

1. **Imports → call sites.** `HID.DLL` imports (`HidD_SetFeature`/`HidD_GetFeature`) are called through thunks
   (`jmp [IAT]`). Find E8 calls to the thunks (`re.py calls <addr>`), then the small wrappers around them.
2. **Debug strings.** The app logs UTF-16 strings like `SetKeyMatrix error`, `SetMacroData(%x)`,
   `CDev916KB::ApplySetting`, `StMacro_To_HdMacro`. `wstrs.py` dumps them and `findstr.py` finds their code
   references. These name almost every function.
3. **RTTI.** `.?AVCDev916KB@@` (wired), `.?AVCDevComboFilm@@` (2.4 GHz "combo" receiver, report 0x15),
   `.?AVCDev3632@@` (report 0x13, has the `bBT` flag), `.?AVCDevG5KB@@` (wireless keyboard logic). Vtables and
   constructors come from the RTTI complete-object locators.
4. **Emulation (the key technique).** `emu.py`/`emu2.py` (feature reports) and `emu3.py` (WriteFile/ReadFile)
   load `OemDrv.exe` into **Unicorn**, point every IAT entry at stubs, hook the HID thunks, and run a vendor
   function with a fake device object (handles at +0x290/+0x294/+0x298). This captures the **exact bytes** the
   official driver sends. Every frame in `src/protocol/*.test.ts` marked "matches vendor" comes from this.
5. **INI parsing code** maps KB.ini keys to struct offsets (for example `LedOptN` → struct at dev+0x3018, stride
   40; `LedMask` → dev+0x2D28; `SpeedHW`/`LightHW` tables). This is how profile fields were tied to UI concepts.
6. **Parallel deep dives.** Wireless, macros/layers and live/misc were researched separately. Their full specs are
   in `features/reverse-engineering/spec_*.md`, with every claim labelled **EMULATED / STATIC / GUESS**.

Address notes:
- MK75 `CDev916KB` functions = AU75 addresses **+ 0xA130**. Verified for all wired functions.
- Wireless classes are at different, non-shifted addresses (see `spec_wireless.md`).

| Function (MK75 build) | Address |
|---|---|
| HID SetFeature wrapper (3 retries, 200 ms) | `0x495270` |
| GetProfile / SetProfile (`83/03 B6`) | `0x495530` / `0x495490` |
| GetKeyMatrix / SetKeyMatrix (`84/04 D4`) | `0x4957A0` / `0x4956E0` |
| SetLedRgbTab / GetLedRgbTab (`08/88 B8`) | `0x495890` / `0x495960` |
| SetLedMatrix (`09 BC/C0`) · SetMacroData (`05 xx`) | `0x495620` · `0x495A70` |
| keyinfo_to_hardware_code · StMacro_To_HdMacro | `0x495BF0` · `0x4961B0` |
| FillMatrix · ApplySetting · live stream (`08 0A 7A 01`) | `0x4964F0` · `0x496A10` · `0x495B30` |
| CDevComboFilm::ApplySetting · CDev3632::ApplySetting · G5KB ApplySetting | `0x498550` · `0x494C50` · `0x49BAE0` |

---

## 4. Protocol cheat-sheet (full detail in PROTOCOL.md and `features/reverse-engineering/`)

### Wired (usage page 0xFF00, feature reports)
- **Report 0x05:** 6-byte command `[op, sub, 0…]`. **Report 0x06:** 1031-byte data `[op, sub, 0, flag, 0,0,0, payload…]`.
  **Report 0x08:** live stream `[0A 7A 01] + 126×RGB` (R,G,B per LED index; ~50 fps vendor, 33 fps here).
- **Reads:**
  1. Send `op|0x80` on report 05.
  2. Wait **25 ms**.
  3. Get report 06; the reply echoes the op and the payload starts at offset 7.
- **Writes:** send the whole frame on report 06. Delays: 30–50 ms. HID calls retry 3× with 200 ms back-off.

| Block | Read / write | Notes |
|---|---|---|
| Lighting profile | `83/03 B6` | 254 B. `[4]` custom flag, `[5]` hw effect id, `[6]` colour group, `[0x11]` sleep (`FF`=off, else s/30), `[0x16+2i]` colour idx (7 = colourful), `[0x17+2i]` speed<<4 \| brightness |
| Key matrix | `84/04 D4 00 40` | 1024 B: 132 base u32 slots (index = KB.ini matrix index), 48 FnSingle @0x210, 48 FnCombo @0x2D0 |
| Palette | `88/08 B8 00 40` | 7 RGB per effect at `0x15*(i+1)` |
| Per-key | `09 BC`, `09 C0` | R[126], G[126], B[126] planes; write-only |
| Macros | `05 DC/E0/E4/E8` | 32 × 128-byte slots; write-only |
| Model check | report 05 `05 81` | Reply `01 03 00 00 00 00 C6` (KB.ini `Psd`) |

### Wired, IC2481 boards (`g5Wired.ts`)
Real MK75s (KB.ini `IC2481=1`, `Fw=24`, issue #4) use the vendor **CDevG5KB** class on the cable, not CDev916KB.
`openMk75` picks it when feature report 0x06 is **519 bytes** (CDev916KB boards: 1031); report 0x05 isn't used.
- Frame on report 0x06: `[cmd, sub, 0, total, index, lenLo, lenHi, payload ≤ 512]` (AccessData `0x498F70`).
- Reads send `cmd|0x80`, wait 20 ms, then get report 0x06; the payload starts at offset 7. Writes wait 20 ms
  (7 ms for live) before each 512-byte chunk.
- Opcodes (read/write): matrix `83/03` (sub = layer), LED `84/04`, per-key `86/06`, palette `8A/0A`, live `08`,
  model id `82` sub 1 len 6, battery `87` sub 2 len 2, macros `85/05` as one
  multi-block transfer (layout-B store, `caps.macros = 'store'`, see `macro.ts`).
- The blocks are wireless "layout B", so `Mk75G5Wired` reuses `Mk75Wireless` with USB opcodes. Unlike wireless,
  the colour nibble keeps palette index 0..6.

### Wired key codes (u32 LE, low byte = type)
- **Types:**
  - `00` key: byte2 = HID modifier mask, byte3 = usage
  - `04` consumer: lo/hi in bytes 3/2
  - `06` modifier alone: `E0..E7`
  - `07` mouse: `F0` left, `F1` **middle**, `F2` **right**, `F3` forward, `F4` back
  - `10` macro: `[10 00 mode id-1]`, mode 1/2/4
  - `00000000` disabled
- **Redirect:** a base slot with low byte `02` redirects to FnSingle[(int8)byte3]. Write through it, and never
  change the redirect word.
- **Fn key** is `0x00000020`; never write it. The **knob** is slot 90 (`07 00 00 14`).

### Wireless (usage page 0xFF02 usage 2, 20-byte output/input reports)
- Packet: `[id][cmd][total][index][(sub<<4)|len][14 data][sum(0..18)&0xFF]`.
  - id `0x15` = combo receiver, `0x13` = CDev3632; pick from the descriptor.
  - Replies echo cmd; bit 7 of `total` = busy.
  - 15 ms pacing, a per-packet ack, ≤ 5 retries.
  - No ack for `0x88`/`0x8E`/`0x06`.
- **Commands:**
  - `01/41` key layer (sub 0-3, 512 B, last u32 `A55A0000`)
  - `02/42` per-key planes
  - `03/43` macro store (block 0-7 in the layer nibble; key cell `03 mode 01 id`)
  - `04/44` LED profile (128 B, "layout B", `5A A5` at 0x7E)
  - `09/49` palette (0x200, `5A A5` at 0x1FA)
  - `07` online
  - `4A` battery on `0x13` receivers
  - `88` live: sub 1 = groups `[R,G,B,count,led…]`, ≤ 200 B
- **Key codes** are `[type][mods][x][hid]`:
  - key: `hid<<24 | mods<<8`. Vendor presets put the hid in byte 2.
  - consumer: `…|0x02`
  - mouse: `0x0001BB01` (BB = 1 left, 2 middle, 3 right, 4 back, 5 forward)
- The adapter `Mk75Wireless` exposes the **wired data formats** to the UI and translates to and from these.

---

## 5. Confirmed vs inferred (hardware still needed)

- **Confirmed** (byte-exact by emulation): all wired frames, macro slot encoding, wireless packet framing and
  command bytes, the wired↔wireless key-code encoders, mouse code order.
- **Confirmed on hardware** (replayed in tests): IC2481 cable reads (issue #29) and `0x13` receiver reads (issue
  #31, same keyboard). The wireless key map and palette decode identically to the cable read. Writes over 2.4 GHz
  still need a capture.
- **Inferred:**
  - Whether speed level 0 is the slowest or the fastest.
  - Whether side-light brightness/speed writes (`0x14`/`0x15`) apply, and which end of speed is fast. Mode and colour
    writes are confirmed on hardware.
  - Whether Bluetooth writes work. Bluetooth does expose the vendor collection and answers reads (replayed from
    issue #35), but drops about half of each reply, so reads merge packets across attempts (issue #32, PROTOCOL.md).
  - Wireless live-stream sub=1 (taken from an F99 capture in OpenRGB issue #5166).
  - Fn-function names marked "likely".
  - How the firmware reverts after a live stream stops (we rewrite the profile).
- **Deliberate choice:** we write per-effect slots for i < 17 (`PER_MODE_SLOTS`). The MK75 vendor build writes 16
  because of its `LedMask=0x22120`, but the AU75 build writes 17 on the same firmware generation, so effect 16
  (Blossoming) settings are saved too.
- **Hardware checklist:** `TESTING.md`. Every protocol feature is now built; the layout-B ones (debounce,
  knob, IC2481 battery, macro store, Fn layer) follow hw-re-docs and still need a pass on our own hardware.

---

## 6. Code map

```
src/protocol/            pure logic + device I/O (unit-tested, no React)
  device.ts              Mk75Device interface + caps (macros, paletteIndex, battery)
  transport.ts           WebHID feature transport; routes report IDs to the right HID interface
  mk75.ts                wired protocol (readProfile/writeProfile/…/writeMacroPages/sendLiveFrame/checkModel)
  g5Wired.ts             wired protocol on IC2481 boards (520-byte report 0x06, layout B via Mk75Wireless)
  wireless/              packet.ts (framing) · link.ts (ack/retry engine) · codes.ts (wired↔wireless codes)
                         mk75Wireless.ts (adapter) · webhid.ts · mockWireless.ts (2.4 GHz simulator)
  connect.ts             requestMk75/openMk75: one Connect for cable / receiver / Bluetooth
  lighting.ts            LED_MODES (from KB.ini LedOpt), parse/patch profile & palette, per-key planes
  keycodes.ts            KeyAction encode/decode, HID tables, redirect-aware get/setKeyCode
  macro.ts textMacro.ts  macro slot encoder, id planning; text → events
  gameMode.ts            game mode planning: on/off with an undo record (before/after per key and profile byte)
  layouts.ts preset.ts   hardware layouts; shareable presets (deflate + base64url in #p=)
  live.ts screenSync.ts signals.ts effectDesigner.ts imageMap.ts perKeyTools.ts heatmap.ts chatter.ts
  mock.ts                USB simulator (dev and tests only; loaded with import() so production leaves it out)
  vk.ts                  VK → HID table (KB.ini vk codes)
src/device/              mk75Layout.ts (generated from KB.ini), mk75Units.ts (unit files), codeMap.ts
src/ui/                  React tabs + browser stores (profileStore, macroStore, effectStore, perKeyStore,
                         presetStore), applyProfile.ts, saveKeys.ts, useDevice.ts, ticker.ts, pwa.ts,
                         guide.ts/GuideView.tsx (MANUAL/README reader), report.ts/ReportDialog.tsx,
                         contribute.ts/ContributeDialog.tsx (device-data JSON; contents in DEVICE_DATA.md),
                         lazyParts.tsx (every tab, the Guide and the dialogs load on demand; chunk-error reload),
                         gameModeStore.ts (write sequence), GameModeToggle.tsx (header), GameModeCard.tsx (Key mapping card)
src/presets/gallery.ts   bundled presets
src/build/swPrecache.ts  build step: writes the asset list + build id into dist/sw.js (vite.config.ts plugin)
public/                  manifest, sw.js (precaches every asset; cache `mk75-<build id>`), icons, favicon.svg,
                         manual/*.webp screenshots, SEO files (robots.txt, sitemap.xml, og-image.png 1200×630,
                         google7e89feaa1f838180.html = Search Console verification, never delete it)
desktop/                 Electron tray app: main.cjs serves ../dist on app://mk75 (secure context for WebHID),
                         grants HID, auto-picks the device, answers getDisplayMedia; `npm run smoke` self-checks
```

- **Data ownership:**
  - Keyboard flash: lighting, palette, per-key, key map, macros, sleep.
  - Browser `localStorage` (`mk75.*` keys): profiles, macro library, per-key editor colours, custom effects,
    heatmap, theme, last macro pages written, game mode options and its undo record (`mk75.gamemode`).
  - Backups (`BackupTab`) carry all of these.
- **Dev hook:** in `npm run dev`, `window.__mk75.dev` is the connected device (simulator transports expose
  `profile`, `matrix`, `ledMatrix`, `liveFrames`, `writes`…). Browser tests use it.

---

## 7. Rules when changing code

1. **Read-modify-write only.** Never write bytes we don't understand. Patch only fields the vendor patches.
2. **Vendor order:** palette → macro pages → key matrix → per-key pages → profile. Skip blocks that are
   unchanged (see `applyProfile.ts`).
3. **Never** write the Fn key slot, the knob slot, redirect words, FnCombo, or per-mode slots ≥ `PER_MODE_SLOTS`.
   On layout B, the adapter refuses to change cells of type `07` (device functions) or `0D` (Fn) on any layer, and
   never writes keymap layers above 1 or macro blocks above 7.
4. **New protocol code needs tests** against `MockMk75` / `MockWirelessIO`, and byte-exact vendor captures when
   possible (emulate the vendor function first).
5. UI talks to `Mk75Device` only, never to WebHID directly. Respect `dev.caps` (for example `caps.macros` picks
   the 916KB slot format or the layout-B store, and is false on 0x15 receivers).
6. Live features: use `startTicker` (worker clock, survives background tabs). Always restore the saved profile on
   stop and on unmount.
7. Themes: colours are CSS tokens per `[data-theme]` (`green-orange` default, `milk-tea`, `arthur`, `summer`).
   Keycap groups come from `cap` in `mk75Layout.ts`.
8. **English only.** Chinese/Korean UI was explicitly dropped.

---

## 8. Workflow

```bash
npm install
npm run dev      # http://localhost:5173 (simulator buttons appear only in dev; hidden in production builds)
npm test         # vitest, 105+ tests
npm run build    # tsc -b && vite build → dist/
```

- **One feature per branch** (`feat/…`, `fix/…`, `docs/…`): build, test (`npm test`, build, and a browser check
  with a simulator), then `git merge --no-ff` into `main` and push. When a feature from `features/` ships, delete
  its plan file and its row in `features/README.md`. Bugs work the same way: every found bug gets a plan file in
  `bug-fix/` (branch `fix/…`), deleted with its row in `bug-fix/README.md` when the fix ships.
- **Pushing:** the repo belongs to `sazedur-siam`; push as that account. The repo-local git identity is already
  set. No AI attribution lines in commits or PRs.
- **Vercel** redeploys on push to `main`. The service worker's cache name and asset list are written at build time
  (`src/build/swPrecache.ts`), so every deploy that changes code installs a new worker and shows the update notice.
  Edit `public/sw.js` only to change the caching strategy, and keep its `BUILD`/`ASSETS` placeholder lines (the
  build fails without them).
- **SEO** (Google Search Console property `https://lingbao-mk75-web.vercel.app/`): `index.html` holds the title,
  meta description, canonical, Open Graph tags, a `SoftwareApplication` JSON-LD block, and a static `#intro`
  block inside `#root` that crawlers read before React replaces it. Keep the intro's feature list true to the
  README when features change. If the domain changes, update the canonical, `og:*` URLs, JSON-LD, `robots.txt`
  and `sitemap.xml` together.
- **New tabs or dialogs** go in `src/ui/lazyParts.tsx` (lazy, prefetched after connect), rendered inside
  `PartBoundary` + `Suspense` in `App.tsx`. Don't import them statically from the shell.
- **Manual screenshots:**
  1. Run `npm run dev`, set the theme to Dark green-orange at 1200×780, and use the USB simulator.
  2. Capture each tab and convert to WebP (q≈80) into `public/manual/`.
  3. The manual references them as `public/manual/x.webp`; the Guide rewrites that to `manual/x.webp`.

---

## 9. Gotchas learned

- **WebHID:** Chromium only. Feature reports are padded/truncated to the descriptor size (Windows requires it).
  `receiveFeature` strips the leading report-ID byte Chrome adds.
- **Windows mode:** the keyboard must be in Windows mode (Fn+W) and on the cable for the vendor (0xFF00)
  interface.
- **Hidden tabs:** background tabs throttle `setInterval` to about 1 Hz. Live effects use a Web Worker clock
  (`ticker.ts`).
- **Media capture:** `getDisplayMedia` audio needs "share system/tab audio". Screen sync downsamples to 32×12.
- **Wireless code types:** the wireless consumer type `0x02` collides with the wired "redirect" meaning, so
  translation happens only inside the adapter.
- **Firmware version:** only in USB `bcdDevice`, which WebHID doesn't expose.
- **Factory reset:** there's no reset command on the wired class.
- **Side lights:** layout B `0x12` mode (0 off, 1 flow, 2 neon, 3 steady, 4 breathe), `0x13` colour (0–6 = red, green,
  blue, yellow, purple, cyan, white), `0x14` brightness and `0x15` speed (0–4), found with the side-light probe on a
  real MK75 (Contribute device data). The keyboard saves shortcut brightness/speed changes only at the next mode or
  colour change, and the block updates a moment after its input reports, so diagnostics must wait for it to settle.
  Every LED-block write blinks the lighting once: write only real changes, and debounce sliders.
- **Debounce:** layout B byte `0x03` (0–4, the vendor UI shows +1), from hw-re-docs tests on a real MK75. The
  CDev916KB wired class never sends it.
- **GitHub issues:** they need an account. "Report an Issue" builds a pre-filled `issues/new` URL (≤ 7 KB);
  screenshots are pasted on GitHub.
- **Footer flag:** the Bangladesh flag is an inline SVG next to the author's name, because Windows renders flag
  emoji as letters.
