# Lingbao MK75 Driver

A browser-based configuration app for the **Lingbao MK75** keyboard. It covers everything the official Windows
"LINGBAO Keyboard Driver" does, adds features the official app doesn't have, and runs in Chrome, Edge or Opera on
Windows, macOS, Linux and ChromeOS. There's nothing to install, and you can also install it as an app.

**Live app:** https://mk75-web.vercel.app/ · **New here?** Read the [user manual](MANUAL.md) (also in the app under **Guide**).

> Unofficial and not affiliated with Lingbao. The protocol was reverse-engineered from the official driver
> (see [PROTOCOL.md](PROTOCOL.md)). **Download a backup before changing anything.**

---

## Quick start

1. Pick a connection with the switch next to the knob:
   - **middle** = USB cable
   - **2.4G** = receiver (pair by holding Fn+` for 3 s)
   - **BT** = Bluetooth "MK75-5.0" (pair by holding Fn+1/2/3 for 3 s)
2. Press **Fn+W** (Windows mode).
3. Open the app and click **Connect keyboard**. Choose the MK75 (`258A:010C`), its receiver (`3554:FA09`) or the
   Bluetooth device. Next time, **Reconnect MK75** reconnects in one click.
4. Go to **Backup & log → Download backup**.
5. Make changes. Every *Save* writes to the keyboard's memory, where it stays after you close the tab.

**Simulators (developers only).** The app has a USB and a 2.4 GHz keyboard simulator for testing without
hardware. They are hidden on the live site and only appear when you run it locally with `npm run dev`
(**Simulator (USB)** / **Simulator (2.4 GHz)** on the start screen). The unit tests (`npm test`) also use them.

---

## Features

### Profiles
- Named profiles store lighting, palette, key mapping, per-key colours and macros.
- **Apply** writes a profile to the keyboard in the official driver's order. Blocks already on the keyboard are
  skipped, so re-applying writes nothing.
- A preview shows what applying will change (lighting, palette, keys). The active profile is marked
  "on keyboard".
- Update from the keyboard, rename, duplicate, delete, and export/import files.
- **Share link:** a profile or per-key layout as a URL (`#p=…`, compressed into the URL hash and never sent to a
  server). Opening a link previews the preset with *Apply*, *Save as profile* or *Dismiss*. Damaged links are
  rejected. Macros aren't included in links.
- **Preset gallery:** MK75 green-orange backlight, WASD gamer, Calm teal breathing, Neon rainbow stream, Mac
  bottom row.

### Lighting
- The 16 effects the official MK75 app shows: Fixed on, Respire, Rainbow, Flash away, Raindrops, Ripples shining,
  Stars twinkle, Retro snake, Neon stream, Reaction, Sine wave, Rotating windmill, Colorful waterfall, Blossoming,
  Self-define and Off. Effects hidden by the vendor are available behind a checkbox.
- Brightness and speed (5 levels each), a palette colour or **Colourful** (random).
- Edit each effect's 7-colour palette.

### Per-key RGB ("Self-define")
- Click, drag or shift-click to select keys, then paint with a brush, preset colours or an **eyedropper**.
- **Gradient tool:** 2–3 colours, left→right, top→bottom or radial from a key, on the selection or the whole board.
- **Region selection:** WASD + arrows, gaming cluster, F-row, number row, letters, modifiers, coding shortcuts,
  arrows + navigation.
- **Match a colourway:** backlight colours that match the Dark green-orange, Iced milk tea, Arthur or Summer
  Wilderness keycaps.
- Undo/redo (Ctrl+Z / Ctrl+Shift+Z), share link.
- **Image / GIF to keys:** pick a PNG, JPG, WebP or animated GIF, then zoom, pan and adjust brightness and
  contrast. Each key takes the average colour under it. Save a still as per-key colours, or play a GIF live at its
  own frame timing.

### Side lights (experimental)
- Its own tab for the light bars on both sides: mode (Off, Flow, Neon, Steady, Breathe) and the keyboard's 7
  side-light colours, applied with one click. Profiles and backups include them.
- Side-light brightness and speed stay on the keyboard's shortcuts (Fn + Right Alt / Fn + Right Ctrl): the keyboard
  doesn't share them with the computer.
- IC2481 boards (all current MK75s), on the cable, 2.4 GHz or Bluetooth.

### Live effects (streamed from the computer, like the official app)
- **Real-time effects:** Static, Stars, Snow, Breathing, Shrink, Aspect, Follow (lights the keys you press),
  Rotating and Rainbow wave. Colour: rainbow, single colour or your per-key layout. Speed and brightness are
  adjustable.
