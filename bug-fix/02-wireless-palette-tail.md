# 02 · Wireless palette write zeroes the identity tail

**Severity:** corrupts flash bytes we don't own (maybe harmless) · **Priority:** P2 · **Effort:** S · **Status:** verify on hardware first

> **Update 2026-11-26: the vendor app does the same.** `spec_wireless.md` §4.2 (STATIC, `0x49c22c`): the vendor
> builds the palette as 0x1A4 bytes, copies it into a 0x200 buffer, sets only `[0x1FA]=5A, [0x1FB]=A5` and sends
> all 0x200. So the official driver also overwrites 0x1A4–0x1F9 (most of the identity copy), and nobody has
> reported a problem. Our code keeps more (bytes up to 489 come from the read). Don't change code until step 1
> below shows the tail matters. If a wired read after a vendor or app save shows the tail was zeroed **and**
> something broke, then fix it as planned.

## What happens
The palette is one 512-byte flash sector:

| Bytes | Content |
|---|---|
| `0 … 482` | 7 colours × RGB per effect (what we edit) |
| `483 … 507` | Copy of the identity (PSD) bytes: `03 00 00 00 00 C6 … 5A A5` |
| `508 … 511` | `00 10 00 00` |

Over 2.4 GHz, the palette read (`0x49`) returns only **490** bytes. Writes always rewrite all 512.

- [link.ts:120-135](../src/protocol/wireless/link.ts#L120-L135) `read()` returns a zero-filled buffer of the
  asked length, so bytes 490–511 come back as zeros with no sign that they were missing.
- [mk75Wireless.ts:201-209](../src/protocol/wireless/mk75Wireless.ts#L201-L209) `writeRgbTable()` writes that
  buffer back. It sets `0x1FA–0x1FB = 5A A5`, but bytes 490–505 and 508–511 are written as zeros.

Every palette save over 2.4 GHz overwrites most of the identity copy. Whether the firmware ever reads that copy
is unknown, but rule 1 in `CLAUDE.md` is "never write bytes we don't understand".

Not affected: the cable. `Mk75G5Wired` reads the full 512 bytes. The keymap is fine too: its 504-byte read is
followed by the trailer we write explicitly ([mk75Wireless.ts:186](../src/protocol/wireless/mk75Wireless.ts#L186)).

## Evidence
- hw-re-docs `PROTOCOL.md`, *Wireless Protocol → Reading* (table of short reads: keymap 504, per-key 378,
  palette 490) and *Palette (512 Bytes)*: "Always write all 512 bytes as a read-modify-write, so the identity
  bytes survive … wireless: the read is 490 bytes, so add the stored tail from a wired read".
- The simulator hides it: `MockWirelessIO` returns the full `0x200` palette
  ([mockWireless.ts:63-66](../src/protocol/wireless/mockWireless.ts#L63-L66)).

## Plan
1. **Get the real tail.** On the cable (IC2481 board), read GET `0x8A` with 512 bytes and record bytes 483–511.
   The dev hook `window.__mk75.dev` or the hw-re-docs `mk75wired.py get 0x8A 512` both work. Do it on two
   keyboards if possible.
2. **If the tail is the same on both** (expected, it's the model's identity): add `PALETTE_TAIL` (29 bytes,
   offset 483) to `mk75Wireless.ts`. In `writeRgbTable()`, when the link is wireless, copy bytes 490–511 from
   `PALETTE_TAIL` instead of the zero-filled read. Bytes 483–489 come back in the read; keep them.
3. **If it differs per unit:** save the tail from the last cable read in `localStorage` (`mk75.paletteTail`). Over
   wireless, refuse palette writes with a clear message until a cable read has filled it. Add the key to backups.
4. Simulator: make `MockWirelessIO` reply to `GetPalette` with only the first 490 bytes, like the hardware. Do
   the same for `GetMatrix` (504), so the existing keymap tests also cover short reads.

## Tests
- Wireless: read the palette, change one colour, write. The simulator's stored bytes 483–511 equal the known tail,
  not zeros.
- Wireless keymap round trip still ends with `00 00 00 00 00 00 5A A5` once the simulator returns 504 bytes.
- Cable (`g5Wired.test.ts`): the palette tail round-trips unchanged (regression guard).

## Risks
- Hard-coding a tail that is really per-unit would write another keyboard's identity. That's why step 1 checks two
  units before choosing step 2 over step 3.

## Done when
- After a 2.4 GHz palette save, a wired GET `0x8A` shows bytes 483–511 unchanged from before the save.
