# Side lights on wired IC2481 (experimental)

Observed on one wired MK75, USB `258A:010C` / IC2481, over Linux Chromium WebHID. This is not evidence that other revisions or operating systems behave identically. The app only exposes these controls on the G5 wired transport; the older CDev916KB and wireless transports are not enabled.

The 128-byte layout-B lighting block (read `0x84`, write `0x04`) contains these observed fields:

| Offset | Observed meaning |
|---|---|
| `0x12` | Mode: `0` off, `1` flow, `2` colour change, `3` solid, `4` breathe |
| `0x13` | Colour: `0` red, `1` green, `2` blue, `3` yellow, `4` purple, `5` sky blue, `6` white. Observed in solid mode; breathing colour also tested. |
| `0x14` | Brightness `0..4`; a write of 0 turned the side lights off and a write of 4 restored full-looking brightness. |
| `0x15` | Speed `0..4`; breathing at 0 took approximately 8–9 seconds per cycle versus about 2 seconds at 4. |

The keyboard shortcuts showed mode and colour changes in `0x84` immediately. After speed/brightness shortcuts, immediate reads and a read 12 seconds later remained unchanged; following a mode change exposed the new speed/brightness value. The exact firmware update and persistence mechanism is unknown. Consequently the app warns that a shortcut change may not immediately appear on re-read.

App-driven mode and colour changes, a brightness change and a speed change were observed on this board, including a short UI test. One state (`04 03 04 01` in the four fields) and the remainder of the block were identical after one unplug/replug. That is not a complete persistence or effects compatibility matrix.

Writes read a fresh, signature-checked block and modify only the requested supported fields; unknown field values are rejected. The adapter serialises its read-modify-write with other writes and follows the existing G5 profile-write timing. Read-modify-write cannot prevent concurrent physical shortcut changes during the transaction. Backup files in the existing app do not include these raw side-light fields; restoring an app backup is not a guaranteed recovery method for this feature.