- **Music:** spectrum bars, pulse rings, stream and beat flash, from shared system/tab audio or a microphone.
  Gain, auto-gain and smoothing are adjustable.
- **Screen sync:** the keyboard follows a shared screen, window or tab (zones by key position, average, or bottom
  edge), with smoothing and a saturation boost.
- **Signals:**
  - **Timer:** the F-row fills as progress, and the board flashes plus a notification appears when time's up.
  - **Clock:** hours on the number row, 5-minute steps on the F-row.
  - **Laptop battery:** a bar on the number row.
- **Custom (effect designer):** stack layers (solid, breathe, wave, ripple, stars, gradient scroll, key reactive).
  Each layer has its own keys, two colours, speed, width, direction and blend (replace, add or lighten).
  Effects are saved in the browser and include an "Aurora" starter.
- About 33 fps over the cable. Effects keep running when the tab is in the background (worker clock), and
  stopping restores your saved effect.

### Key mapping
- Remap any key (base layer):
  - a key or combination (press it, or pick from a list), or a modifier
  - media keys (play/pause, volume, mute, browser and app keys)
  - mouse buttons (left, middle, right, forward, back)
  - shortcuts (Alt+F4, Win+L, Win+D, copy/undo/save…)
  - a macro, or **Disable**
- **Hardware layouts:** QWERTY, Colemak, Colemak-DH, Dvorak and Workman are stored in the keyboard, so they work
  on any computer set to US QWERTY. Tweaks: Mac Ctrl·Option·Cmd swap, Caps Lock → Ctrl or Esc.
- Changed keys are highlighted before you save. Keys using Fn redirect slots are handled the same way as in the
  official driver.

### Macros
- Record from your keyboard and mouse (left/middle/right) with real timing, or use fixed delays. Edit each event
  and delay, with a 128-byte capacity meter.
- **New from text:** type or paste text (US layout) and the macro is generated. Text too long for one macro is
  split across several.
- Repeat modes: play once, repeat while held, repeat until any key. Up to 32 macros (about 60 events each).
- Macros are kept in the browser (the source of truth for editing). They save over the cable or 2.4 GHz.

### Key tester
- Works without connecting. Press keys to see them light up, with press counts and "tested" progress.
- **Chatter check:** flags switches that register a second press within an adjustable threshold. Useful after
  hot-swapping.
- **Typing test & heatmap:** WPM and accuracy with sample texts. Key-usage heatmap (blue → red) that you can save
  to the keyboard as per-key colours. Only typing inside the test box is counted, and counts stay in the browser.

### Device
- Connection type, MK75 model check, battery level with a header icon and a browser notification below 20 % and
  10 % (2.4 GHz receivers with report ID 0x13 and current MK75 boards on the cable).
- Sleep timer (Never, 30 s … 20 min).
- Debounce level 1–5 and knob mode (volume or lighting), experimental: current MK75 boards over the cable or
  2.4 GHz. Raise debounce if a key types twice.
- Reference list of the MK75's built-in Fn shortcuts, with unconfirmed ones marked "likely".

### Backup & log
- One file holds the lighting block, key matrix, palette, macros, profiles and custom effects. Restore writes
  them back in the official driver's order.
- A raw HID traffic log for troubleshooting.

### App
- **Themes for all four MK75 colourways:** Dark green-orange, Iced milk tea, Arthur and Summer Wilderness. The
  keyboard drawing (with knob, mode switch and indicator LEDs) recolours to match. First-time visitors are asked
  which colourway they own.
- **Report an Issue:** a short form (title, what happened, steps, expected, optional diagnostics) that opens a
  pre-filled GitHub issue. Screenshots are pasted on GitHub. Needs a free GitHub account.
- **Contribute device data:** saves one JSON file (HID interface layout, keyboard settings, configuration
  traffic) to attach to a GitHub issue, so more firmware variants and modes can be supported. Never includes
  typing or macro contents. Full list: [DEVICE_DATA.md](DEVICE_DATA.md).
- **Installable (PWA):** an *Install app* button, works offline, shows an update notice after a new version is
  deployed, and reconnects to previously allowed keyboards in one click.

---

## Connection support

