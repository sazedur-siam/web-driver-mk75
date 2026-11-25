# Contributing device data

The **Contribute device data** button (bottom of the app) saves one JSON file that describes how your MK75 talks
to the computer. Attaching it to a GitHub issue helps add support for firmware variants, receivers and
Bluetooth, which can't be tested without the hardware.

Nothing is uploaded automatically. You see a preview, tick a consent box, save the file, and attach it to a
GitHub issue yourself. GitHub issues are **public**.

Please send one file per connection mode you can use: **USB cable**, **2.4 GHz receiver** and **Bluetooth**.

## What the file contains

| Field | What it is | Why it's needed |
|---|---|---|
| `connection` | Mode (cable / wireless), interface name, protocol variant (`cdev916`, `g5wired`, `combo`, `3632`), what the app enabled for it | Tells which code path your keyboard uses |
| `hid` | USB vendor/product IDs, product name, and the layout of every HID interface you allowed for the MK75 (usage pages, report IDs, report sizes) | Firmware variants differ here (for example 1031- vs 519-byte reports) |
| `modelId` | The 6-byte model id the keyboard reports | Identifies the board |
| `snapshot` | The keyboard's current settings: lighting profile, key map, colour palette (raw bytes) | Shows the real data layout on your firmware |
| `log` | The last ~400 configuration packets between the app and the keyboard (full bytes) | Shows exactly what the keyboard replies |
| `browser`, `app` | Browser user-agent string (includes your OS) and app version | Reproducing problems |
| `note` | Whatever you typed in the Notes box | Your description |

## What it never contains

- **What you type.** Browsers block web pages from the keyboard's typing interface. The app only uses the
  separate configuration interface, which carries settings, not keystrokes.
- **Macro contents.** Macros can hold typed text, so the log keeps only the 7-byte header of macro packets and
  hides the rest.
- **Anything saved in this browser:** profiles, macro library, custom effects, heatmap counts.
- **Your name, email, IP address or serial number.** The file has none of these. GitHub shows the account you
  post with.

## What a browser can't collect

These need tools outside the browser. If you can help with them, say so in the issue:

- **Firmware version.** Only in the USB descriptor (`bcdDevice`), which browsers can't read.
- **Firmware binary.** There's no safe read command, and the app never attempts one.
- **The official Windows driver's traffic.** That needs Wireshark + USBPcap while using the official app.
- **The raw HID report descriptor.** Browsers give the parsed version (the `hid` field), which is enough.

Questions or second thoughts: you can delete your issue on GitHub at any time.
