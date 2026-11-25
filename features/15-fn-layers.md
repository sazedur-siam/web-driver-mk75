# 15 · Fn-layer remapping

**Priority:** P2 · **Effort:** M · **Depends on:** hardware reads · **Status:** needs RE / validation

## What it is
Change what Fn + key does (FN1 layer), and possibly the FN2 and Tap layers shown as tabs in the official UI.

## What we know
- The official driver does **not** write Fn layers for the MK75 over the cable: it writes only the base layer plus
  "redirect" slots; the Fn-combo table (matrix bytes 0x2D0–0x38F, 48 slots) is firmware-owned.
- KB.ini `[FN1]` codes are display-only in the vendor app (e.g. Fn+F12 = `02 00 00 E9` = Volume +).
- Over wireless, the key matrix has **4 layers** (`cmd 0x01/0x41`, sub = layer 0–3), likely base / FN1 / FN2 / Tap.
  This is the most promising path.

## Plan
1. On a real MK75 (cable): read the 1024-byte matrix and check whether the FnCombo slots contain the `[FN1]` codes.
2. Over 2.4 GHz: read layers 1–3 and compare with `[FN1]`.
3. If layer 1 matches FN1: build an "Fn layer" tab in Key mapping (wireless first), behind an "Experimental" switch,
   with a one-click "Restore Fn defaults" from the KB.ini table.
4. Never allow changing the Fn key itself (`0x00000020`).

## Risks / open questions
- Writing firmware-owned tables could break Fn shortcuts (mode switch, pairing!). Always keep a restore path and a
  backup of the original layer bytes.

## Done when
- Fn+key remap works and "Restore Fn defaults" brings back every factory Fn function, confirmed on hardware.