| Feature | USB cable | 2.4 GHz receiver / Bluetooth |
|---|---|---|
| Lighting, brightness, speed, palette | ✅ | ✅ (effects use palette colour 1 or Colourful) |
| Per-key colours, image to keys | ✅ | ✅ |
| Live effects, music, screen sync, signals, custom | ✅ ~33 fps | ✅ (lower frame rate, colour-grouped frames) |
| Key mapping and layouts | ✅ | ✅ |
| Macros | ✅ | ✅ (0x13 receivers, the MK75's) |
| Profiles and presets | ✅ | ✅ (macros skipped) |
| Sleep timer | ✅ | ✅ |
| Debounce, knob mode | ✅ IC2481 boards (all current MK75s) | ✅ |
| Side lights (mode, colour) | ✅ IC2481 boards (experimental) | ✅ (experimental) |
| Battery level, low-battery alerts | ✅ IC2481 boards (all current MK75s) | receivers with report ID 0x13 (the MK75's) |

Bluetooth support assumes the keyboard exposes the same configuration interface as the receiver. It's not yet
confirmed on hardware.

## What's stored where

| On the keyboard (survives closing the tab, unplugging, other PCs) | In this browser only |
|---|---|
| Lighting, palette, per-key colours, side lights, key mapping, macros, sleep timer | Profiles, macro library, per-key editor layout, custom effects, heatmap counts, theme |

Use **Backup & log** to move browser-only data to another browser or computer. Live effects need the page open;
the keyboard can't run them by itself.

## Not supported

- **Knob functions beyond volume / lighting:** the firmware has only these two modes.
- **Firmware updates:** too risky from a browser.
- **Firmware version display:** only reported in the USB descriptor, which browsers can't read.
- **Per-app profiles:** a web page can't see which app is in focus.
- **Background live effects:** they stop when the page is closed.

## Planned features

Not built yet. Most need testing on a real MK75 first. Details are in [features/](features/README.md).

| Feature | What it will do | Status |
|---|---|---|
| **Desktop tray app** | Run live effects and music sync with no browser open, using system audio directly | First version in [desktop/](desktop/README.md) (tray, start at login, auto-reconnect, Windows system audio); no installers published yet |

---

## Development

```bash
npm install
npm run dev        # http://localhost:5173
npm test           # 95 unit tests (protocol frames match the official driver byte for byte)
npm run build      # static site in dist/, deploy to any HTTPS host (Vercel config included)
```

WebHID needs a secure context: `localhost` or HTTPS. In development builds, the connected device is available as
`window.__mk75` for testing.

### Linux permissions

```bash
echo 'KERNEL=="hidraw*", ATTRS{idVendor}=="258a", ATTRS{idProduct}=="010c", MODE="0660", TAG+="uaccess"' \
  | sudo tee /etc/udev/rules.d/70-mk75.rules
echo 'KERNEL=="hidraw*", ATTRS{idVendor}=="3554", ATTRS{idProduct}=="fa09", MODE="0660", TAG+="uaccess"' \
  | sudo tee -a /etc/udev/rules.d/70-mk75.rules
sudo udevadm control --reload-rules && sudo udevadm trigger
```

Then replug the keyboard or receiver.

### Project layout

```
src/protocol/            device protocol + pure logic (all unit-tested)
  transport.ts           WebHID feature-report transport (wired)
  mk75.ts                wired protocol: profile, key matrix, palette, per-key, macros, live stream
  wireless/              2.4 GHz / Bluetooth: packets, ack engine, code translation, adapter, simulator
  connect.ts             one Connect for cable, receiver or Bluetooth
  device.ts              Mk75Device interface the UI talks to
  lighting.ts keycodes.ts macro.ts textMacro.ts layouts.ts preset.ts
  live.ts screenSync.ts signals.ts effectDesigner.ts imageMap.ts perKeyTools.ts heatmap.ts chatter.ts
  mock.ts                USB simulator
src/device/              MK75 layout and key groups (from the official KB.ini), KeyboardEvent → key map
src/presets/             bundled preset gallery
src/ui/                  React tabs and browser-side stores (profiles, macros, effects, presets, PWA)
public/                  manifest, service worker, icons
```

## Testing

- `npm test` runs the protocol, wireless, macro, layout, preset and effect tests against the simulators.
- [TESTING.md](TESTING.md) is the hands-on test plan for a real MK75, with pass criteria.

## Safety notes

- Writes go to the keyboard's flash. The app writes the same blocks, in the same order, as the official driver,
  and leaves bytes it doesn't understand unchanged (read-modify-write).
- Things that are inferred rather than confirmed are labelled as such in the code and in TESTING.md.
- If something goes wrong, restore your backup, or reset with the official Windows driver.
