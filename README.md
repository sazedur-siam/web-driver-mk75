# Lingbao MK75 Driver

A browser-based (WebHID) configuration tool for the MK75 keyboard (USB `258A:010C`, the same board and protocol as the AULA AU75). It runs in
Chrome, Edge or Opera on Windows, macOS, Linux and ChromeOS, with nothing to install.

> Unofficial. The protocol was reverse-engineered from the AULA AU75 vendor driver (see [PROTOCOL.md](PROTOCOL.md)).
> **Download a backup before changing anything.**

## Features

Matches the official LINGBAO Keyboard Driver (v2.0) for the MK75:

| | Status |
|---|---|
| Lighting effects (the 16 the official app shows), brightness, speed, colour / colourful | ✅ |
| Editing each effect's 7-colour palette | ✅ |
| Per-key custom colours ("Self-define") | ✅ |
| Real-time effects streamed live: Static, Stars, Snow, Breathing, Shrink, Aspect, Follow, Rotating, Rainbow wave | ✅ |
| Music visualiser (shared system/tab audio or microphone): spectrum bars, pulse rings, stream, beat flash | ✅ |
| Key remapping: keys and combos, media, mouse buttons, shortcuts, macros, disable | ✅ |
| Macro recorder/editor (32 macros, keys + modifiers + mouse L/R/M, delays, 3 repeat modes) | ✅ |
| Sleep timer, model check, built-in Fn shortcut reference | ✅ |
| Backup / restore (profile, key matrix, palette, macros), raw HID log | ✅ |
| Built-in simulators for USB and 2.4 GHz (no keyboard needed) | ✅ |
| Themes for all four MK75 colourways (Dark green-orange, Iced milk tea, Arthur, Summer Wilderness) | ✅ |
| 2.4 GHz receiver and Bluetooth: lighting, palette, per-key colours, live effects, key mapping, sleep | ✅ (macros: cable only) |
| Fn-layer / knob remapping | ❌ not offered by the official driver either |
| Firmware update | ❌ |

## Run

```bash
npm install
npm run dev        # http://localhost:5173
npm test           # protocol tests (frames match the vendor driver byte-for-byte)
npm run build      # static site in dist/, host it on any HTTPS server
```

WebHID needs a secure context: `localhost` or HTTPS.

## Using it

1. Choose a mode with the switch next to the knob: **middle** = USB cable, **2.4G** = receiver (pair: hold Fn+` 3 s), **BT** = Bluetooth "MK75-5.0" (pair: hold Fn+1/2/3). Press **Fn+W** (Windows mode).
2. Click **Connect keyboard** and choose the MK75 (`258A:010C`), its receiver (`3554:FA09`) or the Bluetooth device.
3. **Backup & log → Download backup.**
4. Make changes. Every *Save* does a read-modify-write and reads the result back from the keyboard.

### Linux permissions

```bash
echo 'KERNEL=="hidraw*", ATTRS{idVendor}=="258a", ATTRS{idProduct}=="010c", MODE="0660", TAG+="uaccess"' \
  | sudo tee /etc/udev/rules.d/70-mk75.rules
sudo udevadm control --reload-rules && sudo udevadm trigger
```

Then replug the keyboard.

## Layout

```
src/protocol/transport.ts   WebHID transport (routes report IDs 5/6 to the right HID interface)
src/protocol/au75.ts        framing, read/write commands, retries, serialised I/O
src/protocol/lighting.ts    profile/palette/per-key structures and effect table
src/protocol/keycodes.ts    key-matrix hardware codes and HID usage tables
src/protocol/mock.ts        in-memory simulator
src/device/au75Layout.ts    key rectangles + matrix indices (generated from the vendor KB.ini)
src/ui/*                    React UI
```

## Safety notes

* Writes go to the keyboard's flash. The app only writes the same blocks, in the same order, that the
  vendor tool writes, and leaves bytes it doesn't understand unchanged.
* Things it guesses are labelled in the code: "Mouse button 4/5" order, and the speed direction (0 vs 4 = fast).
* If something goes wrong, restore your backup. The vendor Windows tool can also reset the keyboard.
