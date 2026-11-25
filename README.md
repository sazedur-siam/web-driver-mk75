# AU75 Web Driver

A browser-based (WebHID) replacement for the AULA AU75 Windows configuration tool. It runs in
Chrome, Edge or Opera on Windows, macOS, Linux and ChromeOS, with nothing to install.

> Unofficial. The protocol was reverse-engineered from the vendor driver (see [PROTOCOL.md](PROTOCOL.md)).
> **Download a backup before changing anything.**

## Features

| | Status |
|---|---|
| Lighting effect, brightness, speed, colour / colourful | ✅ |
| Editing each effect's 7-colour palette | ✅ |
| Per-key custom colours ("Self-define") | ✅ |
| Base-layer key remapping: keys and combos, media, mouse buttons, shortcuts, disable | ✅ |
| Backup / restore of profile, key matrix and palette | ✅ |
| Raw HID traffic log | ✅ |
| Built-in simulator (no keyboard needed) | ✅ |
| Macros, Fn layer, knob, firmware update, 2.4 GHz/Bluetooth | ❌ not yet |

## Run

```bash
npm install
npm run dev        # http://localhost:5173
npm test           # protocol tests (frames match the vendor driver byte-for-byte)
npm run build      # static site in dist/, host it on any HTTPS server
```

WebHID needs a secure context: `localhost` or HTTPS.

## Using it

1. Connect the AU75 with the **USB cable** and press **Fn+W** (Windows mode).
2. Click **Connect keyboard** and choose the AU75 (`258A:010C`).
3. **Backup & log → Download backup.**
4. Make changes. Every *Save* does a read-modify-write and reads the result back from the keyboard.

### Linux permissions

```bash
echo 'KERNEL=="hidraw*", ATTRS{idVendor}=="258a", ATTRS{idProduct}=="010c", MODE="0660", TAG+="uaccess"' \
  | sudo tee /etc/udev/rules.d/70-aula-au75.rules
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
